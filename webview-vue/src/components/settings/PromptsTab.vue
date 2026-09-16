<!--
  Prompt Templates tab: the slash-command templates pi loads from
  `~/.pi/agent/prompts` and `.pi/prompts`, plus whatever packages and the CLI
  contribute.

  Prompt templates pi finds elsewhere are listed read-only — they have no
  writable scope, so `editable` is what decides whether Edit/Delete appear.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { PromptsTabData, PromptItem } from "@protocol/settings";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";
import ItemBadge from "./ItemBadge.vue";
import ItemRow from "./ItemRow.vue";
import ScopeSelect from "./ScopeSelect.vue";
import SectionHeader from "./SectionHeader.vue";

const props = defineProps<{ data: PromptsTabData }>();
const store = useSettingsStore();

const mode = ref<"list" | "new" | "edit">("list");
const editing = ref<PromptItem | null>(null);
const error = ref("");

const form = ref({ scope: "user", name: "", description: "", argumentHint: "", content: "" });

const hint = computed(() =>
  t(
    "Prompts are slash-command templates loaded by pi. Editable prompts live in <code>~/.pi/agent/prompts</code>{0}.",
    props.data.hasWorkspace ? t(" or <code>.pi/prompts</code>") : "",
  ),
);

/** `sourceLabel` is one of user/project/builtin/package/cli/other. */
function badgeVariant(label: string): string {
  return ["user", "project", "builtin", "package", "cli"].includes(label) ? label : "other";
}

function startNew(): void {
  editing.value = null;
  error.value = "";
  form.value = { scope: "user", name: "", description: "", argumentHint: "", content: "" };
  mode.value = "new";
}

function startEdit(prompt: PromptItem): void {
  editing.value = prompt;
  error.value = "";
  form.value = {
    scope: prompt.scope,
    name: prompt.name,
    description: prompt.description ?? "",
    argumentHint: prompt.argumentHint ?? "",
    content: prompt.content ?? "",
  };
  mode.value = "edit";
}

function toList(): void {
  mode.value = "list";
  editing.value = null;
}

function save(): void {
  const name = form.value.name.trim();
  if (!name) {
    error.value = t("Prompt name is required");
    return;
  }
  const payload = {
    name,
    description: form.value.description,
    argumentHint: form.value.argumentHint,
    content: form.value.content,
  };
  const current = editing.value;
  if (current) {
    store.send({ type: "updatePrompt", scope: current.scope, data: payload });
  } else {
    store.send({ type: "createPrompt", scope: form.value.scope, data: payload });
  }
  toList();
}
</script>

<template>
  <div v-if="mode === 'list'" class="tab-section">
    <SectionHeader :title="t('Prompt Templates')">
      <button class="btn-primary" type="button" @click="startNew">
        <span class="codicon codicon-add"></span> {{ t("New Prompt") }}
      </button>
    </SectionHeader>
    <div class="hint" v-html="hint"></div>
    <div class="item-list">
      <span v-if="props.data.prompts.length === 0" class="dim">{{ t("No prompts found.") }}</span>
      <ItemRow
        v-for="prompt in props.data.prompts"
        :key="prompt.name"
        :name="prompt.name"
        :description="prompt.description"
      >
        <template #badges>
          <ItemBadge :label="t(prompt.sourceLabel)" :variant="badgeVariant(prompt.sourceLabel)" />
          <ItemBadge v-if="prompt.argumentHint" :label="prompt.argumentHint" variant="stdio" />
        </template>
        <template #actions>
          <button
            v-if="prompt.editable"
            class="btn-icon"
            type="button"
            :title="t('Edit')"
            @click="startEdit(prompt)"
          >
            <span class="codicon codicon-edit"></span>
          </button>
          <button
            class="btn-icon"
            type="button"
            :title="t('Open file')"
            @click="store.send({ type: 'openPromptFile', filePath: prompt.filePath })"
          >
            <span class="codicon codicon-go-to-file"></span>
          </button>
          <button
            v-if="prompt.editable"
            class="btn-icon btn-danger"
            type="button"
            :title="t('Delete')"
            @click="store.send({ type: 'deletePrompt', name: prompt.name, scope: prompt.scope })"
          >
            <span class="codicon codicon-trash"></span>
          </button>
        </template>
      </ItemRow>
    </div>
  </div>

  <div v-else class="editor-card">
    <h3>{{ editing ? t("Edit: {0}", editing.name) : t("New Prompt") }}</h3>
    <div v-if="error" class="error">{{ error }}</div>

    <ScopeSelect
      v-if="!editing"
      v-model="form.scope"
      :has-workspace="props.data.hasWorkspace"
      :label="t('Scope')"
    />

    <label class="field-label">{{ t("Name") }}</label>
    <input v-model="form.name" placeholder="my-prompt" :disabled="!!editing" />

    <label class="field-label">{{ t("Description") }}</label>
    <input v-model="form.description" :placeholder="t('What this prompt does')" />

    <label class="field-label">{{ t("Argument hint") }}</label>
    <input v-model="form.argumentHint" placeholder="[question]" />

    <label class="field-label">{{ t("Content (template)") }}</label>
    <textarea v-model="form.content" class="ta" style="height: 220px" spellcheck="false"></textarea>

    <div class="btn-row">
      <button class="btn-primary" type="button" @click="save">
        <span class="codicon codicon-save"></span> {{ t("Save") }}
      </button>
      <button class="btn-secondary" type="button" :title="t('Cancel')" @click="toList">
        <span class="codicon codicon-close"></span>
      </button>
    </div>
  </div>
</template>
