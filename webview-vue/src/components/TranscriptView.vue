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
import { useTranscriptStore } from "@/stores/transcript";
import TurnBlock from "./TurnBlock.vue";

const transcript = useTranscriptStore();
const display = useDisplayStore();

const scroller = ref<HTMLElement | null>(null);
const inner = ref<HTMLElement | null>(null);
const stuck = ref(true);

/** Distance from the bottom within which the view is considered "at bottom". */
const STICK_THRESHOLD_PX = 48;

let observer: ResizeObserver | undefined;

const isMac = /Mac|iP(hone|ad|od)/i.test(navigator.platform || navigator.userAgent || "");
/** Platform-aware modifier shown in the keycaps, `⌘` on macOS and `Ctrl+` elsewhere. */
const mod = isMac ? "\u2318" : "Ctrl+";

/** One keycap row of the new-session guide, ported from the legacy `getEmptyHtml`. */
const hints = computed(() => {
  const ctrlEnter = display.sendShortcut === "ctrlEnter";
  return [
    { key: ctrlEnter ? `${mod}Enter` : "Enter", label: t("send / steer") },
    { key: ctrlEnter ? "Enter" : "Shift+Enter", label: t("newline") },
    { key: "Alt+Enter", label: t("follow-up") },
    { key: "\u2191\u2193", label: t("history") },
    { key: "/", label: t("commands") },
    { key: "@", label: t("files") },
    { key: `${mod}V`, label: t("paste image") },
    { key: "Tab", label: t("complete") },
    { key: `${mod}U`, label: t("clear") },
  ];
});

function onScroll(): void {
  const el = scroller.value;
  if (!el) return;
  stuck.value = el.scrollTop + el.clientHeight >= el.scrollHeight - STICK_THRESHOLD_PX;
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
      if (stuck.value) void scrollToBottom();
    });
    if (inner.value) observer.observe(inner.value);
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

        <div v-if="transcript.isEmpty" class="empty">
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
          <div class="empty-hints">
            <span v-for="hint in hints" :key="hint.label" class="empty-hint">
              <kbd>{{ hint.key }}</kbd
              >{{ hint.label }}
            </span>
          </div>
        </div>

        <TurnBlock v-for="turn in transcript.turns" :key="turn.id" :turn="turn" />
      </div>
    </div>

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
</template>
