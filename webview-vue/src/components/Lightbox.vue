<!--
  Full-screen image preview. Opened from the transcript's image strip and the
  composer's attachment tray (`overlays.openLightbox`). Chrome: an × button
  top-right, ‹ › steppers on the sides when the batch has more than one image,
  and the zoom control pinned to the bottom. Closes on backdrop click or
  Escape; the picture and the controls don't propagate, so a stray click never
  dismisses it.

  Zoom resizes the image's LAYOUT box (not `transform`): a scaled `transform`
  never grows the scroll area, so a tall screenshot zoomed in could never be
  scrolled. With a real size the backdrop scrolls when the image overflows —
  its scrollbar is hidden globally, same as the image strip.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { t } from "@/lib/i18n.ts";
import { useOverlaysStore } from "@/stores/overlays.ts";

const overlays = useOverlaysStore();

/** Relative to the fit-to-screen size; resets whenever the image changes. */
const SCALE_MIN = 0.25;
const SCALE_MAX = 4;
const SCALE_STEP = 1.25;
const scale = ref(1);

const imgEl = ref<HTMLImageElement | null>(null);
/** The fit-to-screen size, captured once the image has decoded. */
const baseSize = ref<{ w: number; h: number } | null>(null);

const multi = computed(() => (overlays.lightbox?.items.length ?? 0) > 1);
const current = computed(() => overlays.lightbox?.items[overlays.lightbox.index] ?? null);
const scaleLabel = computed(() => `${Math.round(scale.value * 100)}%`);
const counterLabel = computed(
  () => `${overlays.lightbox!.index + 1}/${overlays.lightbox!.items.length}`,
);
const canZoomOut = computed(() => scale.value > SCALE_MIN + 0.001);
const canZoomIn = computed(() => scale.value < SCALE_MAX - 0.001);

/**
 * Real layout size at the current zoom. Before the first measurement the CSS
 * `max-*` constraints do the fitting; afterwards explicit dimensions take over
 * (`max-*` off, or a zoom > 1 would be clamped back).
 */
const imgStyle = computed(() => {
  const base = baseSize.value;
  if (!base) return undefined;
  return {
    width: `${Math.round(base.w * scale.value)}px`,
    height: `${Math.round(base.h * scale.value)}px`,
    maxWidth: "none",
    maxHeight: "none",
  };
});

function measure(): void {
  const el = imgEl.value;
  if (!el || !overlays.lightbox) return;
  if (el.clientWidth === 0 || el.clientHeight === 0) return; // not laid out yet
  baseSize.value = { w: el.clientWidth, h: el.clientHeight };
}

function zoomOut(): void {
  scale.value = Math.max(SCALE_MIN, scale.value / SCALE_STEP);
}

function zoomIn(): void {
  scale.value = Math.min(SCALE_MAX, scale.value * SCALE_STEP);
}

function onKey(ev: KeyboardEvent): void {
  if (!overlays.lightbox) return;
  if (ev.key === "Escape") overlays.closeLightbox();
  else if (ev.key === "ArrowLeft" && multi.value) overlays.stepLightbox(-1);
  else if (ev.key === "ArrowRight" && multi.value) overlays.stepLightbox(1);
}

watch(
  // A new image (new batch or a step) resets the zoom and the measurement.
  () => current.value?.src,
  async () => {
    scale.value = 1;
    baseSize.value = null;
    if (overlays.lightbox) {
      await nextTick();
      measure();
    }
  },
);

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div v-if="overlays.lightbox" id="lightbox" class="lightbox" @click="overlays.closeLightbox()">
    <button
      id="lightbox-close"
      class="lightbox-close"
      type="button"
      :title="t('Close')"
      @click.stop="overlays.closeLightbox()"
    >
      <span class="codicon codicon-close"></span>
    </button>

    <button
      v-if="multi"
      class="lightbox-nav lightbox-prev"
      type="button"
      :title="t('Previous image')"
      @click.stop="overlays.stepLightbox(-1)"
    >
      <span class="codicon codicon-chevron-left"></span>
    </button>
    <button
      v-if="multi"
      class="lightbox-nav lightbox-next"
      type="button"
      :title="t('Next image')"
      @click.stop="overlays.stepLightbox(1)"
    >
      <span class="codicon codicon-chevron-right"></span>
    </button>

    <img
      v-if="current"
      ref="imgEl"
      :key="current.src"
      :src="current.src"
      :alt="current.alt ?? ''"
      :title="current.alt"
      :style="imgStyle"
      @load="measure"
      @click.stop
    />

    <div class="lightbox-footer" @click.stop>
      <span v-if="multi" class="lightbox-count">{{ counterLabel }}</span>
      <div class="lightbox-zoom">
        <button type="button" :title="t('Zoom out')" :disabled="!canZoomOut" @click="zoomOut">
          <span class="codicon codicon-remove"></span>
        </button>
        <span class="lightbox-zoom-value">{{ scaleLabel }}</span>
        <button type="button" :title="t('Zoom in')" :disabled="!canZoomIn" @click="zoomIn">
          <span class="codicon codicon-add"></span>
        </button>
      </div>
    </div>
  </div>
</template>
