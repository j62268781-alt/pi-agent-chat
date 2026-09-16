<!--
  Skills tab: the SKILL.md bundles pi loads from `~/.pi/agent/skills`,
  `~/.agents/skills` and their project-scoped counterparts.

  Skills pi discovers elsewhere (packages, the CLI) are listed read-only.
  `disable-model-invocation` hides a skill from the system prompt while keeping
  it available as a `/skill:name` command, so it is surfaced as a badge.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { SkillItem, SkillsTabData } from "@protocol/settings";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";
import ItemBadge from "./ItemBadge.vue";
import ItemRow from "./ItemRow.vue";
import ScopeSelect from "./ScopeSelect.vue";
import SectionHeader from "./SectionHeader.vue";

const props = defineProps<{ data: SkillsTabData }>();
const store = useSettingsStore();

const mode = ref<"list" | "new" | "edit">("list");
const editing = ref<SkillItem | null>(null);
const error = ref("");

const form = ref({
  scope: "user",
  name: "",
  description: "",
  body: "",
  disableModelInvocation: false,
});

const hint = computed(() =>
  t(
    "Skills are markdown files loaded by pi. User skills live in <code>~/.pi/agent/skills</code> or <code>~/.agents/skills</code>{0}.",
    props.data.hasWorkspace
      ? t(", project skills in <code>.pi/skills</code> or <code>.agents/skills</code>")
      : "",
  ),
);

function badgeVariant(label: string): string {
  return ["user", "project", "builtin", "package", "cli"].includes(label) ? label : "other";
}

function startNew(): void {
  editing.value = null;
  error.value = "";
  form.value = {
    scope: "user",
    name: "",
    description: "",
    body: "",
    disableModelInvocation: false,
  };
  mode.value = "new";
}

function startEdit(skill: SkillItem): void {
  editing.value = skill;
  error.value = "";
  form.value = {
    scope: skill.sourceLabel,
    name: skill.name,
    description: skill.description ?? "",
    body: skill.body ?? "",
    disableModelInvocation: skill.disableModelInvocation === true,
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
    error.value = t("Skill name is required");
    return;
  }
  const payload = {
    name,
    description: form.value.description,
    body: form.value.body,
    disableModelInvocation: form.value.disableModelInvocation,
  };
  const current = editing.value;
  if (current) {
    store.send({ type: "updateSkill", filePath: current.filePath, data: payload });
  } else {
    store.send({ type: "createSkill", scope: form.value.scope, data: payload });
  }
  toList();
}
</script>

<template>
  <div v-if="mode === 'list'" class="tab-section">
    <SectionHeader :title="t('Skills')">
      <button class="btn-primary" type="button" @click="startNew">
        <span class="codicon codicon-add"></span> {{ t("New Skill") }}
      </button>
    </SectionHeader>
    <div class="hint" v-html="hint"></div>
    <div class="item-list">
      <span v-if="props.data.skills.length === 0" class="dim">{{ t("No skills found.") }}</span>
      <ItemRow
        v-for="skill in props.data.skills"
        :key="skill.name"
        :name="skill.name"
        :description="skill.description"
      >
        <template #badges>
          <ItemBadge :label="t(skill.sourceLabel)" :variant="badgeVariant(skill.sourceLabel)" />
          <ItemBadge v-if="skill.disableModelInvocation" :label="t('hidden')" variant="http" />
        </template>
        <template #actions>
          <button
            v-if="skill.editable"
            class="btn-icon"
            type="button"
            :title="t('Edit')"
            @click="startEdit(skill)"
          >
            <span class="codicon codicon-edit"></span>
          </button>
          <button
            class="btn-icon"
            type="button"
            :title="t('Open file')"
            @click="store.send({ type: 'openSkillFile', filePath: skill.filePath })"
          >
            <span class="codicon codicon-go-to-file"></span>
          </button>
          <button
            v-if="skill.editable"
            class="btn-icon btn-danger"
            type="button"
            :title="t('Delete')"
            @click="store.send({ type: 'deleteSkill', baseDir: skill.baseDir })"
          >
            <span class="codicon codicon-trash"></span>
          </button>
        </template>
      </ItemRow>
    </div>
  </div>

  <div v-else class="editor-card">
    <h3>{{ editing ? t("Edit: {0}", editing.name) : t("New Skill") }}</h3>
    <div v-if="error" class="error">{{ error }}</div>

    <ScopeSelect
      v-if="!editing"
      v-model="form.scope"
      :has-workspace="props.data.hasWorkspace"
      :label="t('Scope')"
    />

    <label class="field-label">{{ t("Name") }}</label>
    <input v-model="form.name" placeholder="my-skill" :disabled="!!editing" />

    <label class="field-label">{{ t("Description") }}</label>
    <input v-model="form.description" :placeholder="t('What this skill does')" />

    <label class="field-label">{{ t("Body (markdown)") }}</label>
    <textarea v-model="form.body" class="ta" style="height: 200px" spellcheck="false"></textarea>

    <label class="check-label">
      <input v-model="form.disableModelInvocation" type="checkbox" />
      {{ t("Disable model invocation") }}
    </label>

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
