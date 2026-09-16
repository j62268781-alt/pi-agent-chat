<!--
  Queued-message panel (`#queue` in the legacy markup): steering messages and
  follow-ups the host has accepted but not yet turned into a turn.

  Ported from the vanilla-TS bundle (`globals.ts`: `renderQueue`).
-->
<script setup lang="ts">
import { computed } from "vue";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import { useTranscriptStore } from "@/stores/transcript.ts";

const transcript = useTranscriptStore();

const steering = computed(() => transcript.queue.steering);
const followUp = computed(() => transcript.queue.followUp);

function clearQueue(): void {
  post({ type: "clearQueue" });
}
</script>

<template>
  <div v-if="steering.length > 0 || followUp.length > 0" class="queue">
    <button
      type="button"
      class="queue-clear"
      :aria-label="t('Clear queued messages')"
      :title="t('Clear queued messages')"
      @click="clearQueue"
    >
      <span class="codicon codicon-clear-all"></span>
    </button>

    <div v-for="(text, index) in steering" :key="`steering-${index}`" class="queue-item">
      <span class="queue-badge">{{ t("Queued") }}</span>
      <div class="queue-text" :title="text">{{ text }}</div>
    </div>

    <div
      v-for="(text, index) in followUp"
      :key="`follow-up-${index}`"
      class="queue-item is-followup"
    >
      <span class="queue-badge">{{ t("Follow-up") }}</span>
      <div class="queue-text" :title="text">{{ text }}</div>
    </div>
  </div>
</template>
