<!--
  The scrolling transcript.

  Scroll policy matches the legacy behaviour: the view sticks to the bottom
  while the user is already there, and detaches as soon as they scroll up, with
  a button to jump back down.
-->
<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import { useTranscriptStore } from "@/stores/transcript";
import TurnBlock from "./TurnBlock.vue";

const transcript = useTranscriptStore();

const scroller = ref<HTMLElement | null>(null);
const inner = ref<HTMLElement | null>(null);
const stuck = ref(true);

/** Distance from the bottom within which the view is considered "at bottom". */
const STICK_THRESHOLD_PX = 48;

let observer: ResizeObserver | undefined;

function onScroll(): void {
  const el = scroller.value;
  if (!el) return;
  stuck.value = el.scrollTop + el.clientHeight >= el.scrollHeight - STICK_THRESHOLD_PX;
}

async function scrollToBottom(): Promise<void> {
  await nextTick();
  const el = scroller.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  stuck.value = true;
}

function openHistory(): void {
  if (transcript.historyLoaded || transcript.historyLoading) return;
  transcript.historyLoading = true;
  post({ type: "requestHistory" });
}

onMounted(() => {
  const el = scroller.value;
  if (el) {
    el.addEventListener("scroll", onScroll, { passive: true });
    observer = new ResizeObserver(() => {
      if (stuck.value) void scrollToBottom();
    });
    if (inner.value) observer.observe(inner.value);
  }
});

onUnmounted(() => {
  scroller.value?.removeEventListener("scroll", onScroll);
  observer?.disconnect();
});

// New turns and streaming deltas both grow the content; `inner` drives the observer.
watch(
  () => transcript.turns.length,
  () => {
    if (stuck.value) void scrollToBottom();
  },
);
</script>

<template>
  <div class="messages-wrap">
    <div ref="scroller" id="messages">
      <div ref="inner" id="messages-inner">
        <details
          v-if="transcript.historyAvailable && !transcript.historyLoaded"
          class="history-block"
          @toggle="($event.target as HTMLDetailsElement).open && openHistory()"
        >
          <summary>
            <span class="history-label">{{ t("Show earlier compacted messages") }}</span>
          </summary>
          <div class="history-body">
            <div v-if="transcript.historyLoading" class="history-loading">
              {{ t("Loading history…") }}
            </div>
          </div>
        </details>

        <div v-if="transcript.isEmpty" class="empty-state">
          <p class="empty-title">{{ t("Ask anything…  (use / for commands, @ for files)") }}</p>
        </div>

        <TurnBlock v-for="turn in transcript.turns" :key="turn.id" :turn="turn" />
      </div>
    </div>

    <button
      v-if="!stuck"
      id="scroll-bottom-btn"
      type="button"
      :title="t('Scroll to bottom')"
      @click="scrollToBottom"
    >
      <span class="codicon codicon-arrow-down"></span>
    </button>
  </div>
</template>
