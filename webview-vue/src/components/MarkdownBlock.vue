<!--
  Renders markdown and upgrades mermaid/KaTeX nodes after each change.

  The upgrade has to run after Vue has written the HTML, so it lives in a
  `watch` on the rendered string rather than in the template.
-->
<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { enhanceRendered, renderMarkdown } from "@/lib/markdown.ts";

const props = defineProps<{
  source: string;
  /** Adds `is-streaming` while deltas are still arriving (drives the caret). */
  streaming?: boolean;
}>();

const host = ref<HTMLElement | null>(null);

watch(
  () => props.source,
  async () => {
    await nextTick();
    // `.pi-mermaid` and `.pi-math` are left inert by markdown-it.
    if (host.value?.querySelector(".pi-mermaid, .pi-math")) {
      await enhanceRendered(host.value);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div
    ref="host"
    class="md-body"
    :class="{ 'is-streaming': streaming }"
    v-html="renderMarkdown(source)"
  ></div>
</template>
