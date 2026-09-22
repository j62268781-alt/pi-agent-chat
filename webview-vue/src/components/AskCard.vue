<!--
  The card both "ask" prompts are answered on: the permission gate's `ui.select`
  and the `questionnaire` extension's form.

  It floats over the composer rather than dimming the panel — the question is
  often "allow this command?", and answering it needs the transcript above to
  stay legible. The shape follows the reference card: the question on top with
  its pager, one numbered row per option, the free-form row last.

  Rows are buttons, so a pick is one click (the TUI answers on Enter the same
  way) — there is no separate confirm step to forget.
-->
<script setup lang="ts">
import { ref } from "vue";
import { t } from "@/lib/i18n.ts";

/** One selectable row. `hint` is the option's own explanation, greyed after it. */
export interface AskRow {
  key: string;
  label: string;
  hint?: string;
  picked?: boolean;
  /** Tints the row's marker on a permission prompt: allow vs deny. */
  tone?: "allow" | "block";
}

const props = defineProps<{
  title: string;
  rows: AskRow[];
  /** Body under the heading — the tool facts, or the command being gated. */
  message?: string;
  /** `1 / 2` pager, present only for a multi-question form. */
  step?: { index: number; total: number } | null;
  /** A safety decision: the heading carries the warning glyph. */
  danger?: boolean;
  /** The heading's ✕. What dismissing it means is the caller's call: on a
   *  permission prompt it is the denial, on a question a cancel — `closeLabel`
   *  is the tooltip that says which. */
  closable?: boolean;
  closeLabel?: string;
}>();

const emit = defineEmits<{
  pick: [index: number];
  prev: [];
  next: [];
  close: [];
}>();

const rootEl = ref<HTMLElement | null>(null);

/** Put the caret on the first row: the card is answered by keyboard too. */
function focusFirst(): void {
  rootEl.value?.querySelector<HTMLButtonElement>(".ask-row")?.focus();
}

defineExpose({ focusFirst });
</script>

<template>
  <div ref="rootEl" class="ask-card" role="dialog" aria-modal="true">
    <header class="ask-head">
      <span v-if="props.danger" class="codicon codicon-warning ask-warn" aria-hidden="true"></span>
      <p class="ask-title">{{ props.title }}</p>
      <span v-if="props.step" class="ask-pager">
        <button
          class="ask-page"
          type="button"
          :title="t('Back')"
          :disabled="props.step.index <= 1"
          @click="emit('prev')"
        >
          <span class="codicon codicon-chevron-left"></span>
        </button>
        <span class="ask-step">{{ props.step.index }} / {{ props.step.total }}</span>
        <button
          class="ask-page"
          type="button"
          :title="t('Next')"
          :disabled="props.step.index >= props.step.total"
          @click="emit('next')"
        >
          <span class="codicon codicon-chevron-right"></span>
        </button>
      </span>
      <button
        v-if="props.closable"
        class="ask-close"
        type="button"
        :title="props.closeLabel ?? t('Cancel')"
        @click="emit('close')"
      >
        <span class="codicon codicon-close"></span>
      </button>
    </header>

    <!-- pi's body is its own fact block (`label : value`), so it reads as code
         whatever the heading says; `danger` only picks the heading's glyph. -->
    <pre v-if="props.message" class="ask-pre">{{ props.message }}</pre>

    <ul class="ask-rows">
      <li v-for="(row, index) in props.rows" :key="row.key">
        <button
          class="ask-row"
          :class="{
            'is-picked': row.picked,
            'is-allow': row.tone === 'allow',
            'is-block': row.tone === 'block',
          }"
          type="button"
          @click="emit('pick', index)"
        >
          <span class="ask-num">{{ index + 1 }}</span>
          <!-- One text run, not two flex items: the option's label and its hint
               wrap into each other, the way a sentence does. Two columns squeezed
               「还原掉」 into one character per line. -->
          <span class="ask-text">
            <span class="ask-label">{{ row.label }}</span>
            <span v-if="row.hint" class="ask-hint">{{ row.hint }}</span>
          </span>
          <span class="codicon codicon-arrow-right ask-go" aria-hidden="true"></span>
        </button>
      </li>
    </ul>

    <div v-if="$slots.footer" class="ask-foot">
      <slot name="footer"></slot>
    </div>
  </div>
</template>
