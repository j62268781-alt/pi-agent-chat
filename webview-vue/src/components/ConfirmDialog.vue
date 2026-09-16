<!--
  Generic confirmation dialog: `overlays.askConfirmation()` parks a pending
  request in `confirmState` and awaits the boolean this dialog settles.

  Ported from the vanilla-TS bundle (`rewind.ts`: `showRewindConfirm`), which
  built the same `.overlay > .dialog` markup by hand. Clicking the backdrop or
  pressing Escape cancels.
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { t } from "@/lib/i18n.ts";
import { useOverlaysStore } from "@/stores/overlays.ts";

const overlays = useOverlaysStore();

const state = computed(() => overlays.confirmState);

function cancel(): void {
  overlays.settleConfirmation(false);
}

function confirm(): void {
  overlays.settleConfirmation(true);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && overlays.confirmState) cancel();
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div v-if="state" class="overlay" @click.self="cancel">
    <div class="dialog">
      <h3>{{ state.title || t("Confirm") }}</h3>
      <p>{{ state.body }}</p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-secondary" @click="cancel">{{ t("Cancel") }}</button>
        <button type="button" class="btn btn-primary" @click="confirm">
          {{ state.confirmLabel || t("Confirm") }}
        </button>
      </div>
    </div>
  </div>
</template>
