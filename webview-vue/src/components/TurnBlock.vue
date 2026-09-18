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
 * The flow header's own title. When the display setting asks for it, the tool
 * call count leads the line ("Ran 5 tools · 3 Turns · Worked for 12s") — the
 * fold is the only place the count is visible, so it is worth the prefix.
 */
const workTitle = computed(() => {
  const title = formatWorkTitle({
    turns: props.turn.workTurns,
    duration:
      props.turn.workStartedAt != null && props.turn.workEndedAt != null
        ? formatDuration(props.turn.workEndedAt - props.turn.workStartedAt)
        : "",
    added: 0,
    removed: 0,
  });
  if (!display.showToolCallCount) return title;
  const tools = props.turn.workBlocks.filter((entry) => entry.block.kind === "tool").length;
  return tools > 0 ? t("Ran {0} tools", tools) + " \u00b7 " + title : title;
});

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

  <!-- Every turn closes with its own timestamp, same `.msg-time` on both sides
       (the user turn's sits after its action buttons). -->
  <div v-if="turn.messageTime" class="msg-meta">
    <span class="msg-time">{{ formatTime(turn.messageTime) }}</span>
  </div>
</template>
