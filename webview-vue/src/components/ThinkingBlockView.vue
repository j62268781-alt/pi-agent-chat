<!--
  One `thinking` content block: a `<details>` that auto-opens while the model is
  reasoning and folds once the answer starts. A manual toggle sticks, so the
  user's collapse is never undone by the next delta.
-->
<script setup lang="ts">
import { ref, watch } from "vue";
import { t } from "@/lib/i18n.ts";
import type { ThinkingBlock } from "@/stores/transcript";

const props = defineProps<{ block: ThinkingBlock }>();

const open = ref(props.block.open);
/** Set once the user touches the summary; from then on `running` is ignored. */
const pinnedByUser = ref(false);

watch(
  () => props.block.running,
  (running) => {
    if (pinnedByUser.value) return;
    open.value = running;
  },
  { immediate: true },
);

watch(
  () => props.block.text,
  () => {
    if (!pinnedByUser.value && props.block.running) open.value = true;
  },
);
</script>

<template>
  <details class="thinking-block" :open="open" @toggle="pinnedByUser = true">
    <summary>
      <span class="thinking-label">{{ t("Thinking") }}</span>
    </summary>
    <div class="thinking-body">{{ block.text }}</div>
  </details>
</template>
