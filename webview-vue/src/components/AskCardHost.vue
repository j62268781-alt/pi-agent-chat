<!--
  Where pi's two questions are answered.

  It sits in the composer's dock and floats over the input rather than dimming
  the panel: a permission prompt is decided by reading what the tool is about to
  do, so the transcript has to stay legible while the card is up. Everything
  else pi asks (a plain editor, a confirm, a typed value) still goes to the
  centred modal — see `Overlays`, which skips the requests this host takes.

  This component owns the response: the value that goes back over the wire is
  the option string pi sent, never the localized label shown on the row.
  Closing a choice card answers its deny option rather than cancelling the
  request — "I closed it" must read as "no", never as nothing (彬哥).
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, useTemplateRef, watch } from "vue";
import AskCard, { type AskRow } from "@/components/AskCard.vue";
import QuestionnaireDialog from "@/components/QuestionnaireDialog.vue";
import { askCardFrom } from "@/lib/ask-card.ts";
import { post } from "@/lib/bridge.ts";
import { dialogOptionLabel } from "@/lib/dialog-options.ts";
import { t } from "@/lib/i18n.ts";
import type { QuestionnaireAnswer } from "@/lib/questionnaire.ts";
import { useOverlaysStore } from "@/stores/overlays.ts";

/** pi words its own options; these two classify them, display never rewrites them. */
const ALLOW = /allow|yes|accept/i;
const DENY = /block|no|deny|cancel/i;

const overlays = useOverlaysStore();
const ask = computed(() => askCardFrom(overlays.dialog));
const choiceCard = useTemplateRef<InstanceType<typeof AskCard>>("choiceCard");

const choice = computed(() => (ask.value?.kind === "choice" ? ask.value : null));
const choiceTitle = computed(() => t(choice.value?.title ?? ""));
/** Read off pi's own title: a translated heading no longer matches /danger/. */
const danger = computed(() => /danger/i.test(choice.value?.title ?? ""));

/**
 * One row per option, in pi's order. The tone is the permission gate's safety
 * cue — allow rows carry the success ink, deny rows the danger one, so "let it
 * through" is never the row that reads as the default. The last option counts
 * as a deny: a two-option prompt is allow / block.
 */
const choiceRows = computed<AskRow[]>(() => {
  const options = choice.value?.options ?? [];
  return options.map((option, index) => ({
    key: option,
    label: dialogOptionLabel(option),
    tone: ALLOW.test(option)
      ? "allow"
      : DENY.test(option) || index === options.length - 1
        ? "block"
        : undefined,
  }));
});

/**
 * What dismissing the card answers. A permission prompt has no "no answer": the
 * denial `cancelled` would leave the run in a state pi's gate never described,
 * so close picks the first deny option (the plain "No" — "No, provide reason"
 * would open a second prompt) and falls back to the last option.
 */
const denyOption = computed(() => {
  const options = choice.value?.options ?? [];
  return options.find((option) => DENY.test(option)) ?? options.at(-1) ?? null;
});

function respond(payload: { value?: string; confirmed?: boolean; cancelled?: boolean }): void {
  const request = overlays.dialog;
  if (!request) return;
  overlays.dialog = null;
  post({ type: "dialogResponse", id: request.id, ...payload });
}

/** The tool JSON.parses this string, so the shape has to stay `{answers}`. */
function submitQuestionnaire(answers: QuestionnaireAnswer[]): void {
  respond({ value: JSON.stringify({ answers }), confirmed: true });
}

function pickOption(index: number): void {
  const option = choice.value?.options[index];
  if (option !== undefined) respond({ value: option, confirmed: true });
}

/** Dismissal. A question is cancelled; a safety decision is denied. */
function dismiss(): void {
  const deny = denyOption.value;
  if (deny !== null) respond({ value: deny, confirmed: true });
  else respond({ cancelled: true });
}

watch(
  () => overlays.dialog?.id,
  async (id) => {
    if (!id) return;
    await nextTick();
    choiceCard.value?.focusFirst();
  },
  { immediate: true },
);

/**
 * Escape is the ✕'s other half on either card — the modal's own handler is out
 * of reach from here, and on a permission prompt it has to mean the same thing
 * the button does, or the keyboard would answer "nothing" where the mouse
 * answers "no".
 */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !ask.value) return;
  event.preventDefault();
  dismiss();
}

onMounted(() => document.addEventListener("keydown", onKeyDown));
onUnmounted(() => document.removeEventListener("keydown", onKeyDown));
</script>

<template>
  <div v-if="ask" class="ask-dock">
    <QuestionnaireDialog
      v-if="ask.kind === 'questionnaire'"
      :questions="ask.questions"
      @submit="submitQuestionnaire"
      @cancel="respond({ cancelled: true })"
    />
    <AskCard
      v-else
      ref="choiceCard"
      :title="choiceTitle"
      :message="choice?.message"
      :danger="danger"
      :rows="choiceRows"
      closable
      :close-label="t('Deny')"
      @pick="pickOption"
      @close="dismiss"
    />
  </div>
</template>
