<!--
  One user request and everything the agent did in response.

  The legacy code built this by moving already-rendered sibling nodes into a
  `<details>` at the end of a turn (`wrapWorkSegment`); here the fold is a
  derived structure, so it re-folds correctly while streaming.
-->
<script setup lang="ts">
import { computed } from "vue";
import { post } from "@/lib/bridge.ts";
import { formatCounts, formatDuration, formatTime, formatWorkTitle } from "@/lib/format.ts";
import { t } from "@/lib/i18n.ts";
import { useDisplayStore } from "@/stores/display";
import { useOverlaysStore } from "@/stores/overlays";
import { useSessionStore } from "@/stores/session";
import type { Turn } from "@/stores/transcript";
import BlockView from "./BlockView.vue";

const props = defineProps<{ turn: Turn }>();

const display = useDisplayStore();
const overlays = useOverlaysStore();
const session = useSessionStore();

/**
 * Outcome word of the turn, shared by the fold header and the closing status
 * line. `stopReason` is written by `message_end`, so it is the one signal that
 * says the assistant actually finished — a turn with no reason is still running.
 */
const outcome = computed(() => {
  if (props.turn.errorMessage) return t("failed");
  if (props.turn.stopReason === "aborted") return t("Stopped");
  if (props.turn.stopReason == null) return t("Working…");
  return t("Processed");
});

const outcomeClass = computed(() => {
  if (props.turn.errorMessage) return "is-error";
  if (props.turn.stopReason === "aborted") return "is-warn";
  if (props.turn.stopReason == null) return "is-running";
  return "is-done";
});

/**
 * The flow header's own title. The board's wording leads with the outcome and
 * the tool call count — "已处理 · 执行工具 5 次 · 3 Turns · Worked for 12s" —
 * because the fold is the only place either number is visible.
 */
const workTitle = computed(() => {
  const parts: string[] = [outcome.value];
  if (display.showToolCallCount) {
    const tools = props.turn.workBlocks.filter((entry) => entry.block.kind === "tool").length;
    if (tools > 0) parts.push(t("Ran {0} tools", tools));
  }
  parts.push(
    formatWorkTitle({
      turns: props.turn.workTurns,
      duration:
        props.turn.workStartedAt != null && props.turn.workEndedAt != null
          ? formatDuration(props.turn.workEndedAt - props.turn.workStartedAt)
          : "",
      added: 0,
      removed: 0,
    }),
  );
  return parts.join(" \u00b7 ");
});

/** Wall-clock duration of the turn: the user's message to the last block. */
const turnDuration = computed(() => {
  const end = props.turn.messageTime;
  const start = props.turn.user?.timestamp ?? props.turn.workStartedAt;
  if (end == null || start == null || end < start) return "";
  return formatDuration(end - start);
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

async function forkFromUser(): Promise<void> {
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

function revertToUser(): void {
  const ts = props.turn.user?.timestamp;
  if (!canAct.value || ts == null) {
    if (ts == null) overlays.toast(t("Message not ready yet."), "info");
    return;
  }
  post({ type: "revert", ts });
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
        <button class="icon-btn" type="button" :title="t('Fork')" @click="forkFromUser">
          <span class="codicon codicon-repo-forked"></span>
        </button>
        <button class="icon-btn" type="button" :title="t('Revert')" @click="revertToUser">
          <span class="codicon codicon-discard"></span>
        </button>
      </div>
      <span v-if="turn.user.timestamp" class="msg-time">{{ formatTime(turn.user.timestamp) }}</span>
    </div>
  </div>

  <div v-for="message in turn.leading" :key="message.id" class="system-row">
    <!-- Compaction reads as a divider: "正在压缩…" while it runs (pulsing icon),
         "已压缩上下文" once done — clicking that one opens the summary. -->
    <details v-if="message.variant === 'compaction'" class="compaction-divider">
      <summary
        class="compaction-divider-label"
        :class="{ 'is-running': !message.text }"
        :title="message.text || undefined"
      >
        <span class="codicon codicon-checklist"></span>
        <span>{{ message.text ? t("Context compacted") : t("Compacting…") }}</span>
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
    <details v-if="display.collapseWork" class="work-block">
      <summary class="work-head">
        <span>{{ workTitle }}</span>
        <span v-if="counts" class="work-counts">
          <span v-if="turn.added > 0" style="color: var(--pi-success)">+{{ turn.added }}</span>
          <span v-if="turn.added > 0 && turn.removed > 0"> </span>
          <span v-if="turn.removed > 0" style="color: var(--pi-danger)">-{{ turn.removed }}</span>
        </span>
      </summary>
      <div class="work-body">
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

  <!-- Every turn closes with its own status line: outcome, duration and the
       timestamp, the same `.msg-time` the user side uses. -->
  <div v-if="turn.messageTime" class="msg-meta msg-status-line">
    <span v-if="hasContent" class="msg-outcome" :class="outcomeClass">{{ outcome }}</span>
    <span v-if="hasContent && turnDuration" class="msg-duration">
      {{ t("Worked for {0}", turnDuration) }}
    </span>
    <span class="msg-time">{{ formatTime(turn.messageTime) }}</span>
  </div>
</template>
