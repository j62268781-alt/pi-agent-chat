<!--
  General tab: `~/.pi/agent/settings.json` as sixteen collapsible groups.

  Dirty tracking is per field and compared against the value the tab opened with
  (settings.json value, or the field's default), so a group's dot only appears
  when the user actually changed something. Save sends one nested patch with just
  the changed keys — `undefined` clears a key, which is how "reset to default"
  reaches the file.
-->
<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { GeneralTabData } from "@protocol/settings";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";
import SettingFieldEditor from "./SettingFieldEditor.vue";
import {
  type EditorValue,
  type SettingField,
  SETTING_GROUPS,
  initialValue,
  mergeValues,
  readEditor,
  setAt,
  toEditor,
} from "./general-fields.ts";

const props = defineProps<{ data: GeneralTabData }>();

const store = useSettingsStore();

/** Values the tab opened with; the baseline for every dirty comparison. */
const baseline = reactive<Record<string, unknown>>({});
const editors = reactive<Record<string, EditorValue>>({});
const openGroups = reactive<boolean[]>(SETTING_GROUPS.map(() => false));
const query = ref("");
const error = ref("");

function seed(): void {
  for (const group of SETTING_GROUPS) {
    for (const field of group.fields) {
      const initial = initialValue(field, props.data.values ?? {});
      baseline[field.key] = initial;
      editors[field.key] = toEditor(field, initial);
    }
  }
}
seed();

/** Re-seed when the host pushes fresh data (a refresh or a panel reload). */
watch(
  () => props.data.values,
  () => seed(),
);

function read(field: SettingField) {
  return readEditor(field, editors[field.key] ?? "", baseline[field.key]);
}

function isDirty(field: SettingField): boolean {
  return read(field).dirty;
}

function groupDirty(index: number): boolean {
  return (SETTING_GROUPS[index]?.fields ?? []).some(isDirty);
}

/** A search opens every matching group, exactly like the legacy `filterGroups`. */
const normalized = computed(() => query.value.trim().toLowerCase());

function groupVisible(group: (typeof SETTING_GROUPS)[number]): boolean {
  const needle = normalized.value;
  if (!needle) return true;
  if (group.title.toLowerCase().includes(needle)) return true;
  return group.fields.some(
    (field) =>
      field.label.toLowerCase().includes(needle) || field.key.toLowerCase().includes(needle),
  );
}

function isOpen(index: number): boolean {
  const group = SETTING_GROUPS[index];
  if (!group) return false;
  return normalized.value ? groupVisible(group) : openGroups[index] === true;
}

function toggle(index: number): void {
  openGroups[index] = !openGroups[index];
}

function resetGroup(index: number): void {
  for (const field of SETTING_GROUPS[index]?.fields ?? []) {
    editors[field.key] = toEditor(field, field.def);
  }
}

function save(): void {
  const patch: Record<string, unknown> = {};
  for (const group of SETTING_GROUPS) {
    for (const field of group.fields) {
      const result = read(field);
      if (!result.dirty) continue;
      if (result.error) {
        error.value = t('Invalid JSON in "{0}"', field.label);
        return;
      }
      setAt(patch, field.key, result.value);
    }
  }
  error.value = "";
  if (Object.keys(patch).length === 0) return;
  // The host writes the file and answers `saved`; committing the change locally
  // clears the dirty dots without re-fetching the whole tab. Replacing the cached
  // `values` re-seeds this tab through the watcher below, which is what updates
  // the per-field baselines.
  store.patch("settings", { values: mergeValues({ ...props.data.values }, patch) });
  store.markSaving();
  store.send({ type: "saveSettings", patch });
}
</script>

<template>
  <div class="tab-section">
    <div class="cfg-search-row">
      <input v-model="query" class="cfg-search" :placeholder="t('Search settings…')" />
      <button class="btn-primary" type="button" @click="save">
        <span class="codicon codicon-save"></span> {{ t("Save") }}
      </button>
      <button
        class="btn-secondary"
        type="button"
        :title="t('Open settings.json')"
        @click="store.send({ type: 'openSettingsFile' })"
      >
        <span class="codicon codicon-go-to-file"></span> settings.json
      </button>
    </div>
    <div v-if="error" class="error">{{ error }}</div>
    <div
      v-for="(group, index) in SETTING_GROUPS"
      v-show="groupVisible(group)"
      :key="group.title"
      class="cfg-group"
      :class="{ open: isOpen(index) }"
    >
      <div class="cfg-group-header" @click="toggle(index)">
        <span class="codicon codicon-chevron-down"></span>
        <span>{{ group.title }}</span>
        <button
          class="btn-icon cfg-reset"
          type="button"
          :title="t('Reset to defaults')"
          @click.stop="resetGroup(index)"
        >
          <span class="codicon codicon-discard"></span>
        </button>
        <span class="cfg-dirty-dot" :hidden="!groupDirty(index)">●</span>
      </div>
      <div class="cfg-group-body">
        <SettingFieldEditor
          v-for="field in group.fields"
          :key="field.key"
          :field="field"
          :model-value="editors[field.key] ?? ''"
          @update:model-value="editors[field.key] = $event"
        />
      </div>
    </div>
  </div>
</template>
