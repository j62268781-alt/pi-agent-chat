<!--
  The `questionnaire` extension's form, rendered as the composer's ask card.

  One question per page, with the pager in the heading (‹ 1 / 2 ›) — the TUI
  walks the same list the same way, and a single question never gets lost in a
  scroll. Picking a row answers and moves on (the TUI advances on Enter); the
  pager's ‹ steps back to change an answer, and the last row takes a typed one.
  Options stay numbered because that is how the tool reports the answer back
  ("user selected: 2. <label>").
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, useTemplateRef, watch } from "vue";
import AskCard, { type AskRow } from "@/components/AskCard.vue";
import { t } from "@/lib/i18n.ts";
import {
  OTHER_LABEL,
  pickOption,
  writeAnswer,
  type QuestionnaireAnswer,
  type QuestionnaireQuestion,
} from "@/lib/questionnaire.ts";

const props = defineProps<{ questions: QuestionnaireQuestion[] }>();
const emit = defineEmits<{ submit: [answers: QuestionnaireAnswer[]]; cancel: [] }>();

const picked = reactive<Record<string, QuestionnaireAnswer>>({});
const page = ref(0);
const customFor = ref<string | null>(null);
const customText = ref("");
const card = useTemplateRef<InstanceType<typeof AskCard>>("card");
const customEl = useTemplateRef<HTMLInputElement>("customEl");

const total = computed(() => props.questions.length);
const current = computed<QuestionnaireQuestion | undefined>(() => props.questions[page.value]);
const single = computed(() => total.value === 1);
const isLast = computed(() => page.value >= total.value - 1);
const customPicked = computed(() => isCustomPicked(current.value));
const otherText = computed(() =>
  customPicked.value ? (picked[current.value?.id ?? ""]?.label ?? "") : t(OTHER_LABEL),
);

/** The current page's rows, with the picked one carrying the accent. */
const rows = computed<AskRow[]>(() =>
  (current.value?.options ?? []).map((option) => ({
    key: option.label,
    label: option.label,
    hint: option.description,
    picked: pickedOption(current.value) === option.label,
  })),
);

/** Advance is the last page's "提交": the same button, two words. */
const advanceLabel = computed(() => (isLast.value ? t("Submit") : t("Next")));
const advanceDisabled = computed(() =>
  isLast.value ? !allAnswered() : !current.value || !hasAnswer(current.value),
);

function pickedOption(question: QuestionnaireQuestion | undefined): string {
  if (!question) return "";
  const answer = picked[question.id];
  return answer && !answer.wasCustom ? answer.label : "";
}

function isCustomPicked(question: QuestionnaireQuestion | undefined): boolean {
  return question ? picked[question.id]?.wasCustom === true : false;
}

function allAnswered(): boolean {
  return props.questions.every(hasAnswer);
}

/**
 * A question counts as answered once something is picked, or while its text box
 * is open — otherwise typing without pressing Enter would leave the advance
 * button disabled and strand the user on the page they are trying to leave.
 */
function hasAnswer(question: QuestionnaireQuestion): boolean {
  return picked[question.id] !== undefined || customFor.value === question.id;
}

function submit(): void {
  commitPendingCustom();
  if (!allAnswered()) return;
  emit(
    "submit",
    props.questions.map((question) => picked[question.id] as QuestionnaireAnswer),
  );
}

/** A typed answer the user left in the box counts, even if they never hit Enter. */
function commitPendingCustom(): void {
  const question = props.questions.find((entry) => entry.id === customFor.value);
  if (!question) return;
  picked[question.id] = writeAnswer(question, customText.value);
  customFor.value = null;
  customText.value = "";
}

function address(answer: QuestionnaireAnswer): void {
  const question = current.value;
  if (!question) return;
  picked[question.id] = answer;
  if (single.value) submit();
  else if (!isLast.value) go(1);
}

function choose(index: number): void {
  const question = current.value;
  if (question) address(pickOption(question, index));
}

function startCustom(): void {
  const question = current.value;
  if (!question) return;
  customFor.value = question.id;
  customText.value = "";
  void nextTick(() => customEl.value?.focus());
}

function commitCustom(): void {
  const question = current.value;
  if (!question) return;
  const answer = writeAnswer(question, customText.value);
  customFor.value = null;
  customText.value = "";
  address(answer);
}

function advance(): void {
  if (isLast.value) submit();
  else go(1);
}

function go(step: number): void {
  const next = page.value + step;
  if (next < 0 || next >= total.value) return;
  commitPendingCustom();
  page.value = next;
}

/** Focus the first row of the page, so the card stays keyboard-friendly. */
function focusFirst(): void {
  void nextTick(() => card.value?.focusFirst());
}

watch(page, focusFirst);
onMounted(focusFirst);
</script>

<template>
  <AskCard
    ref="card"
    :title="current?.prompt ?? ''"
    :rows="rows"
    :step="total > 1 ? { index: page + 1, total } : null"
    closable
    @pick="choose"
    @prev="go(-1)"
    @next="go(1)"
    @close="emit('cancel')"
  >
    <template #footer>
      <div class="ask-other" :class="{ 'is-picked': customPicked }">
        <span class="ask-num codicon codicon-edit" aria-hidden="true"></span>
        <input
          v-if="customFor === current?.id"
          ref="customEl"
          v-model="customText"
          class="ask-input"
          type="text"
          :placeholder="t('Your answer…')"
          @keydown.enter.prevent="commitCustom"
        />
        <button
          v-else-if="current?.allowOther"
          class="ask-other-open"
          type="button"
          @click="startCustom"
        >
          {{ otherText }}
        </button>
        <span v-else class="ask-other-gap"></span>
        <button
          class="ask-advance"
          type="button"
          :title="advanceLabel"
          :aria-label="advanceLabel"
          :disabled="advanceDisabled"
          @click="advance"
        >
          <span class="codicon codicon-arrow-up"></span>
        </button>
      </div>
    </template>
  </AskCard>
</template>
