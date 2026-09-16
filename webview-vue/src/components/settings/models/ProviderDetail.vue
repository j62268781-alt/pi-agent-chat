<!--
  The expanded body of one custom provider: the provider's own settings card
  followed by its model list. Both cards save independently, and both delete
  through an inline confirmation rather than a dialog.
-->
<script setup lang="ts">
import { reactive, ref } from "vue";
import type { ModelsJsonModel, ModelsJsonProvider } from "@protocol/settings";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";
import ConfirmBar from "../ConfirmBar.vue";
import ItemRow from "../ItemRow.vue";
import SectionHeader from "../SectionHeader.vue";
import SecretInput from "../SecretInput.vue";
import CompatSection from "./CompatSection.vue";
import HeadersField from "./HeadersField.vue";
import ModelEditor from "./ModelEditor.vue";
import {
  API_OPTIONS,
  type CompatDraft,
  compatDraftFrom,
  serializeCompat,
} from "./compat-fields.ts";
import { headersToText, readHeadersField } from "./model-form.ts";

const props = defineProps<{
  providerId: string;
  provider: ModelsJsonProvider;
}>();

const emit = defineEmits<{ delete: []; renamed: [name: string] }>();
const store = useSettingsStore();

const form = reactive({
  name: props.providerId,
  baseUrl: props.provider.baseUrl ?? "",
  apiKey: props.provider.apiKey ?? "",
  api: props.provider.api ?? "",
  authHeader: props.provider.authHeader === true,
  headers: headersToText(props.provider.headers),
});
const compatDraft = ref<CompatDraft>(compatDraftFrom(props.provider.compat));
const error = ref("");

/** `{id: "new"}` for the add card, otherwise the model being edited. */
const editingModel = ref<{ modelId: string } | null>(null);
const deletingModel = ref<string | null>(null);

const models = () => props.provider.models ?? [];

/** `ModelsJsonModel.id` is optional in the file format but always written. */
const modelId = (model: ModelsJsonModel): string => model.id ?? "";

function modelMeta(model: ModelsJsonModel): string {
  const parts: string[] = [];
  if (model.reasoning) parts.push(t("reasoning"));
  if (model.input?.includes("image")) parts.push(t("image"));
  parts.push(t("ctx:{0}", model.contextWindow ?? "?"));
  parts.push(`$${model.cost?.input ?? 0}/$${model.cost?.output ?? 0}`);
  return parts.join(" · ");
}

function deleteModelMessage(model: ModelsJsonModel): string {
  return t('Delete model "{0}"?', model.name || modelId(model));
}

function confirmModelDelete(model: ModelsJsonModel): void {
  store.send({ type: "deleteModel", providerName: props.providerId, modelId: modelId(model) });
}

function saveProvider(): void {
  const name = form.name.trim();
  if (!name) {
    error.value = t("Provider name is required");
    return;
  }
  const compat = serializeCompat(compatDraft.value, form.api);
  if (compat.errors.length > 0) {
    error.value = compat.errors.join("; ");
    return;
  }
  error.value = "";
  // `null` means "clear the field": the host turns it back into `undefined`
  // before merging, so removing a value actually removes it.
  const updates: Record<string, unknown> = {
    baseUrl: form.baseUrl.trim() || null,
    apiKey: form.apiKey.trim() || null,
    api: form.api || null,
    authHeader: form.authHeader ? true : null,
    headers: readHeadersField(form.headers),
    compat: compat.value,
  };
  if (name === props.providerId) {
    store.send({ type: "updateProvider", name: props.providerId, updates });
  } else {
    store.send({
      type: "renameProviderAndUpdate",
      oldName: props.providerId,
      newName: name,
      updates,
    });
    emit("renamed", name);
  }
}
</script>

<template>
  <div class="editor-card">
    <h3>{{ t("Provider") }}</h3>
    <div v-if="error" class="error">{{ error }}</div>
    <label class="field-label">{{ t("Name") }}</label>
    <input v-model="form.name" placeholder="provider-name" />
    <label class="field-label">{{ t("Base URL") }}</label>
    <input v-model="form.baseUrl" placeholder="https://api.example.com/v1" />
    <label class="field-label">{{ t("API Key") }}</label>
    <SecretInput v-model="form.apiKey" placeholder="sk-... or $ENV_VAR or !cmd" />
    <label class="field-label">{{ t("API Protocol") }}</label>
    <select v-model="form.api">
      <option v-for="option in API_OPTIONS" :key="option.value" :value="option.value">
        {{ option.value === "" ? t("(default)") : option.label }}
      </option>
    </select>
    <label class="check-label">
      <input v-model="form.authHeader" type="checkbox" />
      {{ t("authHeader (add Authorization: Bearer header)") }}
    </label>
    <HeadersField v-model="form.headers" />
    <label class="field-label">{{ t("Compatibility") }}</label>
    <CompatSection v-model="compatDraft" :api="form.api" />
    <div class="btn-row">
      <button class="btn-primary" type="button" @click="saveProvider">
        <span class="codicon codicon-save"></span> {{ t("Save") }}
      </button>
      <button
        class="btn-icon btn-danger"
        type="button"
        :title="t('Delete')"
        @click="emit('delete')"
      >
        <span class="codicon codicon-trash"></span>
      </button>
    </div>
  </div>

  <div class="editor-card">
    <SectionHeader :title="t('Models')">
      <button class="btn-primary" type="button" @click="editingModel = { modelId: 'new' }">
        <span class="codicon codicon-add"></span> {{ t("Add") }}
      </button>
    </SectionHeader>
    <div class="item-list">
      <span v-if="models().length === 0" class="dim">{{ t("No models") }}</span>
      <template v-for="model in models()" :key="modelId(model)">
        <ConfirmBar
          v-if="deletingModel === modelId(model)"
          :message="deleteModelMessage(model)"
          :confirm-label="t('Delete')"
          @confirm="confirmModelDelete(model)"
          @cancel="deletingModel = null"
        />
        <ModelEditor
          v-else-if="editingModel?.modelId === modelId(model)"
          :provider-name="providerId"
          :model="model"
          :provider-api="form.api"
          @close="editingModel = null"
        />
        <ItemRow v-else :name="model.name || modelId(model)" :description="modelMeta(model)">
          <template #badges>
            <span class="badge badge-stdio">{{ modelId(model) }}</span>
          </template>
          <template #actions>
            <button
              class="btn-icon"
              type="button"
              :title="t('Edit')"
              @click="editingModel = { modelId: modelId(model) }"
            >
              <span class="codicon codicon-edit"></span>
            </button>
            <button
              class="btn-icon btn-danger"
              type="button"
              :title="t('Delete')"
              @click="deletingModel = modelId(model)"
            >
              <span class="codicon codicon-trash"></span>
            </button>
          </template>
        </ItemRow>
      </template>
      <ModelEditor
        v-if="editingModel?.modelId === 'new'"
        :provider-name="providerId"
        :model="null"
        :provider-api="form.api"
        @close="editingModel = null"
      />
    </div>
  </div>
</template>
