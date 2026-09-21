<!--
  One user request and everything the agent did in response.

  The legacy code built this by moving already-rendered sibling nodes into a
  `<details>` at the end of a turn (`wrapWorkSegment`); here the fold is a
  derived structure, so it re-folds correctly while streaming.
-->
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { post } from "@/lib/bridge.ts";
import { formatCounts, formatDuration, formatTime, formatTokens } from "@/lib/format.ts";
import { t } from "@/lib/i18n.ts";
import { aggregateUsage, formatUsage } from "@/lib/usage.ts";
import { useDisplayStore } from "@/stores/display";
import { useOverlaysStore } from "@/stores/overlays";
import { useSessionStore } from "@/stores/session";
import type { Turn } from "@/stores/transcript";
import BlockView from "./BlockView.vue";

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

/** Outcome word of a settled turn, shared by the fold head and the status line. */
const outcome = computed(() => {
  if (props.turn.errorMessage) return t("failed");
  if (props.turn.stopReason === "aborted") return t("Stopped");
  return t("Processed");
});

const outcomeClass = computed(() => {
  if (props.turn.errorMessage) return "is-error";
  if (props.turn.stopReason === "aborted") return "is-warn";
  return "is-done";
});

/**
 * Fold header. The board keeps the head to one phrase: the outcome once the turn
 * is done, the elapsed time while it runs. Per-turn counters (turns, duration,
 * diff size) were dropped from the line — the diff counters still sit on the
 * right, and the closing status line carries the duration.
 */
const workTitle = computed(() => {
  if (!running.value) return outcome.value;
  const start = props.turn.workStartedAt ?? props.turn.user?.timestamp ?? now.value;
  return t("Running for {0}", formatDuration(Math.max(0, now.value - start)));
});

/** Wall-clock duration of the turn: the user's message to the last block. */
const turnDuration = computed(() => {
  const end = props.turn.messageTime;
  const start = props.turn.user?.timestamp ?? props.turn.workStartedAt;
  if (end == null || start == null || end < start) return "";
  return formatDuration(end - start);
});

/**
 * Cache counters for the whole turn — every assistant message in it, not just
 * the last one, because a turn that uses tools is several messages. Kept to the
 * two cache buckets on the line itself: a sidebar row has no room for the full
 * `↑12.3k ↓1.2k R8k W2k $0.0123`, which is what the span's hover title shows.
 */
const turnUsage = computed(() => {
  const messages = [...props.turn.workBlocks, ...props.turn.finalBlocks].map(
    (entry) => entry.message,
  );
  const totals = aggregateUsage(messages);
  const parts: string[] = [];
  if (totals.cacheRead) parts.push("R" + formatTokens(totals.cacheRead));
  if (totals.cacheWrite) parts.push("W" + formatTokens(totals.cacheWrite));
  if (parts.length === 0) return null;
  return { short: parts.join(" "), full: formatUsage(totals) };
});

/** The closing status line is only meaningful once the turn has content. */
const hasContent = computed(
  () => props.turn.workBlocks.length > 0 || props.turn.finalBlocks.length > 0,
);

const counts = computed(() => formatCounts(props.turn.added, props.turn.removed));

const canAct = computed(() => !session.isStreaming && props.turn.user?.timestamp != null);

/** `data:` URL for an image content block — the strip and the lightbox share it. */
function imageSrc(image: { mimeType: string; data: string }): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

function copyUserText(): void {
  post({ type: "copy", text: props.turn.user?.text ?? "" });
  overlays.toast(t("Copied"), "success");
}

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
  <div v-if="turn.user" class="msg user">
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
      {{ t("Error: Retry failed after {0} attempts: {1}", 0, message.text) }}
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

  <!-- Every settled turn closes with its own status line: outcome, duration and
       the timestamp. While the turn runs the head already counts the seconds, so
       the line stays out of the way until there is an outcome to report.
       Forking belongs here, not on the user bubble: a turn is only a branch
       point once the answer has landed. -->
  <div v-if="turn.messageTime && !running" class="msg-meta msg-status-line">
    <span v-if="hasContent" class="msg-outcome" :class="outcomeClass">{{ outcome }}</span>
    <span v-if="hasContent && turnDuration" class="msg-duration">
      {{ t("Worked for {0}", turnDuration) }}
    </span>
    <span v-if="turnUsage" class="msg-time" :title="turnUsage.full">{{ turnUsage.short }}</span>
    <span class="msg-time">{{ formatTime(turn.messageTime) }}</span>
    <button
      v-if="turn.user?.timestamp != null"
      class="icon-btn status-action"
      type="button"
      :title="t('Fork')"
      @click="forkTurn"
    >
      <span class="codicon codicon-repo-forked"></span>
    </button>
  </div>
</template>
