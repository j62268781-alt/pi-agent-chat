<!--
  Chat webview page: layout plus the host link.

  The transcript scrolls, the composer is pinned at the bottom, and the rewind /
  widget cards sit between them — the same vertical order the legacy
  `index.html` used, so `chat.css` applies unchanged. The queue is the one
  exception: it floats above the input inside the composer's dock, so a queued
  message never pushes the transcript up.
-->
<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import BootSplash from "@/components/BootSplash.vue";
import ChatToolbar from "@/components/ChatToolbar.vue";
import Composer from "@/components/Composer.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import Overlays from "@/components/Overlays.vue";
import Lightbox from "@/components/Lightbox.vue";
import QueuePanel from "@/components/QueuePanel.vue";
import RewindWidget from "@/components/RewindWidget.vue";
import TranscriptView from "@/components/TranscriptView.vue";
import { useHostLink } from "@/composables/useHostLink.ts";
import { useComposerStore } from "@/stores/composer";
import { useOverlaysStore } from "@/stores/overlays";
import { usePendingStore } from "@/stores/pending";
import "@/styles/chat.css";

const { connect } = useHostLink();
const composer = useComposerStore();
const overlays = useOverlaysStore();
const pending = usePendingStore();

let detach: (() => void) | undefined;

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (overlays.confirmState) {
    overlays.settleConfirmation(false);
    return;
  }
  composer.closePopups();
}

onMounted(() => {
  // Recover any queue left over from a webview reload before the host starts
  // pushing session content.
  pending.restore();
  detach = connect();
  document.addEventListener("keydown", onKeyDown);
});

onUnmounted(() => {
  detach?.();
  document.removeEventListener("keydown", onKeyDown);
});
</script>

<template>
  <BootSplash />

  <div class="app">
    <ChatToolbar />
    <TranscriptView />
    <RewindWidget />
    <!-- Positioning context for the floating queue — see `.composer-dock`. -->
    <div class="composer-dock">
      <QueuePanel />
      <Composer />
    </div>
  </div>

  <Overlays />
  <ConfirmDialog />
  <Lightbox />
</template>
