<!--
  One `text` content block.

  Long answers start collapsed (`is-collapsible`) with a Show more / Show less
  toggle, mirroring the legacy scroll-height heuristic. Renders as a fragment:
  the toggle and the timestamp are siblings of the block, as `chat.css` expects.
-->
<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { formatTime } from "@/lib/format.ts";
import { t } from "@/lib/i18n.ts";
import type { TextBlock } from "@/stores/transcript";
import MarkdownBlock from "./MarkdownBlock.vue";

const props = defineProps<{ block: TextBlock; timestamp?: number | null }>();

const host = ref<HTMLElement | null>(null);
const collapsible = ref(false);
const expanded = ref(false);

/** Only fold answers taller than this; shorter ones read better open. */
const COLLAPSE_THRESHOLD_PX = 360;

async function measure(): Promise<void> {
  await nextTick();
  if (props.block.streaming) {
    collapsible.value = false;
    return;
  }
  collapsible.value = (host.value?.scrollHeight ?? 0) > COLLAPSE_THRESHOLD_PX;
}

onMounted(measure);
watch(() => [props.block.markdown, props.block.streaming], measure);
</script>

<template>
  <div
    ref="host"
    class="text-block"
    :class="{ 'is-collapsible': collapsible, 'is-expanded': expanded }"
  >
    <MarkdownBlock :source="block.markdown" :streaming="block.streaming" />
  </div>
  <button v-if="collapsible" class="expand-btn" type="button" @click="expanded = !expanded">
    {{ expanded ? t("Show less") : t("Show more") }}
  </button>
  <span v-if="timestamp" class="msg-time">{{ formatTime(timestamp) }}</span>
</template>
