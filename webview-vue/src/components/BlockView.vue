<!--
  Dispatches one transcript block to its renderer. Keeping the switch in one
  place means the block union in `stores/transcript.ts` is the only thing that
  has to change when pi adds a content type.
-->
<script setup lang="ts">
import type { Block } from "@/stores/transcript";
import TextBlockView from "./TextBlockView.vue";
import ThinkingBlockView from "./ThinkingBlockView.vue";
import ToolCallView from "./ToolCallView.vue";

defineProps<{ block: Block; timestamp?: number | null }>();
</script>

<template>
  <TextBlockView v-if="block.kind === 'text'" :block="block" :timestamp="timestamp" />
  <ThinkingBlockView v-else-if="block.kind === 'thinking'" :block="block" />
  <ToolCallView v-else :block="block" />
</template>
