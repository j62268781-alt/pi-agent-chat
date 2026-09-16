<!--
  The Providers sub-tab of Models: every provider in `models.json`, each
  expandable into its own detail card. Adding and deleting both happen in place
  (a card and an inline confirmation respectively) so the list never loses its
  scroll position to a modal.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { CustomProviderSummary, ModelsJsonProvider, ModelsTabData } from "@protocol/settings";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";
import ConfirmBar from "../ConfirmBar.vue";
import ItemRow from "../ItemRow.vue";
import SectionHeader from "../SectionHeader.vue";
import ProviderAddForm from "./ProviderAddForm.vue";
import ProviderDetail from "./ProviderDetail.vue";

const props = defineProps<{ data: ModelsTabData }>();
const store = useSettingsStore();

/** Summary plus its raw `models.json` entry, which `buildTabData` omits when a
 * provider has no entry (it cannot happen, but the map is not guaranteed). */
const rows = computed<Array<{ summary: CustomProviderSummary; entry: ModelsJsonProvider | null }>>(
  () =>
    props.data.providers.map((summary) => ({
      summary,
      entry: props.data.modelsJson.providers?.[summary.id] ?? null,
    })),
);

const expanded = ref<string | null>(null);
const adding = ref(false);
const deleting = ref<string | null>(null);

function toggle(id: string): void {
  expanded.value = expanded.value === id ? null : id;
  adding.value = false;
}

function startAdd(): void {
  adding.value = true;
  expanded.value = null;
}

function confirmDelete(id: string): void {
  store.send({ type: "deleteProvider", name: id });
  deleting.value = null;
}

function deleteMessage(provider: CustomProviderSummary): string {
  return t('Delete "{0}"?', provider.name);
}

function modelCountLabel(provider: CustomProviderSummary): string {
  return t("{0} models", provider.modelCount);
}
</script>

<template>
  <SectionHeader :title="t('Custom Providers')">
    <button class="btn-primary" type="button" @click="startAdd">
      <span class="codicon codicon-add"></span> {{ t("Add") }}
    </button>
    <button
      class="btn-secondary"
      type="button"
      :title="t('Open models.json')"
      @click="store.send({ type: 'openModelsFile' })"
    >
      <span class="codicon codicon-go-to-file"></span> models.json
    </button>
  </SectionHeader>

  <div class="item-list">
    <span v-if="rows.length === 0" class="dim">{{ t("No custom providers") }}</span>

    <template v-for="row in rows" :key="row.summary.id">
      <ConfirmBar
        v-if="deleting === row.summary.id"
        :message="deleteMessage(row.summary)"
        :confirm-label="t('Delete')"
        @confirm="confirmDelete(row.summary.id)"
        @cancel="deleting = null"
      />

      <template v-else>
        <ItemRow
          :name="row.summary.name"
          :description="modelCountLabel(row.summary)"
          :selected="expanded === row.summary.id"
          style="cursor: pointer"
          @click="toggle(row.summary.id)"
        >
          <template #badges>
            <span class="badge badge-package">{{ t("custom") }}</span>
          </template>
          <template #actions>
            <button
              class="btn-icon"
              type="button"
              :title="t('Edit')"
              @click.stop="toggle(row.summary.id)"
            >
              <span class="codicon codicon-edit"></span>
            </button>
            <button
              class="btn-icon btn-danger"
              type="button"
              :title="t('Delete')"
              @click.stop="deleting = row.summary.id"
            >
              <span class="codicon codicon-trash"></span>
            </button>
          </template>
        </ItemRow>

        <ProviderDetail
          v-if="expanded === row.summary.id && row.entry"
          :provider-id="row.summary.id"
          :provider="row.entry"
          @delete="deleting = row.summary.id"
          @renamed="expanded = $event"
        />
      </template>
    </template>

    <ProviderAddForm v-if="adding" @close="adding = false" />
  </div>
</template>
