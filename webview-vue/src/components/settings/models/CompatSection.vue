<!--
  Compatibility overrides for a provider or a model: two collapsible groups
  (OpenAI / Anthropic) of tri-state bools, selects and JSON blobs.

  The group that does not match the selected API protocol is hidden, and
  `serializeCompat()` (see `compat-fields.ts`) skips it on save — which is what
  lets a user flip protocols without clobbering the other group's overrides.

  Stateless: the enclosing editor owns the draft, so an invalid JSON blob
  survives its own edit and is only reported when the editor saves.
-->
<script setup lang="ts">
import { computed, reactive } from "vue";
import { t } from "@/lib/i18n.ts";
import {
  COMPAT_FIELDS,
  type CompatDraft,
  type CompatGroup,
  compatVisibility,
} from "./compat-fields.ts";

const props = defineProps<{
  /** Selected API protocol; `""` keeps both groups visible. */
  api: string;
}>();

const draft = defineModel<CompatDraft>({ required: true });

/** Collapsed by default, exactly like the legacy `renderCompatGroup` call. */
const open = reactive<Record<CompatGroup, boolean>>({ openai: false, anthropic: false });

const BOOL_OPTIONS = ["Default", "True", "False"] as const;

const visible = computed<CompatGroup[]>(() => {
  const flags = compatVisibility(props.api);
  return (["openai", "anthropic"] as CompatGroup[]).filter((group) => flags[group]);
});

const fieldsOf = (group: CompatGroup) => COMPAT_FIELDS.filter((field) => field.group === group);

function setField(name: string, value: string): void {
  draft.value = { ...draft.value, [name]: value };
}
</script>

<template>
  <div class="compat-wrap">
    <p class="compat-hint">
      {{ t("Choose per-field override: default clears the field so pi uses API defaults.") }}
    </p>
    <div v-for="group in visible" :key="group" class="cfg-group" :class="{ open: open[group] }">
      <div class="cfg-group-header" @click="open[group] = !open[group]">
        <span class="codicon codicon-chevron-down"></span>
        {{ group === "openai" ? t("OpenAI Compatibility") : t("Anthropic Compatibility") }}
      </div>
      <div class="cfg-group-body">
        <div v-if="fieldsOf(group).some((f) => f.type === 'bool')" class="compat-bools">
          <div
            v-for="field in fieldsOf(group).filter((f) => f.type === 'bool')"
            :key="field.name"
            class="compat-bool"
          >
            <span class="compat-bool-label" :title="field.name">{{ field.name }}</span>
            <select
              :value="draft[field.name] ?? 'Default'"
              @change="setField(field.name, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="option in BOOL_OPTIONS" :key="option" :value="option">
                {{ t(option) }}
              </option>
            </select>
          </div>
        </div>
        <template v-for="field in fieldsOf(group)" :key="field.name">
          <template v-if="field.type === 'select'">
            <label class="field-label">{{ field.name }}</label>
            <select
              :value="draft[field.name] ?? ''"
              @change="setField(field.name, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="option in field.options ?? []" :key="option" :value="option">
                {{ option === "" ? t("(default)") : option }}
              </option>
            </select>
          </template>
          <template v-else-if="field.type === 'json'">
            <label class="field-label">{{ field.name }} (JSON)</label>
            <textarea
              class="ta"
              style="height: 70px"
              spellcheck="false"
              placeholder="{}"
              :value="draft[field.name] ?? ''"
              @input="setField(field.name, ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>
