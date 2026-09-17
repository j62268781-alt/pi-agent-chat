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
import { isBooting } from "@/composables/useHostLink.ts";
import { useComposerStore } from "@/stores/composer.ts";
import { useOverlaysStore } from "@/stores/overlays.ts";
import { useSessionStore } from "@/stores/session.ts";
import { useTranscriptStore } from "@/stores/transcript.ts";

const composer = useComposerStore();
const overlays = useOverlaysStore();
const session = useSessionStore();
const transcript = useTranscriptStore();

const popupEl = ref<HTMLElement | null>(null);

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

function position(): void {
  const el = popupEl.value;
  const anchor = (el?.offsetParent as HTMLElement | null) ?? null;
  if (!el || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  el.style.minWidth = `${Math.min(window.innerWidth - margin * 2, 360, Math.max(240, rect.width))}px`;
  el.style.maxWidth = `${window.innerWidth - margin * 2}px`;
  el.style.left = "0px";
  el.style.top = "";
  el.style.bottom = "";
  const width = el.offsetWidth;
  if (rect.left + width > window.innerWidth - margin) {
    el.style.left = `${Math.max(margin - rect.left, rect.width - width)}px`;
  }
  const height = el.offsetHeight || 260;
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < height + margin && rect.top > spaceBelow)
    el.style.bottom = `${rect.height + 12}px`;
  else el.style.top = `${rect.height + 12}px`;
}

watch(open, async (isOpen) => {
  if (!isOpen) return;
  await nextTick();
  position();
  post({ type: "listSessions" });
});

/**
 * Switch sessions optimistically: the highlight, the header and a loading
 * splash move right away — the perceived lag used to be pi loading the session
 * before anything on screen changed. If the host reports an error instead of
 * content, `rollbackSwitch` puts the previous session back.
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
  isBooting.value = true;
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
  post({ type: "deleteSession", file: item.file });
}

function onDocumentMouseDown(ev: MouseEvent): void {
  if (!open.value) return;
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
    <div id="sessions-list" class="sessions-list">
      <div v-if="session.sessionList.length === 0" class="sessions-empty">
        {{ t("No sessions yet.") }}
      </div>
      <template v-else>
        <!-- A row is a div rather than a button so the delete button can live
             inside it — the marker `chat.css` styles (`.session-item`) cover the
             UA button styles either way, and the model list uses the same shape. -->
        <div
          v-for="item in session.sessionList"
          :key="item.file"
          class="session-item"
          :class="{ selected: item.file === session.sessionFile }"
          role="button"
          tabindex="0"
          @click="choose(item)"
          @keydown.enter.prevent="choose(item)"
          @keydown.space.prevent="choose(item)"
        >
          <span class="session-item-text">
            <span class="session-item-title">
              {{ sessionTitle(item.file, item.name, item.modified) }}
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
          <button
            class="session-item-del"
            type="button"
            :title="t('Delete session')"
            @click.stop="remove(item)"
          >
            <span class="codicon codicon-trash"></span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
