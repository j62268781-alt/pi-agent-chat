<!--
  Pending-message strip, resting on the composer's top edge.

  Two sources, deliberately:
  - the composer's own pending queue: every row has an id, so it can be steered,
    edited or deleted individually;
  - pi's own steering/follow-up queue: read-only, because pi reports it as bare
    strings with no handle. In practice it stays empty now that "queue" messages
    are held locally, so it only ever shows up if a pi extension enqueues
    something itself.

  The strip is exactly its rows — the panel title, the type badge and the
  timestamp the first version carried were all saying what the row already
  shows (彬哥: 对齐参考图，靠在 input 上、更小).
-->
<script setup lang="ts">
import { computed } from "vue";
import { t } from "@/lib/i18n.ts";
import { useComposerStore } from "@/stores/composer.ts";
import { useOverlaysStore } from "@/stores/overlays.ts";
import { usePendingStore } from "@/stores/pending.ts";
import { useTranscriptStore } from "@/stores/transcript.ts";

const pending = usePendingStore();
const overlays = useOverlaysStore();
const transcript = useTranscriptStore();

const hostSteering = computed(() => transcript.queue.steering);
const hostFollowUp = computed(() => transcript.queue.followUp);
const hasAny = computed(
  () => !pending.isEmpty || hostSteering.value.length > 0 || hostFollowUp.value.length > 0,
);

/**
 * Pull a queued message back into the composer to change it. A draft that is
 * already there is kept — the queued text is appended, never swapped in over
 * what the user is typing.
 */
function edit(id: string): void {
  const item = pending.take(id);
  if (!item) return;
  const composer = useComposerStore();
  if (composer.draft.trim() === "") composer.setDraft(item.text);
  else composer.insert(item.text);
  if (item.images.length > 0) composer.addImages(item.images);
}

/** pi throws on a prompt while compaction runs, so the row stays where it is. */
function steer(id: string): void {
  if (!pending.steerNow(id)) overlays.toast(t("Context is being compacted"), "info");
}
</script>

<template>
  <div v-if="hasAny" id="queue" class="queue">
    <div v-for="item in pending.items" :key="item.id" class="queue-item is-pending">
      <span class="codicon codicon-indent queue-lead" aria-hidden="true"></span>
      <span class="queue-text" :title="item.text">{{ item.text }}</span>
      <span v-if="item.images.length > 0" class="queue-images">+{{ item.images.length }}</span>
      <div class="queue-actions">
        <button
          type="button"
          class="queue-action"
          :title="t('Send this now as a steering message')"
          @click="steer(item.id)"
        >
          <span class="codicon codicon-reply"></span>
          <span>{{ t("Steer") }}</span>
        </button>
        <button type="button" class="queue-action" :title="t('Edit')" @click="edit(item.id)">
          <span class="codicon codicon-edit"></span>
        </button>
        <button
          type="button"
          class="queue-action"
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
      <span class="queue-text" :title="text">{{ text }}</span>
    </div>

    <div
      v-for="(text, index) in hostFollowUp"
      :key="`follow-up-${index}`"
      class="queue-item is-host is-followup"
    >
      <span class="queue-badge">{{ t("Follow-up") }}</span>
      <span class="queue-text" :title="text">{{ text }}</span>
    </div>
  </div>
</template>
