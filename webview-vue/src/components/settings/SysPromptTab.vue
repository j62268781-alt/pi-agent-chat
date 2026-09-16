<!--
  System Prompt tab: the append file first, then the override.

  Both are plain markdown files under `~/.pi/agent/`; the override replaces pi's
  built-in prompt outright, which is why it carries a warning banner and comes
  second. The save buttons pick up the `.modified` state while the text differs
  from what was loaded, so an unsaved edit is visible at a glance.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { SysPromptTabData } from "@protocol/settings";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";

const props = defineProps<{ data: SysPromptTabData }>();
const store = useSettingsStore();

/** The text as last loaded or saved; the baseline for the `.modified` state. */
const originalAppend = ref(props.data.appendSystemPrompt.content ?? "");
const originalSystem = ref(props.data.systemPrompt.content ?? "");

const append = ref(originalAppend.value);
const system = ref(originalSystem.value);

const appendDirty = computed(() => append.value !== originalAppend.value);
const systemDirty = computed(() => system.value !== originalSystem.value);

/** Carries `<strong>` markup, so it is rendered with `v-html` — the translation
 * bundle is the only source, and it is ours. */
const overrideWarning = t(
  "⚠ <strong>Warning:</strong> This <strong>replaces</strong> Pi's built-in system prompt entirely and may significantly change Pi's behavior, tool usage, and safety guardrails. Prefer the Append section above unless you know what you're doing.",
);

function saveAppend(): void {
  store.markSaving();
  store.send({ type: "saveAppendSystemPrompt", content: append.value });
  originalAppend.value = append.value;
}

function saveSystem(): void {
  store.markSaving();
  store.send({ type: "saveSystemPrompt", content: system.value });
  originalSystem.value = system.value;
}

function resetAppend(): void {
  append.value = originalAppend.value;
}

function resetSystem(): void {
  system.value = originalSystem.value;
}
</script>

<template>
  <div class="tab-section">
    <h3>{{ t("System Prompt — Append") }}</h3>
    <p class="hint">{{ t("Appends to the default system prompt without replacing.") }}</p>
    <p class="hint">{{ t("File:") }} <code>~/.pi/agent/APPEND_SYSTEM.md</code></p>
    <textarea
      v-model="append"
      class="ta"
      spellcheck="false"
      :placeholder="t('(empty — nothing appended)')"
    ></textarea>
    <div class="btn-row">
      <button
        class="btn-primary"
        :class="{ modified: appendDirty }"
        type="button"
        @click="saveAppend"
      >
        <span class="codicon codicon-save"></span> {{ t("Save") }}
      </button>
      <button class="btn-secondary" type="button" :title="t('Reset')" @click="resetAppend">
        <span class="codicon codicon-discard"></span>
      </button>
      <button
        class="btn-secondary"
        type="button"
        :title="t('Open file')"
        @click="store.send({ type: 'openAppendSystemPromptFile' })"
      >
        <span class="codicon codicon-go-to-file"></span> {{ t("Open file") }}
      </button>
    </div>
  </div>

  <div class="tab-section">
    <h3>{{ t("System Prompt — Override") }}</h3>
    <div class="msg-warn" v-html="overrideWarning"></div>
    <p class="hint">{{ t("File:") }} <code>~/.pi/agent/SYSTEM.md</code></p>
    <textarea
      v-model="system"
      class="ta"
      spellcheck="false"
      :placeholder="t('(empty — using default system prompt)')"
    ></textarea>
    <div class="btn-row">
      <button
        class="btn-primary"
        :class="{ modified: systemDirty }"
        type="button"
        @click="saveSystem"
      >
        <span class="codicon codicon-save"></span> {{ t("Save") }}
      </button>
      <button class="btn-secondary" type="button" :title="t('Reset')" @click="resetSystem">
        <span class="codicon codicon-discard"></span>
      </button>
      <button
        class="btn-secondary"
        type="button"
        :title="t('Open file')"
        @click="store.send({ type: 'openSystemPromptFile' })"
      >
        <span class="codicon codicon-go-to-file"></span> {{ t("Open file") }}
      </button>
    </div>
  </div>
</template>
