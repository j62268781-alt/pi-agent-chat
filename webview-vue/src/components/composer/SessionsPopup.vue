<!--
  Session switcher. The trigger lives in the chat header (`.select-wrap` with the
  popup as a child), so this component is just the popup: it opens while
  `composer.openPopup === "sessions"`, asks the host to refresh the list on open
  and switches on click.

  Ported from the legacy `renderSessionsList` / `formatSessionTime`.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { SessionListItem } from "@protocol/messages";
import { post } from "@/lib/bridge.ts";
import { formatClock } from "@/lib/format.ts";
import { t } from "@/lib/i18n.ts";
import { useComposerStore } from "@/stores/composer.ts";
import { useOverlaysStore } from "@/stores/overlays.ts";
import { useSessionStore } from "@/stores/session.ts";
import { useTranscriptStore } from "@/stores/transcript.ts";

const composer = useComposerStore();
const overlays = useOverlaysStore();
const session = useSessionStore();
const transcript = useTranscriptStore();

const popupEl = ref<HTMLElement | null>(null);
const searchEl = ref<HTMLInputElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
/** Row Enter lands on — the model picker's `highlight`, same shape. */
const highlight = ref(0);

/** The row's own title — a name when it has one, else a derived date label. */
function titleFor(item: SessionListItem): string {
  return sessionTitle(item.file, item.name, item.modified);
}

/**
 * The rows the search admits. It runs over what the row *shows* — its title and
 * its preview line — because that is what the user reads and types back; an
 * unnamed session's title is a date label ("会话 09-22 21:34"), and filtering on
 * the stored fields alone silently dropped every row whose only "2" was in that
 * date (彬哥: 标题里一堆 2，搜 2 只出一条).
 */
const filtered = computed<SessionListItem[]>(() => {
  const query = composer.sessionSearch.trim().toLowerCase();
  if (!query) return session.sessionList;
  return session.sessionList.filter((item) =>
    `${titleFor(item)} ${item.firstMessage}`.toLowerCase().includes(query),
  );
});

function scrollActive(): void {
  listEl.value?.querySelector<HTMLElement>(".session-item.active")?.scrollIntoView({
    block: "nearest",
  });
}

/** Landing highlight: the open session when it is listed, else the first row. */
watch(
  filtered,
  (rows) => {
    const index = rows.findIndex((item) => item.file === session.sessionFile);
    highlight.value = index >= 0 ? index : 0;
    void nextTick(scrollActive);
  },
  { immediate: true },
);

function onSearchKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape") {
    ev.preventDefault();
    composer.closePopups();
    return;
  }
  const total = filtered.value.length;
  if (total === 0) return;
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    highlight.value = (highlight.value + 1) % total;
    void nextTick(scrollActive);
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    highlight.value = (highlight.value - 1 + total) % total;
    void nextTick(scrollActive);
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    const row = filtered.value[highlight.value];
    if (row) choose(row);
  }
}

/**
 * The row whose delete is in flight. Deleting the *open* session goes through a
 * session replacement first (pi has to move off the file before it is unlinked),
 * which on a full MCP config costs seconds — without this the row just sat there
 * looking like nothing happened ("删除正在会话的内容，会卡住了"). The host
 * re-pushes the list when it is done, one way or the other.
 */
const deleting = ref<string | null>(null);

watch(
  () => session.sessionList,
  () => {
    deleting.value = null;
  },
);

const open = computed(() => composer.openPopup === "sessions");

/** Relative time for the meta line, degrading to a date as it ages. */
function formatSessionTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{0} min ago", minutes);
  const clock = formatClock(date);
  if (date.toDateString() === now.toDateString()) return clock;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return t("Yesterday {0}", clock);
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: "2-digit", day: "2-digit" });
  }
  return date.toLocaleDateString([], { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** Unnamed sessions get a timestamp title and show their first message below. */
function sessionTitle(file: string, name: string, modified: string): string {
  if (name) return name;
  const date = new Date(modified);
  if (!Number.isNaN(date.getTime())) {
    const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));
    const label = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return t("Session {0}", label);
  }
  return file.split("/").pop() || file;
}

function preview(text: string): string {
  const flattened = text.trim().replace(/\s+/g, " ");
  return flattened.length > 90 ? `${flattened.slice(0, 90)}…` : flattened;
}

function meta(item: { modified: string; messageCount: number }): string {
  const parts = [formatSessionTime(item.modified)];
  if (item.messageCount) parts.push(`${item.messageCount} ${t("messages")}`);
  return parts.filter(Boolean).join(" · ");
}

/**
 * Live status for the row that is currently open — the only session that can be
 * mid-run. pi does not run in the background for recorded sessions, so every
 * other row has no status to show. "Deep thinking" is the transcript's own
 * signal: the streaming assistant message's latest thinking block is still open.
 */
const currentStatus = computed<string | null>(() => {
  if (session.isCompacting) return t("Compacting…");
  if (!session.isStreaming) return null;
  const blocks = transcript.activeAssistant?.blocks ?? [];
  const thinking = [...blocks].reverse().find((block) => block.kind === "thinking");
  if (thinking && thinking.running) return t("Deep thinking…");
  return t("Replying…");
});

function statusFor(item: SessionListItem): string | null {
  return item.file === session.sessionFile ? currentStatus.value : null;
}

/**
 * Place the popup under its button — the vertical half only.
 *
 * Width and the left edge are the stylesheet's (`.sessions-popup`): the popup is
 * fixed to the panel, because its absolute containing block is the button's own
 * 24px wrapper, and the header shifts under it (an icon font landing, a status
 * word appearing) as the panel loads. 彬哥: 给 popup 的宽拉满 —— a session row
 * carries a name, a preview line and a meta line, none of which had room in a
 * third of a sidebar.
 */
function position(): void {
  const el = popupEl.value;
  const anchor = el?.parentElement ?? null;
  if (!el || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const height = el.offsetHeight || 260;
  const spaceBelow = window.innerHeight - rect.bottom;
  el.style.top = "";
  el.style.bottom = "";
  // Not enough room below and more above: hang it from the button's top edge.
  if (spaceBelow < height + margin && rect.top > spaceBelow)
    el.style.bottom = `${window.innerHeight - rect.top + 12}px`;
  else el.style.top = `${rect.bottom + 12}px`;
}

watch(open, async (isOpen) => {
  if (!isOpen) return;
  await nextTick();
  position();
  // Type-to-filter, with the caret where the next keystroke goes — same as the
  // model popup. The host is asked at the same time, so a list that changed
  // meanwhile arrives while the user is already typing.
  searchEl.value?.focus();
  post({ type: "listSessions" });
});

/**
 * Switch sessions optimistically: the highlight, the header and the transcript's
 * own loading state move right away — the perceived lag used to be pi loading
 * the session before anything on screen changed. If the host reports an error
 * instead of content, `rollbackSwitch` puts the previous session back.
 *
 * The wait is *not* covered by the boot splash: that page is the pi logo at a
 * cold start (and the failure card), so raising it here made a session switch
 * look like the extension restarting — for the seconds pi needs to rebuild its
 * runtime, and worst for a session this panel has never opened, which has no
 * cached transcript to paint in the meantime (彬哥: 点别的进程建的会话，面板变成
 * 启动页再进 chat ui).
 */
function choose(item: SessionListItem): void {
  composer.closePopups();
  if (item.file === session.sessionFile) return;
  if (session.isStreaming) {
    overlays.toast(t("Stop the agent before switching sessions."), "error");
    return;
  }
  session.beginSwitch(
    item.file,
    sessionTitle(item.file, item.name, item.modified),
    transcript.messages.slice(),
  );
  transcript.reset();
  post({ type: "switchSession", file: item.file });
}

/**
 * Delete one recorded session. The transcript is removed from disk and cannot
 * come back, so it always goes through the confirmation dialog first. Deleting
 * the session that is currently open is allowed: the host stops the run and
 * moves onto another session before unlinking the file.
 */
async function remove(item: SessionListItem): Promise<void> {
  const name = sessionTitle(item.file, item.name, item.modified);
  const confirmed = await overlays.askConfirmation(
    t("Delete session?"),
    t("{0} — this deletes the saved transcript on disk.", name),
    t("Delete"),
  );
  if (!confirmed) return;
  deleting.value = item.file;
  post({ type: "deleteSession", file: item.file });
}

function onDocumentMouseDown(ev: MouseEvent): void {
  if (!open.value) return;
  // A pending confirmation belongs to a row *in* this list, and the click that
  // answers it lands outside the popup by construction (the dialog is its own
  // overlay). Closing here made deleting several rows a re-open-each-time chore;
  // the dialog is modal, so nothing else can be clicked meanwhile anyway.
  if (overlays.confirmState) return;
  const target = ev.target as Node | null;
  if (!target) return;
  const anchor = (popupEl.value?.offsetParent as HTMLElement | null) ?? popupEl.value;
  if (anchor?.contains(target)) return;
  composer.closePopups();
}

onMounted(() => document.addEventListener("mousedown", onDocumentMouseDown));
onUnmounted(() => document.removeEventListener("mousedown", onDocumentMouseDown));
</script>

<template>
  <div v-if="open" id="sessions-popup" ref="popupEl" class="sessions-popup">
    <div id="sessions-title" class="picker-title">{{ t("Sessions") }}</div>
    <!-- 搜索区（彬哥的参考图）：固定在列表上方，输入即过滤名称与首条消息。 -->
    <input
      v-if="session.sessionList.length > 0"
      id="sessions-search"
      ref="searchEl"
      v-model="composer.sessionSearch"
      class="sessions-search"
      type="text"
      autocomplete="off"
      :placeholder="t('Search sessions…')"
      @keydown="onSearchKeydown"
    />
    <div id="sessions-list" ref="listEl" class="sessions-list">
      <div v-if="session.sessionList.length === 0" class="sessions-empty">
        {{ t("No sessions yet.") }}
      </div>
      <div v-else-if="filtered.length === 0" class="sessions-empty">
        {{ t("No matching sessions") }}
      </div>
      <template v-else>
        <!-- A row is a div rather than a button so the delete button can live
             inside it — the marker `chat.css` styles (`.session-item`) cover the
             UA button styles either way, and the model list uses the same shape.
             The button swallows its own keydown: the row answers Enter/Space by
             switching, and those keys reach it from the focused trash button —
             where the row's `.prevent` also cancelled the button's own click, so
             Enter on the trash switched the session and never opened the
             confirmation (彬哥's "删除功能有逻辑bug"). -->
        <div
          v-for="(item, index) in filtered"
          :key="item.file"
          class="session-item"
          :class="{
            active: index === highlight,
            selected: item.file === session.sessionFile,
            'is-deleting': item.file === deleting,
          }"
          role="button"
          tabindex="0"
          :aria-busy="item.file === deleting ? 'true' : undefined"
          @click="choose(item)"
          @keydown.enter.prevent="choose(item)"
          @keydown.space.prevent="choose(item)"
        >
          <span class="session-item-text">
            <span class="session-item-title">
              {{ titleFor(item) }}
            </span>
            <span v-if="preview(item.firstMessage)" class="session-item-preview">
              {{ preview(item.firstMessage) }}
            </span>
            <span v-if="statusFor(item)" class="session-item-status">
              <span class="session-item-status-dot"></span>{{ statusFor(item) }}
            </span>
            <span v-else class="session-item-meta">{{ meta(item) }}</span>
          </span>
          <span v-if="item.file === session.sessionFile" class="session-item-check">
            <span class="codicon codicon-check"></span>
          </span>
          <!-- While the delete is in flight the trash becomes the spinner. The
               list stays open through it, and deleting the *open* session takes
               a session replacement first (seconds on a full MCP config) — the
               row has to say so instead of looking inert (彬哥's "会卡住了"). -->
          <button
            v-if="item.file === deleting"
            class="session-item-del is-busy"
            type="button"
            :title="t('Deleting…')"
            disabled
          >
            <span class="session-item-del-spin"></span>
          </button>
          <button
            v-else
            class="session-item-del"
            type="button"
            :title="t('Delete session')"
            @keydown.stop
            @click.stop="remove(item)"
          >
            <span class="codicon codicon-trash"></span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
