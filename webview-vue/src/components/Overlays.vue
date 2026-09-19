<!--
  Transient overlays: toasts, the modal dialog pi asks for through
  `extension_ui_request`, and the info panel.
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import QuestionnaireDialog from "@/components/QuestionnaireDialog.vue";
import { post } from "@/lib/bridge.ts";
import { renderMarkdown } from "@/lib/markdown.ts";
import { t } from "@/lib/i18n.ts";
import {
  parseQuestionnaireForm,
  type QuestionnaireAnswer,
  type QuestionnaireQuestion,
} from "@/lib/questionnaire.ts";
import { useOverlaysStore } from "@/stores/overlays";

const overlays = useOverlaysStore();

// ------------------------------------------------------------------ dialog

const dialogValue = ref("");

const dialogRequest = computed(() => overlays.dialog);

/**
 * pi's editor request carries its starting text as `prefill`; reading only
 * `defaultValue` (pi's internal name for "what a cancel resolves to") left every
 * editor dialog empty.
 */
function dialogPrefill(request: { [k: string]: unknown } | null): string {
  return String(request?.prefill ?? request?.defaultValue ?? "");
}

/**
 * The `questionnaire` extension asks through the same `editor` request, with the
 * form definition as the prefill. Recognising it here is what turns pi's generic
 * "edit this JSON" into a form — anything else still renders the plain field.
 */
const questionnaire = computed<QuestionnaireQuestion[] | null>(() => {
  const request = overlays.dialog;
  if (!request || request.method !== "editor") return null;
  return parseQuestionnaireForm(dialogPrefill(request));
});

watch(dialogRequest, () => {
  dialogValue.value = dialogPrefill(overlays.dialog);
});

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

/** The tool JSON.parses this string, so the shape has to stay `{answers}`. */
function submitQuestionnaire(answers: QuestionnaireAnswer[]): void {
  respondDialog({ value: JSON.stringify({ answers }), confirmed: true });
}

const dialogTitle = computed(() => String((overlays.dialog?.title as string | undefined) ?? ""));
const dialogMessage = computed(() =>
  String((overlays.dialog?.message as string | undefined) ?? ""),
);
const dialogOptions = computed<string[]>(() =>
  Array.isArray(overlays.dialog?.options) ? (overlays.dialog.options as string[]) : [],
);
/**
 * pi's permission gate asks via `ui.select(title, ["Allow", "Block"])` — a
 * safety decision that deserves real buttons, not a native `<select>`. Small
 * option sets (≤3) render as a button group; the negative choice ("Block")
 * is styled as the danger action so "allow" is never the accidental default.
 */
const isChoiceDialog = computed(
  () => overlays.dialog?.method === "select" && dialogOptions.value.length > 0,
);
const isDangerous = computed(() => /danger/i.test(dialogTitle.value));

/** Focus the first action button when a choice dialog opens. */
const actionsEl = ref<HTMLElement | null>(null);
watch(dialogRequest, async () => {
  if (!overlays.dialog) return;
  dialogValue.value = dialogPrefill(overlays.dialog);
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
  <div v-if="overlays.dialog" class="overlay">
    <div
      class="dialog"
      :class="{ 'dialog-danger': isDangerous, 'dialog-questionnaire': questionnaire }"
      role="dialog"
      aria-modal="true"
      :data-method="overlays.dialog.method"
      @keydown="onDialogKeydown"
    >
      <!-- The questionnaire brings its own heading and actions: its questions
           are the content, and "Pi Questionnaire Form" says nothing to a user. -->
      <QuestionnaireDialog
        v-if="questionnaire"
        :questions="questionnaire"
        @submit="submitQuestionnaire"
        @cancel="respondDialog({ cancelled: true })"
      />

      <template v-else>
        <h3 v-if="dialogTitle" class="dialog-title">
          <span v-if="isDangerous" class="codicon codicon-warning dialog-warn-icon"></span>
          <span class="dialog-title-text">{{ dialogTitle }}</span>
        </h3>
        <p v-if="dialogMessage" class="dialog-message">{{ dialogMessage }}</p>

        <select
          v-if="overlays.dialog.method === 'select' && !isChoiceDialog"
          v-model="dialogValue"
          class="dialog-select"
        >
          <option v-for="option in dialogOptions" :key="option" :value="option">
            {{ option }}
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

        <footer ref="actionsEl" class="dialog-actions" :class="{ 'choice-group': isChoiceDialog }">
          <template v-if="isChoiceDialog">
            <button
              v-for="(option, index) in dialogOptions"
              :key="option"
              class="btn choice-btn"
              :class="{
                'choice-allow': /allow|yes|accept/i.test(option),
                'choice-block':
                  /block|no|deny|cancel/i.test(option) || index === dialogOptions.length - 1,
              }"
              type="button"
              @click="respondDialog({ value: option, confirmed: true })"
            >
              {{ option }}
            </button>
          </template>
          <template v-else>
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
          </template>
        </footer>
      </template>
    </div>
  </div>
</template>
