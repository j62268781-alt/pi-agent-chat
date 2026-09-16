<!--
  The API Keys sub-tab: every non-OAuth provider the model registry knows about,
  with a set/remove action. The key itself is write-only — the host never sends
  it back, so the editor always starts empty.
-->
<script setup lang="ts">
import { ref } from "vue";
import type { ApiKeyProviderStatus, ModelsTabData } from "@protocol/settings";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";
import ConfirmBar from "../ConfirmBar.vue";
import ItemRow from "../ItemRow.vue";
import SecretInput from "../SecretInput.vue";

defineProps<{ data: ModelsTabData }>();
const store = useSettingsStore();

/** Provider id the key editor is open for. */
const editing = ref<string | null>(null);
const deleting = ref<string | null>(null);
const draft = ref("");

function startEdit(id: string): void {
  editing.value = id;
  draft.value = "";
}

function save(provider: ApiKeyProviderStatus): void {
  const key = draft.value.trim();
  if (!key) {
    store.showToast(t("API key is required"), "error");
    return;
  }
  store.send({ type: "saveApiKey", providerId: provider.id, apiKey: key });
  editing.value = null;
  draft.value = "";
}

function confirmRemove(id: string): void {
  store.send({ type: "removeApiKey", providerId: id });
  deleting.value = null;
}

function removeMessage(provider: ApiKeyProviderStatus): string {
  return t('Remove API key for "{0}"?', provider.name);
}
</script>

<template>
  <div class="item-list">
    <span v-if="data.apikeyStatuses.length === 0" class="dim">
      {{ t("No API key providers found") }}
    </span>

    <template v-else>
      <template v-for="provider in data.apikeyStatuses" :key="provider.id">
        <ConfirmBar
          v-if="deleting === provider.id"
          :message="removeMessage(provider)"
          :confirm-label="t('Remove')"
          @confirm="confirmRemove(provider.id)"
          @cancel="deleting = null"
        />

        <ItemRow v-else :name="provider.name" :description="t('{0} models', provider.modelCount)">
          <template #badges>
            <span class="status-dot" :class="provider.configured ? 'on' : 'off'"></span>
            <span class="badge" :class="provider.configured ? 'badge-cli' : 'badge-other'">
              {{ provider.configured ? t("configured") : t("not set") }}
            </span>
          </template>
          <template #actions>
            <button
              v-if="provider.configured"
              class="btn-icon btn-danger"
              type="button"
              :title="t('Remove API key')"
              @click="deleting = provider.id"
            >
              <span class="codicon codicon-trash"></span>
            </button>
            <button
              v-else
              class="btn-icon"
              type="button"
              :title="t('Set API key')"
              @click="startEdit(provider.id)"
            >
              <span class="codicon codicon-key"></span>
            </button>
          </template>
        </ItemRow>

        <div v-if="editing === provider.id" class="editor-card">
          <label class="field-label">{{ t("API Key for {0}", provider.name) }}</label>
          <SecretInput v-model="draft" placeholder="sk-..." />
          <div class="btn-row">
            <button class="btn-primary" type="button" @click="save(provider)">
              <span class="codicon codicon-save"></span> {{ t("Save") }}
            </button>
            <button
              class="btn-secondary"
              type="button"
              :title="t('Cancel')"
              @click="editing = null"
            >
              <span class="codicon codicon-close"></span>
            </button>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
