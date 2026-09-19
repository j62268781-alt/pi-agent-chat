<!--
  One `thinking` content block: a `<details>` that auto-opens while the model is
  reasoning and folds once the answer starts. A manual toggle sticks, so the
  user's collapse is never undone by the next delta.

  The folded header reads like the board's row: a state glyph, the label
  (「思考中」/「已思考」) and the reasoning's first line as the preview. While the
  block is still streaming the text is moving under the cursor, so the preview
  keeps updating rather than freezing mid-word.
-->
<script setup lang="ts">
import { computed, watch } from "vue";
import { useFoldState } from "@/composables/useFoldState.ts";
import { t } from "@/lib/i18n.ts";
import type { ThinkingBlock } from "@/stores/transcript";
import { useDisplayStore } from "@/stores/display";

const props = defineProps<{ block: ThinkingBlock }>();

const display = useDisplayStore();

const fold = useFoldState(props.block.open);
const { open } = fold;

/** Characters of the reasoning kept in the folded header. */
const PREVIEW_MAX = 60;

const label = computed(() => (props.block.running ? t("Thinking…") : t("Thought")));

const preview = computed(() => {
  const line = (props.block.text.split("\n", 1)[0] ?? "").trim();
  if (!line) return "";
  return line.length > PREVIEW_MAX ? line.slice(0, PREVIEW_MAX) + "\u2026" : line;
});

watch(
  () => props.block.running,
  (running) => {
    // `expandThinking` keeps a finished block open instead of folding it away.
    fold.set(running || display.expandThinking);
  },
  { immediate: true },
);

watch(
  () => props.block.text,
  () => {
    if (props.block.running) fold.set(true);
  },
);
</script>

<template>
  <details
    class="thinking-block"
    :class="block.running ? 'is-running' : 'is-done'"
    :open="open"
    @toggle="fold.onToggle"
  >
    <summary>
      <span
        class="row-state"
        :class="block.running ? 'is-running' : 'codicon codicon-check is-done'"
        aria-hidden="true"
      ></span>
      <span class="thinking-label">{{ label }}</span>
      <span v-if="preview" class="row-preview">{{ preview }}</span>
    </summary>
    <div class="thinking-body">{{ block.text }}</div>
  </details>
</template>
