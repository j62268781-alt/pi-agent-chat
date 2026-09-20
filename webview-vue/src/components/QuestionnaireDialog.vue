<!--
  The `questionnaire` extension's form, rendered in place of the raw JSON editor
  pi's generic `editor` request would otherwise show.

  One question per page, with Back/Next — the TUI walks the same list the same
  way, and a single question never gets lost in a scroll. Picking an option
  moves on (the TUI advances on Enter), and Back is there to change it.
  Options are numbered because that is how the tool reports the answer back
  ("user selected: 2. <label>").
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, useTemplateRef, watch } from "vue";
import { t } from "@/lib/i18n.ts";
import {
  OTHER_LABEL,
  pickOption,
  type QuestionnaireAnswer,
  type QuestionnaireQuestion,
  writeAnswer,
} from "@/lib/questionnaire.ts";

const props = defineProps<{ questions: QuestionnaireQuestion[] }>();
const emit = defineEmits<{ submit: [answers: QuestionnaireAnswer[]]; cancel: [] }>();

const picked = reactive<Record<string, QuestionnaireAnswer>>({});
const page = ref(0);
const customFor = ref<string | null>(null);
const customText = ref("");
const root = useTemplateRef<HTMLElement>("root");

const total = computed(() => props.questions.length);
const current = computed<QuestionnaireQuestion | undefined>(() => props.questions[page.value]);
const single = computed(() => total.value === 1);
const isLast = computed(() => page.value >= total.value - 1);
const currentAnswered = computed(() => (current.value ? hasAnswer(current.value) : false));

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
 * is open — otherwise typing without pressing Enter would leave Next disabled
 * and strand the user on the page they are trying to leave.
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
  void nextTick(() => root.value?.querySelector<HTMLInputElement>(".qa-input")?.focus());
}

function commitCustom(): void {
  const question = current.value;
  if (!question) return;
  const answer = writeAnswer(question, customText.value);
  customFor.value = null;
  customText.value = "";
  address(answer);
}

function go(step: number): void {
  const next = page.value + step;
  if (next < 0 || next >= total.value) return;
  commitPendingCustom();
  page.value = next;
}

/** Focus the first option of the page, so the dialog stays keyboard-friendly. */
function focusFirst(): void {
  void nextTick(() =>
    root.value?.querySelector<HTMLButtonElement>(".qa-question .qa-option")?.focus(),
  );
}

watch(page, focusFirst);
onMounted(focusFirst);
</script>

<template>
  <div ref="root" class="qa">
    <header v-if="total > 1" class="qa-head">
      <span class="qa-step">{{ page + 1 }} / {{ total }}</span>
      <span class="qa-dots" aria-hidden="true">
        <i
          v-for="(question, index) in props.questions"
          :key="question.id"
          class="qa-dot"
          :class="{ 'is-here': index === page, 'is-answered': picked[question.id] !== undefined }"
        ></i>
      </span>
      <span v-if="current" class="qa-label-head">{{ current.label }}</span>
    </header>

    <div v-if="current" class="qa-question">
      <p class="qa-prompt">{{ current.prompt }}</p>
      <ul class="qa-options">
        <li v-for="(option, index) in current.options" :key="option.label">
          <button
            class="qa-option"
            :class="{ 'is-picked': pickedOption(current) === option.label }"
            type="button"
            @click="choose(index)"
          >
            <span class="qa-num">{{ index + 1 }}</span>
            <span class="qa-label">{{ option.label }}</span>
            <span
              v-if="pickedOption(current) === option.label"
              class="codicon codicon-check qa-tick"
              aria-hidden="true"
            ></span>
          </button>
          <p v-if="option.description" class="qa-desc">{{ option.description }}</p>
        </li>
        <li v-if="current.allowOther">
          <button
            class="qa-option"
            :class="{ 'is-picked': isCustomPicked(current) }"
            type="button"
            @click="startCustom"
          >
            <span class="qa-num">{{ current.options.length + 1 }}</span>
            <span class="qa-label">{{ t(OTHER_LABEL) }}</span>
            <span
              v-if="isCustomPicked(current)"
              class="codicon codicon-check qa-tick"
              aria-hidden="true"
            ></span>
          </button>
          <input
            v-if="customFor === current.id"
            v-model="customText"
            class="dialog-input qa-input"
            type="text"
            :placeholder="t('Your answer…')"
            @keydown.enter.prevent="commitCustom"
          />
        </li>
      </ul>
    </div>

    <footer class="qa-actions">
      <button class="btn" type="button" @click="emit('cancel')">{{ t("Cancel") }}</button>
      <button v-if="total > 1 && page > 0" class="btn qa-back" type="button" @click="go(-1)">
        {{ t("Back") }}
      </button>
      <button
        v-if="!isLast"
        class="btn btn-primary"
        type="button"
        :disabled="!currentAnswered"
        @click="go(1)"
      >
        {{ t("Next") }}
      </button>
      <button
        v-else
        class="btn btn-primary"
        type="button"
        :disabled="!allAnswered()"
        @click="submit"
      >
        {{ t("Submit") }}
      </button>
    </footer>
  </div>
</template>
