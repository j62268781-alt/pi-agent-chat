<!--
  The scrolling transcript.

  Scroll policy matches the legacy behaviour: the view sticks to the bottom
  while the user is already there, and detaches as soon as they scroll up, with
  a button to jump back down. The jump-back button is always mounted and only
  gains `.show` — `chat.css` fades it in from `opacity: 0`, so mounting it on
  demand would render it invisible.

  An empty session shows the legacy guide block (`.empty`): the pi mark, the
  two-line slogan and the keycap hints. Its centring comes from
  `.messages-inner:has(.empty)`, which is why the block has to keep that class
  name rather than a bespoke one.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import { useDisplayStore } from "@/stores/display";
import { useSessionStore } from "@/stores/session";
import { useTranscriptStore } from "@/stores/transcript";
import MessageRail from "./MessageRail.vue";
import TodoPill from "./TodoPill.vue";
import TurnBlock from "./TurnBlock.vue";

const transcript = useTranscriptStore();
const display = useDisplayStore();
const session = useSessionStore();

const scroller = ref<HTMLElement | null>(null);
const inner = ref<HTMLElement | null>(null);
const stuck = ref(true);

/**
 * Bottom status row, alive only while the agent works. The wording follows what
 * the running assistant is actually doing: its last block decides between
 * reasoning and answering (the session list popup uses the same two phrases).
 */
const activeBlock = computed(() => {
  const blocks = transcript.activeAssistant?.blocks ?? [];
  return blocks[blocks.length - 1] ?? null;
});
const liveLabel = computed(() => {
  // A retry outranks both phrases: it is the one thing that explains why nothing
  // is moving, and this row otherwise keeps claiming 正在回复中 for minutes while
  // the toolbar's own counter goes unnoticed (彬哥: 卡了很久我才注意到).
  if (transcript.retryAttempt > 0)
    return t("Retrying {0}/{1}…", transcript.retryAttempt, transcript.retryMax);
  if (!session.isStreaming) return "";
  return activeBlock.value?.kind === "thinking" ? t("Deep thinking…") : t("Replying…");
});
/**
 * Before a session's first turn pi rebuilds its runtime, and this row is what
 * the user looks at while that happens: naming the wait is cheaper than an
 * empty transcript, and the live label replaces it the moment `agent_start`
 * lands.
 */
const statusLabel = computed(
  () => liveLabel.value || (session.awaitingAgent ? t("Waiting for the agent…") : ""),
);

/** Distance from the bottom within which the view is considered "at bottom". */
const STICK_THRESHOLD_PX = 48;

/** Scroll position that triggers unlocking one more batch of older turns. */
const EXPAND_THRESHOLD_PX = 200;

/** Guard against re-entrant expansion while a batch is still settling. */
let expanding = false;

/**
 * Slack-style backwards paging: unlock one more batch of older turns and keep
 * the viewport parked on the message the user is reading. The DOM grows at the
 * TOP when the window moves, which would otherwise fling the user to the new
 * bottom — so after the batch mounts, `scrollTop` is compensated by the exact
 * height that was prepended (measured as `scrollHeight` delta, nextTick after
 * the mount). Repeat while the view is still near the top, in case a batch is
 * shorter than the trigger threshold.
 */
async function expandOlderBatch(): Promise<void> {
  const el = scroller.value;
  if (!el || expanding || !transcript.hasMoreAbove) return;
  expanding = true;
  try {
    let guard = 0;
    while (el.scrollTop < EXPAND_THRESHOLD_PX && transcript.hasMoreAbove && guard < 8) {
      guard += 1;
      const before = el.scrollHeight;
      const offset = el.scrollTop;
      transcript.expandOlder();
      await nextTick();
      el.scrollTop = offset + (el.scrollHeight - before);
    }
  } finally {
    expanding = false;
  }
}

let observer: ResizeObserver | undefined;

const isMac = /Mac|iP(hone|ad|od)/i.test(navigator.platform || navigator.userAgent || "");
/** Platform-aware modifier shown in the keycaps, `⌘` on macOS and `Ctrl+` elsewhere. */
const mod = isMac ? "\u2318" : "Ctrl+";

/** One keycap row of the new-session guide. Deliberately short: `/` and `@` are
 * self-describing first keystrokes (and the `/` list is searchable), so only the
 * keys that have nowhere else to live are listed here. */
const hints = computed(() => {
  const ctrlEnter = display.sendShortcut === "ctrlEnter";
  return [
    { key: ctrlEnter ? `${mod}Enter` : "Enter", label: t("send") },
    { key: ctrlEnter ? "Enter" : "Shift+Enter", label: t("newline") },
    { key: `${mod}V`, label: t("paste image") },
  ];
});

/** Is the viewport showing the end of the content? */
const atBottom = (el: HTMLElement): boolean =>
  el.scrollTop + el.clientHeight >= el.scrollHeight - STICK_THRESHOLD_PX;

/** Re-measure after the content changed under a viewport that did not scroll. */
async function refreshStuck(): Promise<void> {
  await nextTick();
  const el = scroller.value;
  if (el) stuck.value = atBottom(el);
}

function onScroll(): void {
  const el = scroller.value;
  if (!el) return;
  stuck.value = atBottom(el);
  // Near the top with history still unmounted: page in older turns. The
  // compensation inside runs after nextTick, so this handler re-fires for the
  // settled position; `expanding` serialises the batches.
  void expandOlderBatch();
}

async function scrollToBottom(): Promise<void> {
  await nextTick();
  const el = scroller.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  stuck.value = true;
}

/**
 * Put the newest turn's user bubble at the top of the viewport (`keepReadingAnchor`)
 * instead of chasing the bottom: the answer then grows downwards from a fixed
 * spot and the reader never has text shoved out from under them. Measured with
 * rects rather than `offsetTop`, because the offset parent is outside the
 * scroller (`.messages` is not positioned).
 */
async function anchorToLatestTurn(): Promise<void> {
  await nextTick();
  const el = scroller.value;
  const root = inner.value;
  if (!el || !root) return;
  const rows = root.querySelectorAll<HTMLElement>(".msg.user");
  const row = rows[rows.length - 1];
  if (!row) return;
  const offset = row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
  el.scrollTop = Math.max(0, offset - 8);
}

function openHistory(): void {
  if (transcript.historyLoaded || transcript.historyLoading) return;
  transcript.historyLoading = true;
  post({ type: "requestHistory" });
}

onMounted(() => {
  const el = scroller.value;
  if (el) {
    el.addEventListener("scroll", onScroll, { passive: true });
    observer = new ResizeObserver(() => {
      // The content can also *shrink* under the viewport — a new session, a
      // cleared transcript. Nothing scrolls then, so `stuck` has to be measured
      // again here or the button outlives the content that earned it.
      if (stuck.value) void scrollToBottom();
      else void refreshStuck();
    });
    // Border box, not the default content box: the queue's inset is padding on
    // this element (`--pi-queue-h`), which grows only the border box — watching
    // the content box left the view one card short of the bottom, exactly the
    // row the inset was reserving.
    if (inner.value) observer.observe(inner.value, { box: "border-box" });
  }
});

onUnmounted(() => {
  scroller.value?.removeEventListener("scroll", onScroll);
  observer?.disconnect();
});

// New turns and streaming deltas both grow the content; `inner` drives the observer.
watch(
  () => transcript.turns.length,
  (length, previous) => {
    // A fresh turn is the one moment worth re-anchoring; keeps the bubble at the
    // top and lets `stuck` detach so the growth below does not drag the view.
    if (display.keepReadingAnchor && length > (previous ?? 0)) {
      void anchorToLatestTurn();
      return;
    }
    if (stuck.value) void scrollToBottom();
    else void refreshStuck();
  },
);
</script>

<template>
  <div class="messages-wrap">
    <div ref="scroller" id="messages" class="messages">
      <div ref="inner" id="messages-inner" class="messages-inner">
        <details
          v-if="transcript.historyAvailable && !transcript.historyLoaded"
          class="history-block"
          @toggle="($event.target as HTMLDetailsElement).open && openHistory()"
        >
          <summary>
            <span class="history-label">{{ t("Show earlier compacted messages") }}</span>
          </summary>
          <div class="history-body">
            <div v-if="transcript.historyLoading" class="history-loading">
              {{ t("Loading history…") }}
            </div>
          </div>
        </details>

        <div v-if="transcript.isEmpty && !session.switchSnapshot" class="empty">
          <div class="empty-logo">
            <svg viewBox="0 0 800 800" fill="currentColor">
              <path
                fill-rule="evenodd"
                d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
              />
              <path d="M517.36 400H634.72V634.72H517.36Z" />
            </svg>
          </div>
          <div class="empty-line">{{ t("There are many agent harnesses") }}</div>
          <div class="empty-line">
            {{ t("but this one is") }}
            <span class="empty-accent">{{ t("yours") }}</span>
          </div>
          <div class="empty-guide">{{ t("Type below — / opens commands, @ cites files.") }}</div>
          <div class="empty-hints">
            <span v-for="hint in hints" :key="hint.label" class="empty-hint">
              <kbd>{{ hint.key }}</kbd
              >{{ hint.label }}
            </span>
          </div>
        </div>

        <!-- A switch in flight: the transcript is empty because the *next*
             session is still loading, not because this is a new one. The
             snapshot is set from the click until the content (or an error)
             lands, which is exactly this window. -->
        <div v-if="session.switchSnapshot" class="switch-loading">
          <span class="switch-loading-spin" aria-hidden="true"></span>
          <span>{{ t("Loading session…") }}</span>
          <!-- The title, not the name: the session being loaded is usually
               unnamed, and the row that was clicked titled it by date. -->
          <span v-if="session.title" class="switch-loading-name">
            {{ session.title }}
          </span>
        </div>

        <TurnBlock
          v-for="(turn, index) in transcript.visibleTurns"
          :key="turn.id"
          :turn="turn"
          :is-last="index === transcript.visibleTurns.length - 1"
        />

        <!-- Live status row: the dotted grid + what the agent is doing right
             now. It leaves as soon as the agent settles. -->
        <div v-if="statusLabel" class="status-row">
          <span class="status-dots" aria-hidden="true"></span>
          <span class="status-text">{{ statusLabel }}</span>
        </div>
      </div>
    </div>

    <!-- The rail rides the right edge of the scroller's box: it marks prompts in
         the *whole* session, while only the tail turns are mounted. -->
    <MessageRail />

    <div class="float-row">
      <TodoPill />
      <button
        id="scroll-bottom-btn"
        class="scroll-bottom-btn"
        :class="{ show: !stuck }"
        type="button"
        :title="t('Scroll to bottom')"
        @click="scrollToBottom"
      >
        <span class="codicon codicon-chevron-down"></span>
      </button>
    </div>
  </div>
</template>
