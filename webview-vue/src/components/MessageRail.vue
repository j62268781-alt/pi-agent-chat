<!--
  The message rail: one mark per prompt along the right edge of the transcript.

  A long session is mostly scrolling, and the scrollbar says where you are but
  nothing about what is there. The rail says what is there — one mark per prompt,
  a click jumps to that prompt (paging the older turns in first when the render
  window has not mounted it), the mark under the pointer opens a card with the
  prompt and the opening of its answer, and the prompt whose turn sits at the top
  of the viewport stays marked as the current one.

  The data comes from the transcript store rather than from the DOM: the rail
  spans the whole session while only the tail turns are mounted, so a jump has to
  be able to *ask* for the turn it is jumping to.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { ComponentPublicInstance } from "vue";
import { t } from "@/lib/i18n.ts";
import { useTranscriptStore } from "@/stores/transcript";
import type { Turn } from "@/stores/transcript";

const transcript = useTranscriptStore();

/** One mark: a prompt, or the hairline that stands for a compaction. */
interface RailEntry {
  /** Unique and stable — `turn.id`, or the system row's own id for a separator. */
  key: string;
  kind: "prompt" | "sep";
  turnId: string;
  turn: Turn;
}

/** The transcript's own ids, published by `TranscriptView`. */
const SCROLLER_ID = "messages";
const INNER_ID = "messages-inner";

/**
 * How far below the viewport's top a prompt still counts as the one the reader
 * is on. A hair of slack, not a band: the rule is "the turn that covers the top
 * edge", and a band made a jump to 提问 1 highlight 提问 2 whenever the turns
 * were short enough to fit a few of them in the viewport (seen in the preview).
 */
const CURRENT_SLACK_PX = 12;

/**
 * Within this distance of the end, the newest prompt is the current one no
 * matter what the top edge shows: an answer long enough to push its own bubble
 * off the top is exactly the state a reader is in at the bottom, and the mark
 * used to fall back to a prompt two answers up (seen in the preview).
 */
const AT_BOTTOM_PX = 48;

/** Where a jumped-to prompt lands, measured from the viewport's top. */
const JUMP_OFFSET_PX = 8;

/**
 * Hover intent before the card opens, in ms: crossing the rail on the way
 * somewhere else must not flash a card, and 150ms is short enough that a
 * deliberate hover does not feel like waiting.
 */
const HOVER_DELAY_MS = 150;

/** How much of a prompt / answer the card carries. */
const CARD_MAX_CHARS = 200;

const railEl = ref<HTMLElement | null>(null);
const cardEl = ref<HTMLElement | null>(null);
/** Mark elements by key. Not reactive: read on demand, written by the refs. */
const marks = new Map<string, HTMLElement>();

const currentKey = ref("");
const hoveredKey = ref("");
const cardOpen = ref(false);
const cardTop = ref(0);

const entries = computed<RailEntry[]>(() => {
  const list: RailEntry[] = [];
  for (const turn of transcript.turns) {
    if (turn.user) list.push({ key: turn.id, kind: "prompt", turnId: turn.id, turn });
    for (const message of turn.leading) {
      // Compaction is the one interruption in the flow that a reader looking for
      // something later will remember as a landmark.
      if (message.variant === "compaction")
        list.push({ key: message.id, kind: "sep", turnId: turn.id, turn });
    }
  }
  return list;
});

/** 1-based position among the prompts, for the marks' accessible names. */
const promptNumbers = computed(() => {
  const numbers = new Map<string, number>();
  let count = 0;
  for (const entry of entries.value) {
    if (entry.kind === "prompt") numbers.set(entry.key, (count += 1));
  }
  return numbers;
});

const hoveredEntry = computed(
  () => entries.value.find((entry) => entry.key === hoveredKey.value) ?? null,
);

/** The card reads the turn's text only while a card is actually open. */
const cardPrompt = computed(() => clip(hoveredEntry.value?.turn.user?.text ?? ""));
const cardReply = computed(() => clip(replyText(hoveredEntry.value?.turn ?? null)));

/** The answer's opening: the turn's first prose, wherever the fold put it. */
function replyText(turn: Turn | null): string {
  if (!turn) return "";
  for (const group of [turn.workBlocks, turn.finalBlocks]) {
    for (const entry of group) {
      if (entry.block.kind === "text" && entry.block.markdown.trim()) return entry.block.markdown;
    }
  }
  return "";
}

/** Markdown reduced to one line — the card is a pointer, not a reading pane. */
function plainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[`*_|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(markdown: string): string {
  const flat = plainText(markdown);
  return flat.length > CARD_MAX_CHARS ? `${flat.slice(0, CARD_MAX_CHARS).trimEnd()}…` : flat;
}

/** Is the render window mounting this turn's row yet? */
function isMounted(turnId: string): boolean {
  return transcript.visibleTurns.some((turn) => turn.id === turnId);
}

/**
 * Put a prompt at the top of the viewport.
 *
 * The window mounts the tail only, so a mark above it pages the older turns in
 * first — the same expansion the scroll handler performs, asked for in one go
 * rather than batch by batch.
 */
async function jumpTo(turnId: string): Promise<void> {
  if (!isMounted(turnId)) {
    transcript.expandOlder(transcript.turns.length);
    await nextTick();
  }
  const scroller = document.getElementById(SCROLLER_ID);
  const row = document
    .getElementById(INNER_ID)
    ?.querySelector<HTMLElement>(`.msg.user[data-turn-id="${turnId}"]`);
  if (!scroller || !row) return;
  // Rects rather than `offsetTop`: the offset parent sits outside the scroller.
  const offset =
    row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTop = Math.max(0, offset - JUMP_OFFSET_PX);
  updateCurrent();
}

/** The prompt whose turn is at the top of the viewport, marked on the rail. */
function updateCurrent(): void {
  const scroller = document.getElementById(SCROLLER_ID);
  const root = document.getElementById(INNER_ID);
  if (!scroller || !root || !railEl.value) return;
  const threshold = scroller.getBoundingClientRect().top + CURRENT_SLACK_PX;
  const atBottom =
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= AT_BOTTOM_PX;
  let bestKey = "";
  let bestTop = Number.NEGATIVE_INFINITY;
  let firstKey = "";
  let lastKey = "";
  for (const row of root.querySelectorAll<HTMLElement>(".msg.user[data-turn-id]")) {
    const key = row.dataset.turnId ?? "";
    if (!firstKey) firstKey = key;
    lastKey = key;
    const top = row.getBoundingClientRect().top;
    if (top <= threshold && top > bestTop) {
      bestTop = top;
      bestKey = key;
    }
  }
  if (atBottom && lastKey) currentKey.value = lastKey;
  // Above the first prompt — a session that opens with work — the first mounted
  // prompt is what "here" means.
  else currentKey.value = bestKey || firstKey;
  revealCurrent();
}

/** Keep the current mark on the rail when the marks overflow its own height. */
function revealCurrent(): void {
  const rail = railEl.value;
  const mark = marks.get(currentKey.value);
  if (!rail || !mark) return;
  const air = mark.offsetHeight;
  const top = mark.offsetTop;
  const bottom = top + mark.offsetHeight;
  if (top - air < rail.scrollTop) rail.scrollTop = Math.max(0, top - air);
  else if (bottom + air > rail.scrollTop + rail.clientHeight)
    rail.scrollTop = bottom + air - rail.clientHeight;
}

let scrollFrame: number | null = null;

function onScroll(): void {
  if (scrollFrame !== null) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null;
    updateCurrent();
  });
}

let showTimer: number | null = null;

function onMarkEnter(entry: RailEntry): void {
  hoveredKey.value = entry.key;
  // Moving along the rail moves the open card with the pointer.
  if (cardOpen.value) {
    void nextTick(positionCard);
    return;
  }
  showTimer = window.setTimeout(() => {
    showTimer = null;
    cardOpen.value = true;
    void nextTick(positionCard);
  }, HOVER_DELAY_MS);
}

function onRailLeave(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  hoveredKey.value = "";
  cardOpen.value = false;
}

/** Centre the card on the hovered mark, kept inside the transcript's box. */
function positionCard(): void {
  const rail = railEl.value;
  const card = cardEl.value;
  const mark = marks.get(hoveredKey.value);
  const wrap = rail?.parentElement;
  if (!rail || !card || !wrap || !mark) return;
  const wrapRect = wrap.getBoundingClientRect();
  const markRect = mark.getBoundingClientRect();
  const centred = markRect.top - wrapRect.top + markRect.height / 2 - card.offsetHeight / 2;
  cardTop.value = Math.min(Math.max(0, centred), Math.max(0, wrapRect.height - card.offsetHeight));
}

function setMarkRef(key: string, el: Element | ComponentPublicInstance | null): void {
  if (el instanceof HTMLElement) marks.set(key, el);
  else marks.delete(key);
}

/** The rail spans the whole session, so it can outlive the prompts it marks. */
watch(
  [() => entries.value.length, () => entries.value[0]?.key],
  () => void nextTick(updateCurrent),
);

onMounted(() => {
  document.getElementById(SCROLLER_ID)?.addEventListener("scroll", onScroll, { passive: true });
  updateCurrent();
});

onUnmounted(() => {
  document.getElementById(SCROLLER_ID)?.removeEventListener("scroll", onScroll);
  if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
  if (showTimer !== null) clearTimeout(showTimer);
});
</script>

<template>
  <div
    v-if="entries.length"
    ref="railEl"
    class="msg-rail"
    role="navigation"
    :aria-label="t('Message locator')"
    @mouseleave="onRailLeave"
  >
    <template v-for="entry in entries" :key="entry.key">
      <span v-if="entry.kind === 'sep'" class="msg-rail-sep" :title="t('Context compacted')" />
      <button
        v-else
        :ref="(el) => setMarkRef(entry.key, el)"
        class="msg-rail-mark"
        :class="{ 'is-current': entry.key === currentKey, 'is-hover': entry.key === hoveredKey }"
        type="button"
        :aria-label="t('Go to prompt {0}', promptNumbers.get(entry.key) ?? 0)"
        :aria-current="entry.key === currentKey ? 'true' : undefined"
        @click="jumpTo(entry.turnId)"
        @mouseenter="onMarkEnter(entry)"
      />
    </template>
  </div>

  <!-- `pointer-events: none` in the sheet: it is a label for the mark, and a card
       that swallows the pointer would fight the mark's own click. -->
  <div
    v-if="cardOpen && hoveredEntry"
    ref="cardEl"
    class="msg-rail-card"
    role="tooltip"
    :style="{ top: cardTop + 'px' }"
  >
    <div class="msg-rail-card-title">
      {{ cardPrompt || t("(empty prompt)") }}
    </div>
    <div v-if="cardReply" class="msg-rail-card-reply">{{ cardReply }}</div>
  </div>
</template>
