<!--
  Add/edit a single model inside a provider. Nineteen fields, most of them
  optional overrides; `null` means "clear the override so pi falls back to the
  provider/API default", which is exactly how the host's `sanitizeModelUpdates`
  reads it.
-->
<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { ModelsJsonModel } from "@protocol/settings";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";
import HeadersField from "./HeadersField.vue";
import CompatSection from "./CompatSection.vue";
import {
  API_OPTIONS,
  type CompatDraft,
  compatDraftFrom,
  safeJsonStringify,
  serializeCompat,
} from "./compat-fields.ts";
import {
  headersToText,
  parseOptionalJson,
  positiveIntOrNull,
  readHeadersField,
} from "./model-form.ts";

const props = defineProps<{
  providerName: string;
  /** The model being edited; `null` when adding. */
  model: ModelsJsonModel | null;
  /** Provider API protocol, used as the compat-visibility fallback. */
  providerApi: string;
}>();

const emit = defineEmits<{ close: [] }>();
const store = useSettingsStore();

const editing = props.model;
const isNew = editing === null;

const form = reactive({
  id: editing?.id ?? "",
  name: editing?.name ?? "",
  contextWindow: editing?.contextWindow == null ? "" : String(editing.contextWindow),
  maxTokens: editing?.maxTokens == null ? "" : String(editing.maxTokens),
  api: editing?.api ?? "",
  baseUrl: editing?.baseUrl ?? "",
  costInput: editing?.cost?.input == null ? "" : String(editing.cost.input),
  costOutput: editing?.cost?.output == null ? "" : String(editing.cost.output),
  costCacheRead: editing?.cost?.cacheRead == null ? "" : String(editing.cost.cacheRead),
  costCacheWrite: editing?.cost?.cacheWrite == null ? "" : String(editing.cost.cacheWrite),
  costTiers: editing?.cost?.tiers == null ? "" : safeJsonStringify(editing.cost.tiers),
  reasoning: editing?.reasoning === true,
  image: editing?.input?.includes("image") === true,
  thinkingLevelMap:
    editing?.thinkingLevelMap == null ? "" : safeJsonStringify(editing.thinkingLevelMap),
  samplingParams: editing?.samplingParams == null ? "" : safeJsonStringify(editing.samplingParams),
  headers: headersToText(editing?.headers),
});

const compatDraft = ref<CompatDraft>(compatDraftFrom(editing?.compat));
/** `""` inherits the provider's protocol, which also drives compat visibility. */
const compatApi = computed(() => form.api || props.providerApi);
const error = ref("");

function save(): void {
  const id = form.id.trim();
  if (!id) {
    error.value = t("Model ID is required");
    return;
  }
  const problems: string[] = [];

  const tiers = parseOptionalJson(form.costTiers);
  if (!tiers.ok) problems.push(t("Invalid JSON in Cost Tiers"));
  const thinkingLevelMap = parseOptionalJson(form.thinkingLevelMap);
  if (!thinkingLevelMap.ok) problems.push(t("Invalid JSON in Thinking Level Map"));
  const samplingParams = parseOptionalJson(form.samplingParams);
  if (!samplingParams.ok) problems.push(t("Invalid JSON in Sampling Parameters"));
  const compat = serializeCompat(compatDraft.value, compatApi.value);
  problems.push(...compat.errors);

  const costInput = Number(form.costInput.trim());
  const costOutput = Number(form.costOutput.trim());
  const costCacheRead = Number(form.costCacheRead.trim());
  const costCacheWrite = Number(form.costCacheWrite.trim());
  const anyCost =
    form.costInput.trim() !== "" ||
    form.costOutput.trim() !== "" ||
    form.costCacheRead.trim() !== "" ||
    form.costCacheWrite.trim() !== "" ||
    tiers.value != null;

  const updates: Record<string, unknown> = {
    name: form.name.trim() || null,
    contextWindow: positiveIntOrNull(form.contextWindow),
    maxTokens: positiveIntOrNull(form.maxTokens),
    api: form.api || null,
    baseUrl: form.baseUrl.trim() || null,
    cost: anyCost
      ? {
          input: Number.isFinite(costInput) ? costInput : 0,
          output: Number.isFinite(costOutput) ? costOutput : 0,
          cacheRead: Number.isFinite(costCacheRead) ? costCacheRead : 0,
          cacheWrite: Number.isFinite(costCacheWrite) ? costCacheWrite : 0,
          ...(tiers.value != null ? { tiers: tiers.value } : {}),
        }
      : null,
    reasoning: form.reasoning,
    input: form.image ? ["text", "image"] : null,
    thinkingLevelMap: thinkingLevelMap.value,
    samplingParams: samplingParams.value,
    headers: readHeadersField(form.headers),
    compat: compat.value,
  };

  if (problems.length > 0) {
    error.value = problems.join("; ");
    return;
  }

  if (isNew) {
    // The host strips nothing on `addModel`, so drop the cleared overrides here.
    const clean: Record<string, unknown> = { id };
    for (const [key, value] of Object.entries(updates)) {
      if (value !== null) clean[key] = value;
    }
    store.send({ type: "addModel", providerName: props.providerName, model: clean });
  } else {
    store.send({
      type: "updateModel",
      providerName: props.providerName,
      modelId: id,
      updates,
    });
  }
  emit("close");
}
</script>

<template>
  <div class="editor-card">
    <h3>{{ isNew ? t("Add Model") : t("Edit Model") }}</h3>
    <div v-if="error" class="error">{{ error }}</div>
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">{{ t("Model ID") }}</label>
        <input v-model="form.id" placeholder="model-id" :readonly="!isNew" />
      </div>
      <div class="form-group">
        <label class="field-label">{{ t("Display Name") }}</label>
        <input v-model="form.name" :placeholder="t('Optional')" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">{{ t("Context Window") }}</label>
        <input v-model="form.contextWindow" type="number" placeholder="200000" />
      </div>
      <div class="form-group">
        <label class="field-label">{{ t("Max Tokens") }}</label>
        <input v-model="form.maxTokens" type="number" placeholder="16384" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">{{ t("API Protocol (override)") }}</label>
        <select v-model="form.api">
          <option v-for="option in API_OPTIONS" :key="option.value" :value="option.value">
            {{ option.value === "" ? t("(default)") : option.label }}
          </option>
        </select>
      </div>
      <div class="form-group">
        <label class="field-label">{{ t("Base URL (override)") }}</label>
        <input v-model="form.baseUrl" :placeholder="t('Optional')" />
      </div>
    </div>

    <h4 style="margin: 6px 0 2px; font-size: var(--fs-11); opacity: 0.7">
      {{ t("Cost (per million tokens)") }}
    </h4>
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">{{ t("Input") }}</label>
        <input v-model="form.costInput" type="number" step="any" placeholder="0" />
      </div>
      <div class="form-group">
        <label class="field-label">{{ t("Output") }}</label>
        <input v-model="form.costOutput" type="number" step="any" placeholder="0" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="field-label">{{ t("Cache Read") }}</label>
        <input v-model="form.costCacheRead" type="number" step="any" placeholder="0" />
      </div>
      <div class="form-group">
        <label class="field-label">{{ t("Cache Write") }}</label>
        <input v-model="form.costCacheWrite" type="number" step="any" placeholder="0" />
      </div>
    </div>
    <label class="field-label">{{ t("Cost Tiers (JSON array)") }}</label>
    <textarea
      v-model="form.costTiers"
      class="ta"
      style="height: 80px"
      spellcheck="false"
      placeholder='[{ "inputTokensAbove": 272000, "input": 10, "output": 45, "cacheRead": 1, "cacheWrite": 12.5 }]'
    ></textarea>

    <div class="form-row" style="gap: 14px; margin: 4px 0">
      <label class="check-label">
        <input v-model="form.reasoning" type="checkbox" /> {{ t("Reasoning") }}
      </label>
      <label class="check-label">
        <input v-model="form.image" type="checkbox" /> {{ t("Image input") }}
      </label>
    </div>

    <label class="field-label">{{ t("Thinking Level Map (JSON)") }}</label>
    <textarea
      v-model="form.thinkingLevelMap"
      class="ta"
      style="height: 90px"
      spellcheck="false"
      placeholder='{ "high": "high", "max": "max", "low": null }'
    ></textarea>
    <label class="field-label">{{ t("Sampling Parameters (JSON)") }}</label>
    <textarea
      v-model="form.samplingParams"
      class="ta"
      style="height: 90px"
      spellcheck="false"
      placeholder='{ "temperature": 1.0, "top_p": 0.95 }'
    ></textarea>

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
