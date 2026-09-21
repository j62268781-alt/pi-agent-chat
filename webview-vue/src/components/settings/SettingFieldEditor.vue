<!--
  One settings.json field. The control follows `SettingField.type`: a checkbox
  for bools, a select for enums, a number box, a one-per-line textarea for
  arrays, a JSON textarea, or a plain text input.

  The label is rendered above the control for every type except `bool`, where it
  belongs to the checkbox itself — same nesting as the legacy `fieldHtml`.
-->
<script setup lang="ts">
import { computed } from "vue";
import { t } from "@/lib/i18n.ts";
import type { EditorValue, SettingField } from "./general-fields.ts";

const props = withDefaults(
  defineProps<{
    field: SettingField;
    /** Values the host just reported for this field, e.g. the model ids. */
    suggestions?: string[];
  }>(),
  { suggestions: () => [] },
);
const value = defineModel<EditorValue>({ required: true });

/** Every control except the checkbox binds to the string form. */
const text = computed(() => (typeof value.value === "string" ? value.value : ""));

/**
 * Typed something the registry does not list. A warning, never a block: the
 * registry can be empty (no auth) or miss a gateway added since it last
 * refreshed, and pi accepts the value either way.
 */
const unmatched = computed(
  () =>
    props.suggestions.length > 0 && text.value !== "" && !props.suggestions.includes(text.value),
);

function onText(event: Event): void {
  value.value = (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
}

function onCheck(event: Event): void {
  value.value = (event.target as HTMLInputElement).checked;
}
</script>

<template>
  <div class="cfg-field">
    <label v-if="field.type === 'bool'" class="check-label">
      <input type="checkbox" :checked="value === true" @change="onCheck" />
      {{ field.label }}
    </label>

    <template v-else>
      <label class="field-label">{{ field.label }}</label>

      <select v-if="field.type === 'enum'" :value="text" @change="onText">
        <option v-for="(option, index) in field.options ?? []" :key="option" :value="option">
          {{ field.optionLabels?.[index] ?? option }}
        </option>
      </select>

      <input
        v-else-if="field.type === 'number'"
        type="number"
        :value="text"
        :min="field.min"
        :max="field.max"
        @input="onText"
      />

      <textarea
        v-else-if="field.type === 'string[]'"
        class="ta"
        rows="3"
        spellcheck="false"
        :value="text"
        @input="onText"
      ></textarea>

      <textarea
        v-else-if="field.type === 'json'"
        class="ta"
        rows="4"
        spellcheck="false"
        :value="text"
        @input="onText"
      ></textarea>

      <input
        v-else
        :value="text"
        :placeholder="field.placeholder"
        :class="{ 'field-unmatched': unmatched }"
        :list="suggestions.length ? `${field.key}-suggest` : undefined"
        @input="onText"
      />
      <datalist v-if="suggestions.length" :id="`${field.key}-suggest`">
        <option v-for="option in suggestions" :key="option" :value="option"></option>
      </datalist>
    </template>

    <div v-if="field.desc" class="cfg-desc">{{ field.desc }}</div>
    <div v-if="unmatched" class="field-warning">{{ t("Unrecognized value") }}</div>
  </div>
</template>
