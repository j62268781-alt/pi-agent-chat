<!--
  One user request and everything the agent did in response.

  The legacy code built this by moving already-rendered sibling nodes into a
  `<details>` at the end of a turn (`wrapWorkSegment`); here the fold is a
  derived structure, so it re-folds correctly while streaming.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { post } from "@/lib/bridge.ts";
import { localizeError } from "@/lib/error-text.ts";
import { formatCounts, formatDuration, formatTime, formatTokens } from "@/lib/format.ts";
import { t } from "@/lib/i18n.ts";
import { aggregateUsage, formatUsage } from "@/lib/usage.ts";
import { collectTurnFiles } from "@/lib/turn-files.ts";
import { useDisplayStore } from "@/stores/display";
import { useOverlaysStore } from "@/stores/overlays";
import { useSessionStore } from "@/stores/session";
import type { Turn } from "@/stores/transcript";
import BlockView from "./BlockView.vue";
import TurnFilesCard from "./TurnFilesCard.vue";

const props = defineProps<{ turn: Turn; isLast?: boolean }>();

const display = useDisplayStore();
const overlays = useOverlaysStore();
const session = useSessionStore();

/**
 * A turn is running when it is the newest one and the session is streaming.
 *
 * `stopReason` is not the signal: a turn that uses tools is several assistant
 * messages, and the first `message_end` already writes a stop reason, so a
 * reason-based test flips to 「已处理」 while the turn is still working.
 */
const running = computed(() => props.isLast === true && session.isStreaming);

/** Ticks only while this turn is the running one, so the head counts up live. */
const now = ref(Date.now());
let ticker: number | undefined;

watch(
  running,
  (value) => {
    if (ticker !== undefined) {
      clearInterval(ticker);
      ticker = undefined;
    }
    if (value) ticker = window.setInterval(() => (now.value = Date.now()), 1000);
  },
  { immediate: true },
);

onUnmounted(() => {
  if (ticker !== undefined) clearInterval(ticker);
});

/** Outcome word of a settled turn: the fold head's label. */
const outcome = computed(() => {
  // pi writes an `errorMessage` for an aborted run as well, so the stop reason
  // has to be read first — otherwise a reply the user merely stopped gets
  // stamped 失败, which is not what a stop is.
  if (props.turn.stopReason === "aborted") return t("Stopped");
  if (props.turn.errorMessage) return t("failed");
  return t("Processed");
});

/** Only a failure the user did not ask for counts as one. */
const failed = computed(
  () => props.turn.stopReason !== "aborted" && Boolean(props.turn.errorMessage),
);

/**
 * What the closing status line says about the outcome — nothing, usually.
 *
 * The fold head names the outcome and carries the duration, so the line repeats
 * neither: 「已处理」 on every single turn was a word with nothing behind it
 * (彬哥), 「已停止」 has its own sentence above (`.aborted-notice`), and 失败 ·
 * 2分25秒 already sits at the top of the turn. It only speaks for the turns with
 * no head to hang anything on — folding off, or nothing to fold.
 */
const settledOutcome = computed(() => (failed.value ? t("failed") : ""));

/**
 * pi's own word for an aborted run is "user cancelled" (`stopReason: "aborted"`
 * — the stop button, or the host cancelling the run). A stopped reply reads as
 * a finished one otherwise, so the transcript says where it was cut: Qoder
 * prints the same sentence under a terminated reply.
 */
const stopped = computed(() => props.turn.stopReason === "aborted" && !running.value);

/**
 * Fold header. The board keeps the head to one phrase: the outcome once the turn
 * is done, the elapsed time while it runs. The duration rides along in both
 * states, in the same wording the closing line used to use — 「已处理 · 耗时
 * 2分25秒」 reads as one phrase, and a bare `2分25秒` left the reader guessing
 * what the number was (彬哥). Per-turn counters (turns, diff size) are still off
 * the line; the diff counters sit on the right.
 */
const workTitle = computed(() => {
  if (!running.value) {
    return turnDuration.value
      ? outcome.value + " · " + t("Worked for {0}", turnDuration.value)
      : outcome.value;
  }
  const start = props.turn.workStartedAt ?? props.turn.user?.timestamp ?? now.value;
  return t("Running for {0}", formatDuration(Math.max(0, now.value - start)));
});

/** The fold head only exists when there is work behind it and folding is on. */
const hasFoldHead = computed(() => display.collapseWork && props.turn.workBlocks.length > 0);

/** Wall-clock duration of the turn: the user's message to the last block. */
const turnDuration = computed(() => {
  const end = props.turn.messageTime;
  const start = props.turn.user?.timestamp ?? props.turn.workStartedAt;
  if (end == null || start == null || end < start) return "";
  return formatDuration(end - start);
});

/** Every assistant message of the turn, once each. */
const turnMessages = computed(() => [
  ...new Set([...props.turn.workBlocks, ...props.turn.finalBlocks].map((entry) => entry.message)),
]);

/**
 * Cache counters for the whole turn — every assistant message in it, not just
 * the last one, because a turn that uses tools is several messages. What comes
 * out here is the icon's hover text: the figures themselves live in the card
 * (读缓存/写缓存 spelled out, `R205K` was the first thing 彬哥 had to ask about).
 *
 * Deduplicated by message: usage is reported per *message*, but the fold holds
 * one entry per *block* (a thinking block, each tool call, the prose), so the
 * same message arrives here several times and summing the entries straight
 * multiplied the counters by the block count — a 3.8M cache read on a three-
 * block turn read as 11.4M.
 */
const turnTotals = computed(() => aggregateUsage(turnMessages.value));

/** Null when no message in the turn reported anything — then there is no card. */
const turnUsage = computed(() => {
  const totals = turnTotals.value;
  if (!totals.input && !totals.output && !totals.cacheRead && !totals.cacheWrite) return null;
  return { full: formatUsage(totals) };
});

/** The details behind the chip, in the same shape as the ring's readout card. */
const usageRows = computed(() => {
  const totals = turnTotals.value;
  const rows = [
    { label: t("Input"), value: formatTokens(totals.input) },
    { label: t("Output"), value: formatTokens(totals.output) },
    { label: t("Cache read"), value: formatTokens(totals.cacheRead) },
    { label: t("Cache write"), value: formatTokens(totals.cacheWrite) },
    // One call per assistant message: pi answers, then answers again with the
    // tool results in hand. `usage.turns` says the same thing per message, but
    // it is per message — the row would be counting the wrong thing.
    { label: t("Model calls"), value: String(turnMessages.value.length) },
  ];
  if (totals.cost > 0) rows.push({ label: t("Cost"), value: "$" + totals.cost.toFixed(4) });
  return rows;
});

/** The answer — every block the fold left in the clear. */
const conclusion = computed(() =>
  props.turn.finalBlocks
    .map((entry) => (entry.block.kind === "text" ? entry.block.markdown : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim(),
);

/** The closing status line is only meaningful once the turn has content. */
const hasContent = computed(
  () => props.turn.workBlocks.length > 0 || props.turn.finalBlocks.length > 0,
);

const counts = computed(() => formatCounts(props.turn.added, props.turn.removed));

/** The turn's files, read back out of its own tool blocks. */
const changes = computed(() => collectTurnFiles(props.turn));

/**
 * pi's own words for why a run failed, when nothing else on screen carries them.
 *
 * A run can fail before it produces a single block — every retry refused, a 4xx
 * from the provider — and then there is nothing for the fold head or the status
 * line to hang the word 失败 on: the turn is a bare bubble, and the reason lives
 * only in `errorMessage` (彬哥, 2026-09-25: 三次发送都失败了，界面上什么都看不出来).
 * A retry row already spells the failure out, and a stopped run says so in its
 * own notice, so both are left alone.
 */
const failureText = computed(() => {
  // Red is for the end of the run, not for the middle of it: pi writes the
  // provider's `errorMessage` on every refused attempt, so during the retry
  // window this banner would shout 请求超时 while the row under it is still
  // counting 正在重试 2/5 (彬哥, 2026-09-25). The run has to be over first.
  if (running.value || !failed.value) return "";
  if (props.turn.leading.some((message) => message.variant === "retry")) return "";
  return localizeError(props.turn.errorMessage ?? "");
});

/** The provider's own words, kept for the banner's tooltip. */
const failureRaw = computed(() => (props.turn.errorMessage ?? "").trim());

const canAct = computed(() => !session.isStreaming && props.turn.user?.timestamp != null);

/** `data:` URL for an image content block — the strip and the lightbox share it. */
function imageSrc(image: { mimeType: string; data: string }): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

function copyUserText(): void {
  post({ type: "copy", text: props.turn.user?.text ?? "" });
  overlays.toast(t("Copied"), "success");
}

function copyConclusion(): void {
  if (!conclusion.value) return;
  post({ type: "copy", text: conclusion.value });
  overlays.toast(t("Copied"), "success");
}

// ---- the turn's usage card ------------------------------------------------
//
// The chip in the closing line keeps the cache counters readable at a glance
// and opens the whole picture — input, output, both cache buckets, how many
// times pi was called and what it cost. Same card as the ring's readout, placed
// by hand for the same reason: the transcript scrolls, and a card anchored
// inside it would be clipped at the fold.

const usageOpen = ref(false);
const usageBtnEl = ref<HTMLElement | null>(null);
const usageCardEl = ref<HTMLElement | null>(null);
const usagePos = ref({ left: 0, top: 0 });
/** Gap between the chip and its card, and the viewport's own edge margin. */
const USAGE_CARD_GAP = 6;

async function toggleUsage(): Promise<void> {
  usageOpen.value = !usageOpen.value;
  if (!usageOpen.value) return;
  await nextTick();
  const btn = usageBtnEl.value;
  const card = usageCardEl.value;
  if (!btn || !card) return;
  const r = btn.getBoundingClientRect();
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  let left = r.left + r.width / 2 - cw / 2;
  if (left < 4) left = 4;
  else if (left + cw > window.innerWidth - 4) left = window.innerWidth - cw - 4;
  const above = r.top - ch - USAGE_CARD_GAP;
  usagePos.value = { left, top: above < 4 ? r.bottom + USAGE_CARD_GAP : above };
}

function closeUsage(): void {
  usageOpen.value = false;
}

function onDocumentMouseDown(ev: MouseEvent): void {
  if (!usageOpen.value) return;
  const target = ev.target as Node | null;
  if (!target) return;
  if (usageCardEl.value?.contains(target) || usageBtnEl.value?.contains(target)) return;
  closeUsage();
}

function onKeyDown(ev: KeyboardEvent): void {
  if (ev.key === "Escape") closeUsage();
}

/** The transcript scrolls under a fixed card, so the card goes with it. */
const transcript = () => document.getElementById("messages");

onMounted(() => {
  document.addEventListener("mousedown", onDocumentMouseDown);
  document.addEventListener("keydown", onKeyDown);
  transcript()?.addEventListener("scroll", closeUsage, { passive: true });
});

onUnmounted(() => {
  document.removeEventListener("mousedown", onDocumentMouseDown);
  document.removeEventListener("keydown", onKeyDown);
  transcript()?.removeEventListener("scroll", closeUsage);
});

async function forkTurn(): Promise<void> {
  const ts = props.turn.user?.timestamp;
  if (!canAct.value || ts == null) {
    if (ts == null) overlays.toast(t("Message not ready yet."), "info");
    return;
  }
  const accepted = await overlays.askConfirmation(
    t("Fork from this message?"),
    t("Create a new branch from this message. Current file changes are kept."),
    t("Fork"),
  );
  if (accepted) post({ type: "fork", ts });
}
</script>

<template>
  <!-- `data-turn-id` is the rail's anchor: it is how a mark finds the row it
       jumps to and how the rail tells which prompt is at the top of the view. -->
  <div v-if="turn.user" class="msg user" :data-turn-id="turn.id">
    <div class="bubble user-bubble">
      <div v-if="turn.user.images.length" class="bubble-imgs">
        <img
          v-for="(image, index) in turn.user.images"
          :key="index"
          :src="imageSrc(image)"
          :alt="turn.user.text || ''"
          @click.stop="
            overlays.openLightbox(
              turn.user.images.map((img) => ({
                src: imageSrc(img),
                alt: turn.user?.text || undefined,
              })),
              index,
            )
          "
        />
      </div>
      <div v-if="turn.user.text" class="user-text">{{ turn.user.text }}</div>
    </div>
    <div class="msg-meta">
      <div class="bubble-actions">
        <button class="icon-btn" type="button" :title="t('Copy')" @click="copyUserText">
          <span class="codicon codicon-copy"></span>
        </button>
      </div>
      <span v-if="turn.user.timestamp" class="msg-time">{{ formatTime(turn.user.timestamp) }}</span>
    </div>
  </div>

  <div v-for="message in turn.leading" :key="message.id" class="system-row">
    <!-- Compaction reads as a divider: 「正在压缩」 while it runs (the label
         pulses), 「已完成压缩」 once done — clicking that one opens the summary.
         No glyph: the label is the whole row, the loading below it stays the
         transcript's own status row. -->
    <details v-if="message.variant === 'compaction'" class="compaction-divider">
      <summary
        class="compaction-divider-label"
        :class="{ 'is-running': !message.text }"
        :title="message.text || undefined"
      >
        <span>{{ message.text ? t("Context compacted") : t("Compacting") }}</span>
      </summary>
      <div v-if="message.text" class="compaction-summary-body">{{ message.text }}</div>
    </details>
    <div v-else class="error-banner">
      {{
        t(
          "Error: Retry failed after {0} attempts: {1}",
          message.attempt ?? 0,
          localizeError(message.text),
        )
      }}
    </div>
  </div>

  <!-- `chatCollapseWork: false` drops the fold entirely: the work blocks render
       in the clear, in their original order, as if nothing had been grouped. -->
  <template v-if="turn.workBlocks.length">
    <!-- While the turn runs its fold stays open, so the steps are watchable as they
         happen and the head's live counter is actually on screen; it falls shut
         when the turn settles, leaving 已处理 · <answer>. -->
    <details v-if="display.collapseWork" class="work-block" :open="running">
      <summary class="work-head">
        <span>{{ workTitle }}</span>
        <span v-if="counts" class="work-counts">
          <span v-if="turn.added > 0" style="color: var(--pi-success)">+{{ turn.added }}</span>
          <span v-if="turn.added > 0 && turn.removed > 0"> </span>
          <span v-if="turn.removed > 0" style="color: var(--pi-danger)">-{{ turn.removed }}</span>
        </span>
      </summary>
      <div class="work-body">
        <!-- 每一步都是一行，同缩进、同级 —— 连续的工具调用也一样：不再有组、不再有
             第二层折叠，也不再有「执行工具 N 次」那行计数（彬哥：都平铺了，几次一眼
             就看得出来）。 -->
        <div v-for="entry in turn.workBlocks" :key="entry.block.id" class="msg assistant">
          <BlockView :block="entry.block" />
        </div>
      </div>
    </details>

    <template v-else>
      <div v-for="entry in turn.workBlocks" :key="entry.block.id" class="msg assistant">
        <BlockView :block="entry.block" />
      </div>
    </template>
  </template>

  <div v-for="entry in turn.finalBlocks" :key="entry.block.id" class="msg assistant">
    <BlockView :block="entry.block" />
  </div>

  <!-- Where a stopped reply ends. This is the one thing the closing status line
       cannot say on its own: 「已停止」 is a word in a row of counters, and the
       reply above it still reads as a whole answer. -->
  <div v-if="stopped" class="aborted-notice">
    {{ t("pi's reply was stopped by you.") }}
  </div>

  <!-- Where a failed run says why: a run that dies before its first block has no
       head and no status word, so this is the only place its reason can appear. -->
  <div
    v-if="failureText"
    class="error-banner"
    :title="failureRaw && failureRaw !== failureText ? failureRaw : undefined"
  >
    {{ failureText }}
  </div>

  <!-- What this turn changed on disk, as the last thing under its answer: the
       files are the turn's result, the status line below is its chrome. -->
  <TurnFilesCard :changes="changes" />

  <!-- Every settled turn closes with its own status line. The order is 彬哥's
       (2026-09-22): 复制 · 用量明细 · fork, then the timestamp — three icons the
       same size plus the time, nothing else. The duration and the outcome live
       on the fold head instead; the failure word stays here only for the turns
       with no head at all (folding off, or nothing folded), which would
       otherwise say nothing about it.
       Forking belongs here, not on the user bubble: a turn is only a branch
       point once the answer has landed. -->
  <div v-if="turn.messageTime && !running" class="msg-meta msg-status-line">
    <span v-if="hasContent && settledOutcome && !hasFoldHead" class="msg-outcome">
      {{ settledOutcome }}
    </span>
    <button
      v-if="conclusion"
      class="icon-btn status-action"
      type="button"
      :title="t('Copy the conclusion')"
      @click="copyConclusion"
    >
      <span class="codicon codicon-copy"></span>
    </button>
    <button
      v-if="turnUsage"
      ref="usageBtnEl"
      class="icon-btn status-action usage-action"
      :class="{ 'is-open': usageOpen }"
      type="button"
      :title="turnUsage.full"
      :aria-expanded="usageOpen"
      @click="toggleUsage"
    >
      <span class="codicon codicon-pie-chart"></span>
    </button>
    <button
      v-if="turn.user?.timestamp != null && !session.unsupportedCommands.includes('fork')"
      class="icon-btn status-action"
      type="button"
      :title="t('Fork')"
      @click="forkTurn"
    >
      <span class="codicon codicon-repo-forked"></span>
    </button>
    <span class="msg-time">{{ formatTime(turn.messageTime) }}</span>
  </div>

  <!-- The chip's own card. Fixed-positioned and last in the turn so it is never
       clipped by the fold; `v-show` keeps it measured for the placement above. -->
  <div
    v-show="usageOpen"
    ref="usageCardEl"
    class="usage-popup"
    role="dialog"
    :style="{ left: usagePos.left + 'px', top: usagePos.top + 'px' }"
  >
    <div v-for="row in usageRows" :key="row.label" class="usage-row">
      <span>{{ row.label }}</span>
      <span class="usage-row-value">{{ row.value }}</span>
    </div>
  </div>
</template>
