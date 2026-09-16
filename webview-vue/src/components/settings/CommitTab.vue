<!--
  Commit Message tab: which model writes the message, which language it writes
  in, and an optional prompt override.

  These three live in VS Code configuration (not settings.json) because the SCM
  command reads them through the extension host.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { CommitTabData } from "@protocol/settings";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";
import SectionHeader from "./SectionHeader.vue";

const props = defineProps<{ data: CommitTabData }>();
const store = useSettingsStore();

const model = ref(props.data.commitModel ?? "");
const language = ref(props.data.commitLanguage || "English");
const prompt = ref(props.data.commitMessagePrompt ?? "");

/** The saved model stays selectable even when it is no longer in the registry. */
const modelOptions = computed(() => {
  const models = props.data.models ?? [];
  const extra = model.value && !models.includes(model.value) ? [model.value] : [];
  return [...models, ...extra];
});

function save(): void {
  store.markSaving();
  store.send({
    type: "saveCommitConfig",
    commitModel: model.value,
    commitLanguage: language.value,
    commitMessagePrompt: prompt.value,
  });
}
</script>

<template>
  <div class="tab-section">
    <SectionHeader :title="t('Commit Message')" />
    <div class="hint">
      {{ t("Settings are stored in VS Code configuration") }}
      (<code>pi-agent-chat.commitModel</code>, <code>pi-agent-chat.commitLanguage</code>,
      <code>pi-agent-chat.commitMessagePrompt</code>).
    </div>

    <div class="editor-card">
      <label class="field-label">{{ t("Model") }}</label>
      <select v-model="model">
        <option value="">{{ t("(default)") }}</option>
        <option v-for="entry in modelOptions" :key="entry" :value="entry">{{ entry }}</option>
      </select>
      <div class="hint">
        {{
          t(
            'Model used to generate Git commit messages, in "provider/model" format. Leave as (default) to use pi\'s default model.',
          )
        }}
      </div>

      <label class="field-label">{{ t("Language") }}</label>
      <select v-model="language">
        <option v-for="entry in props.data.languages" :key="entry" :value="entry">
          {{ entry }}
        </option>
      </select>
      <div class="hint">{{ t("Language for generated Git commit messages.") }}</div>

      <label class="field-label">{{ t("Custom prompt") }}</label>
      <textarea
        v-model="prompt"
        class="ta"
        style="height: 140px"
        spellcheck="false"
        :placeholder="
          t(
            'Custom system prompt for commit message generation. If empty, uses the default prompt.',
          )
        "
      ></textarea>

      <div class="btn-row">
        <button class="btn-primary" type="button" @click="save">
          <span class="codicon codicon-save"></span> {{ t("Save") }}
        </button>
      </div>
    </div>
  </div>
</template>
