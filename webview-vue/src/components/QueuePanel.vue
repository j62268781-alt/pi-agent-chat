<!--
  Pending-message panel (`#queue` in the legacy markup), sitting between the
  transcript and the composer.

  Two sources, deliberately:
  - the composer's own pending queue: every row has an id, so it can be steered
    or deleted individually;
  - pi's own steering/follow-up queue: read-only, because pi reports it as bare
    strings with no handle. In practice it stays empty now that "queue" messages
    are held locally, so it only ever shows up if a pi extension enqueues
    something itself.
-->
<script setup lang="ts">
import { computed } from "vue";
import { post } from "@/lib/bridge.ts";
import { formatTime } from "@/lib/format.ts";
import { t } from "@/lib/i18n.ts";
import { usePendingStore } from "@/stores/pending.ts";
import { useTranscriptStore } from "@/stores/transcript.ts";

const pending = usePendingStore();
const transcript = useTranscriptStore();

const hostSteering = computed(() => transcript.queue.steering);
const hostFollowUp = computed(() => transcript.queue.followUp);
const hasAny = computed(
  () => !pending.isEmpty || hostSteering.value.length > 0 || hostFollowUp.value.length > 0,
);

function clearPending(): void {
  pending.clear();
}

function clearHostQueue(): void {
  post({ type: "clearQueue" });
}
</script>

<template>
  <div v-if="hasAny" id="queue" class="queue">
    <div class="queue-head">
      <span class="queue-title">{{ t("Pending") }}</span>
      <button
        v-if="!pending.isEmpty"
        type="button"
        class="queue-clear"
        :aria-label="t('Clear queued messages')"
        :title="t('Clear queued messages')"
        @click="clearPending"
      >
        <span class="codicon codicon-clear-all"></span>
      </button>
      <button
        v-else
        type="button"
        class="queue-clear"
        :aria-label="t('Clear queued messages')"
        :title="t('Clear queued messages')"
        @click="clearHostQueue"
      >
        <span class="codicon codicon-clear-all"></span>
      </button>
    </div>

    <div v-for="item in pending.items" :key="item.id" class="queue-item is-pending">
      <span class="codicon codicon-chevron-right queue-lead"></span>
      <div class="queue-text" :title="item.text">{{ item.text }}</div>
      <span v-if="item.images.length > 0" class="queue-badge">+{{ item.images.length }}</span>
      <span class="queue-time">{{ formatTime(item.createdAt) }}</span>
      <div class="queue-actions">
        <button
          type="button"
          class="icon-btn queue-action"
          :title="t('Send this now as a steering message')"
          @click="pending.steerNow(item.id)"
        >
          <span class="codicon codicon-send"></span>
          <span class="queue-action-label">{{ t("Steer") }}</span>
        </button>
        <button
          type="button"
          class="icon-btn queue-action"
          :title="t('Delete')"
          @click="pending.remove(item.id)"
        >
          <span class="codicon codicon-trash"></span>
        </button>
      </div>
    </div>

    <div
      v-for="(text, index) in hostSteering"
      :key="`steering-${index}`"
      class="queue-item is-host"
    >
      <span class="queue-badge">{{ t("Queued") }}</span>
      <div class="queue-text" :title="text">{{ text }}</div>
    </div>

    <div
      v-for="(text, index) in hostFollowUp"
      :key="`follow-up-${index}`"
      class="queue-item is-host is-followup"
    >
      <span class="queue-badge">{{ t("Follow-up") }}</span>
      <div class="queue-text" :title="text">{{ text }}</div>
    </div>
  </div>
</template>
