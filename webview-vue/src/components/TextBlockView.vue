<!--
  One `text` content block.

  Answers render in full. This used to clamp anything past 360px behind a Show
  more / Show less toggle, which hid the end of an answer — the part that
  carries the conclusion — behind a click, and the transcript already scrolls.
-->
<script setup lang="ts">
import type { TextBlock } from "@/stores/transcript";
import MarkdownBlock from "./MarkdownBlock.vue";

defineProps<{ block: TextBlock }>();
</script>

<template>
  <div class="text-block">
    <MarkdownBlock :source="block.markdown" :streaming="block.streaming" />
  </div>
</template>
