<!--
  Transient overlays: toasts, toasts' info panel, and the modal pi asks for
  through `extension_ui_request`.

  The two prompts that are *questions* — the permission gate's `ui.select` and
  the questionnaire's form — are not here: they are answered on the composer's
  own card (`AskCardHost`), and this component skips them so the two can never
  both draw.
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { askCardFrom, dialogPrefill } from "@/lib/ask-card.ts";
import { post } from "@/lib/bridge.ts";
import { dialogOptionLabel } from "@/lib/dialog-options.ts";
import { renderMarkdown } from "@/lib/markdown.ts";
import { t } from "@/lib/i18n.ts";
import { useOverlaysStore } from "@/stores/overlays";

const overlays = useOverlaysStore();

// ------------------------------------------------------------------ dialog

const dialogValue = ref("");

const dialogRequest = computed(() => overlays.dialog);

/** True while the request belongs to the ask card instead of this modal. */
const handledByCard = computed(() => askCardFrom(overlays.dialog) !== null);

function respondDialog(payload: {
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}): void {
  const request = overlays.dialog;
  if (!request) return;
  overlays.dialog = null;
  post({ type: "dialogResponse", id: request.id, ...payload });
}

const dialogTitle = computed(() => String((overlays.dialog?.title as string | undefined) ?? ""));
const dialogMessage = computed(() =>
  String((overlays.dialog?.message as string | undefined) ?? ""),
);
const dialogOptions = computed<string[]>(() =>
  Array.isArray(overlays.dialog?.options) ? (overlays.dialog.options as string[]) : [],
);

/** Display text only — the option itself is what goes back to pi. */
const optionLabels = computed(() => dialogOptions.value.map(dialogOptionLabel));
const isDangerous = computed(() => /danger/i.test(dialogTitle.value));

/** Seed the field and land the caret in the modal, when it is the modal's turn. */
const actionsEl = ref<HTMLElement | null>(null);
watch(dialogRequest, async () => {
  dialogValue.value = dialogPrefill(overlays.dialog);
  if (!overlays.dialog || handledByCard.value) return;
  await nextTick();
  actionsEl.value?.querySelector<HTMLElement>("button")?.focus();
});

function onDialogKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape") {
    ev.preventDefault();
    respondDialog({ cancelled: true });
  }
}

// ------------------------------------------------------------- info panel

function closeInfoPanel(): void {
  overlays.infoPanel = null;
}

// ----------------------------------------------------------- context menu
//
// Deleted with its store state: nothing in the transcript ever called
// `openContextMenu`, so the menu could not be opened, and it was the second
// place offering revert/fork once those moved onto the turn's status line.
</script>

<template>
  <!-- toasts -->
  <div id="toast-host">
    <div
      v-for="entry in overlays.toasts"
      :key="entry.id"
      class="toast"
      :class="`toast-${entry.kind}`"
      @click="overlays.dismissToast(entry.id)"
    >
      {{ entry.text }}
    </div>
  </div>

  <!-- info panel -->
  <div v-if="overlays.infoPanel" class="overlay" @click.self="closeInfoPanel">
    <div class="info-panel">
      <header class="info-panel-head">
        <span class="info-panel-title">{{ overlays.infoPanel.title }}</span>
        <button class="info-panel-close" type="button" :title="t('Close')" @click="closeInfoPanel">
          <span class="codicon codicon-close"></span>
        </button>
      </header>
      <div
        class="info-panel-body md-body"
        v-html="renderMarkdown(overlays.infoPanel.markdown)"
      ></div>
    </div>
  </div>

  <!-- dialog requested by pi -->
  <div v-if="overlays.dialog && !handledByCard" class="overlay">
    <div
      class="dialog"
      :class="{ 'dialog-danger': isDangerous }"
      role="dialog"
      aria-modal="true"
      :data-method="overlays.dialog.method"
      @keydown="onDialogKeydown"
    >
      <h3 v-if="dialogTitle" class="dialog-title">
        <span v-if="isDangerous" class="codicon codicon-warning dialog-warn-icon"></span>
        <span class="dialog-title-text">{{ dialogTitle }}</span>
      </h3>
      <p v-if="dialogMessage" class="dialog-message">{{ dialogMessage }}</p>

      <select
        v-if="overlays.dialog.method === 'select'"
        v-model="dialogValue"
        class="dialog-select"
      >
        <option v-for="(option, index) in dialogOptions" :key="option" :value="option">
          {{ optionLabels[index] }}
        </option>
      </select>

      <input
        v-else-if="overlays.dialog.method === 'input' || overlays.dialog.method === 'editor'"
        ref="actionsEl"
        v-model="dialogValue"
        class="dialog-input"
        type="text"
        @keydown.enter.prevent="respondDialog({ value: dialogValue, confirmed: true })"
      />

      <footer ref="actionsEl" class="dialog-actions">
        <button class="btn" type="button" @click="respondDialog({ cancelled: true })">
          {{ t("Cancel") }}
        </button>
        <button
          class="btn btn-primary"
          type="button"
          @click="
            respondDialog(
              overlays.dialog.method === 'confirm'
                ? { confirmed: true }
                : { value: dialogValue, confirmed: true },
            )
          "
        >
          {{ overlays.dialog.method === "confirm" ? t("Confirm") : t("OK") }}
        </button>
      </footer>
    </div>
  </div>
</template>
