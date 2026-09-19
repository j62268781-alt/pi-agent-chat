<!--
  A `questionnaire` call as it lands in the transcript: the questions that were
  asked and the option that was picked, numbered the way the tool reports them.

  The whole choice set is kept rather than only the winner — "2 of 4" is what
  makes a decision readable later — with the picked row carrying the accent.
-->
<script setup lang="ts">
import { t } from "@/lib/i18n.ts";
import { answerFor, type QuestionnaireResult } from "@/lib/questionnaire.ts";

const props = defineProps<{ result: QuestionnaireResult }>();
</script>

<template>
  <div class="qa-card">
    <p v-if="props.result.cancelled" class="qa-card-cancelled">{{ t("Cancelled") }}</p>
    <div v-for="question in props.result.questions" :key="question.id" class="qa-card-question">
      <p class="qa-card-prompt">{{ question.prompt }}</p>
      <ol class="qa-card-options">
        <li
          v-for="(option, index) in question.options"
          :key="option.label"
          class="qa-card-option"
          :class="{ 'is-picked': answerFor(props.result, question)?.index === index + 1 }"
        >
          <span class="qa-num">{{ index + 1 }}</span>
          <span class="qa-label">{{ option.label }}</span>
        </li>
        <li
          v-if="answerFor(props.result, question)?.wasCustom"
          class="qa-card-option is-picked"
        >
          <span class="qa-num codicon codicon-edit" aria-hidden="true"></span>
          <span class="qa-label">{{ answerFor(props.result, question)?.label }}</span>
        </li>
      </ol>
    </div>
  </div>
</template>
