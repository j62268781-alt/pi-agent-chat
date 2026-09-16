<!--
  The `/command` and `@file` suggestion dropdown.

  Anchored above the composer by `chat.css` (`.autocomplete { bottom: 100% }`),
  so it is rendered as a direct child of `.composer`. Command rows show three
  lines — `/name`, description, source — file rows show the basename plus the
  directory. Matched characters are wrapped in `<mark class="ac-hl">` the way the
  legacy `renderAutocomplete` did.
-->
<script setup lang="ts">
import { ref, watch } from "vue";

interface Suggestion {
  /** Raw value inserted on accept (`command.name` or a workspace path). */
  value: string;
  /** Row label: `/name` for commands, the basename for files. */
  name: string;
  detail?: string;
  source?: string;
  /** Indices into `name` that matched the query, for the highlight marks. */
  matches?: number[];
}

const props = defineProps<{ items: Suggestion[]; selected: number }>();
const emit = defineEmits<{ select: [index: number] }>();

const rootEl = ref<HTMLElement | null>(null);

/** Split the label into runs so the matched characters can be marked. */
function chunks(item: Suggestion): Array<{ text: string; hit: boolean }> {
  const matches = item.matches;
  if (!matches || matches.length === 0) return [{ text: item.name, hit: false }];
  const hits = new Set(matches);
  const runs: Array<{ text: string; hit: boolean }> = [];
  for (let i = 0; i < item.name.length; i++) {
    const hit = hits.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += item.name.charAt(i);
    else runs.push({ text: item.name.charAt(i), hit });
  }
  return runs;
}

watch(
  [() => props.selected, () => props.items],
  () => {
    const active = rootEl.value?.querySelector<HTMLElement>(".autocomplete-item.active");
    active?.scrollIntoView({ block: "nearest" });
  },
  { flush: "post" },
);

/** `mousedown` (not `click`) so accepting an item never blurs the composer. */
function onPick(index: number): void {
  emit("select", index);
}
</script>

<template>
  <div id="autocomplete" ref="rootEl" class="autocomplete">
    <div
      v-for="(item, index) in items"
      :key="item.value"
      class="autocomplete-item"
      :class="{ active: index === selected }"
      @mousedown.prevent="onPick(index)"
    >
      <div class="ac-name">
        <template v-for="(chunk, position) in chunks(item)" :key="position">
          <mark v-if="chunk.hit" class="ac-hl">{{ chunk.text }}</mark>
          <template v-else>{{ chunk.text }}</template>
        </template>
      </div>
      <div v-if="item.detail" class="ac-desc">{{ item.detail }}</div>
      <div v-if="item.source" class="ac-source">{{ item.source }}</div>
    </div>
  </div>
</template>
