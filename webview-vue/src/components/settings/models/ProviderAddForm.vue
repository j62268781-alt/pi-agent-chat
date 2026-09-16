<!--
  Add a new provider to `models.json`. Every value is optional except the name;
  the host writes exactly the keys the form produced, so an empty base URL or
  key is simply absent.
-->
<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";
import SecretInput from "../SecretInput.vue";
import CompatSection from "./CompatSection.vue";
import HeadersField from "./HeadersField.vue";
import {
  API_OPTIONS,
  type CompatDraft,
  compatDraftFrom,
  serializeCompat,
} from "./compat-fields.ts";
import { readHeadersField } from "./model-form.ts";

const emit = defineEmits<{ close: [] }>();
const store = useSettingsStore();

const form = reactive({
  name: "",
  baseUrl: "",
  apiKey: "",
  api: "",
  authHeader: false,
  headers: "",
});
const compatDraft = ref<CompatDraft>(compatDraftFrom(undefined));
const error = ref("");
const compatApi = computed(() => form.api);

function save(): void {
  const name = form.name.trim();
  if (!name) {
    error.value = t("Provider name is required");
    return;
  }
  const compat = serializeCompat(compatDraft.value, compatApi.value);
  if (compat.errors.length > 0) {
    error.value = compat.errors.join("; ");
    return;
  }
  const entry: Record<string, unknown> = {};
  const baseUrl = form.baseUrl.trim();
  if (baseUrl) entry.baseUrl = baseUrl;
  const apiKey = form.apiKey.trim();
  if (apiKey) entry.apiKey = apiKey;
  if (form.api) entry.api = form.api;
  if (form.authHeader) entry.authHeader = true;
  const headers = readHeadersField(form.headers);
  if (headers) entry.headers = headers;
  if (compat.value) entry.compat = compat.value;

  store.send({ type: "addProvider", name, entry });
  emit("close");
}
</script>

<template>
  <div class="editor-card">
    <h3>{{ t("Add Provider") }}</h3>
    <div v-if="error" class="error">{{ error }}</div>
    <label class="field-label">{{ t("Name") }}</label>
    <input v-model="form.name" placeholder="my-provider" />
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
    <CompatSection v-model="compatDraft" :api="compatApi" />
    <div class="btn-row">
      <button class="btn-primary" type="button" @click="save">
        <span class="codicon codicon-save"></span> {{ t("Save") }}
      </button>
      <button class="btn-secondary" type="button" :title="t('Cancel')" @click="emit('close')">
        <span class="codicon codicon-close"></span>
      </button>
    </div>
  </div>
</template>
