<!--
  Agents tab: the markdown agent definitions pi loads from
  `~/.pi/agent/agents` (user) and `.pi/agents` (project).

  The list and the editor are mutually exclusive, exactly like the legacy
  `renderList` / `showEditor` swap. Built-in agents cannot be created or deleted
  by name, but an overridden built-in can be reset back to its shipped text.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { AgentItem, AgentsTabData } from "@protocol/settings";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";
import ItemBadge from "./ItemBadge.vue";
import ItemRow from "./ItemRow.vue";
import ScopeSelect from "./ScopeSelect.vue";
import SectionHeader from "./SectionHeader.vue";

const props = defineProps<{ data: AgentsTabData }>();
const store = useSettingsStore();

const mode = ref<"list" | "new" | "edit">("list");
const editing = ref<AgentItem | null>(null);
const error = ref("");

const form = ref({
  scope: "user",
  name: "",
  description: "",
  model: "",
  systemPrompt: "",
  tools: "",
  disableModelInvocation: false,
});

/** The hint embeds `<code>` markup, so it is rendered with `v-html`. */
const hint = computed(() =>
  t(
    "Agents are markdown files loaded by pi. User agents live in <code>~/.pi/agent/agents</code>{0}.",
    props.data.hasWorkspace ? t(", project agents in <code>.pi/agents</code>") : "",
  ),
);

/** Which scope a saved agent lives in; built-ins resolve to their override. */
function scopeFor(agent: AgentItem): string {
  return agent.source === "project" ? "project" : "user";
}

function badgeVariant(agent: AgentItem): string {
  if (agent.source === "user") return "user";
  if (agent.source === "project") return "project";
  if (agent.source === "builtin") return agent.hasOverride ? "cli" : "builtin";
  return "other";
}

function sourceLabel(agent: AgentItem): string {
  return agent.source === "builtin" && agent.hasOverride ? t("builtin+override") : t(agent.source);
}

/** The saved model stays selectable even when it left the registry. */
function modelOptions(current: string): string[] {
  const models = props.data.models ?? [];
  return current && !models.includes(current) ? [...models, current] : models;
}

function startNew(): void {
  editing.value = null;
  error.value = "";
  form.value = {
    scope: "user",
    name: "",
    description: "",
    model: "",
    systemPrompt: "",
    tools: "",
    disableModelInvocation: false,
  };
  mode.value = "new";
}

function startEdit(agent: AgentItem): void {
  editing.value = agent;
  error.value = "";
  form.value = {
    scope: scopeFor(agent),
    name: agent.name,
    description: agent.description ?? "",
    model: agent.model ?? "",
    systemPrompt: agent.systemPrompt ?? "",
    tools: (agent.tools ?? []).join("\n"),
    disableModelInvocation: agent.disableModelInvocation === true,
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
    error.value = t("Agent name is required");
    return;
  }
  const payload = {
    name,
    description: form.value.description,
    model: form.value.model || undefined,
    systemPrompt: form.value.systemPrompt,
    tools: form.value.tools
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    disableModelInvocation: form.value.disableModelInvocation,
  };
  const current = editing.value;
  if (current) {
    store.send({ type: "updateAgent", scope: scopeFor(current), data: payload });
  } else {
    store.send({ type: "createAgent", scope: form.value.scope, data: payload });
  }
  toList();
}
</script>

<template>
  <div v-if="mode === 'list'" class="tab-section">
    <SectionHeader :title="t('Agents')">
      <button class="btn-primary" type="button" @click="startNew">
        <span class="codicon codicon-add"></span> {{ t("New Agent") }}
      </button>
    </SectionHeader>
    <div class="hint" v-html="hint"></div>
    <div class="item-list">
      <span v-if="props.data.agents.length === 0" class="dim">{{ t("No agents found.") }}</span>
      <ItemRow
        v-for="agent in props.data.agents"
        :key="agent.name"
        :name="agent.name"
        :description="agent.description"
      >
        <template #badges>
          <ItemBadge :label="sourceLabel(agent)" :variant="badgeVariant(agent)" />
          <ItemBadge v-if="agent.model" :label="agent.model" variant="package" />
        </template>
        <template #actions>
          <button class="btn-icon" type="button" :title="t('Edit')" @click="startEdit(agent)">
            <span class="codicon codicon-edit"></span>
          </button>
          <button
            class="btn-icon"
            type="button"
            :title="t('Open file')"
            @click="store.send({ type: 'openAgentFile', filePath: agent.filePath })"
          >
            <span class="codicon codicon-go-to-file"></span>
          </button>
          <button
            v-if="agent.isBuiltin && agent.hasOverride"
            class="btn-icon"
            type="button"
            :title="t('Reset to builtin')"
            @click="store.send({ type: 'resetBuiltin', name: agent.name, scope: scopeFor(agent) })"
          >
            <span class="codicon codicon-discard"></span>
          </button>
          <button
            v-if="!agent.isBuiltin"
            class="btn-icon btn-danger"
            type="button"
            :title="t('Delete')"
            @click="store.send({ type: 'deleteAgent', name: agent.name, scope: scopeFor(agent) })"
          >
            <span class="codicon codicon-trash"></span>
          </button>
        </template>
      </ItemRow>
    </div>
  </div>

  <div v-else class="editor-card">
    <h3>{{ editing ? t("Edit: {0}", editing.name) : t("New Agent") }}</h3>
    <div v-if="error" class="error">{{ error }}</div>

    <ScopeSelect
      v-if="!editing"
      v-model="form.scope"
      :has-workspace="props.data.hasWorkspace"
      :label="t('Scope')"
    />

    <label class="field-label">{{ t("Name") }}</label>
    <input v-model="form.name" placeholder="my-agent" :disabled="!!editing" />

    <label class="field-label">{{ t("Description") }}</label>
    <input v-model="form.description" :placeholder="t('What this agent does')" />

    <label class="field-label">{{ t("Model") }}</label>
    <select v-model="form.model">
      <option value="">{{ t("(default)") }}</option>
      <option v-for="entry in modelOptions(form.model)" :key="entry" :value="entry">
        {{ entry }}
      </option>
    </select>

    <label class="field-label">{{ t("System prompt") }}</label>
    <textarea
      v-model="form.systemPrompt"
      class="ta"
      style="height: 180px"
      spellcheck="false"
      :placeholder="t('You are a helpful assistant…')"
    ></textarea>

    <label class="field-label">{{ t("Tools (one per line)") }}</label>
    <textarea
      v-model="form.tools"
      class="ta"
      style="height: 60px"
      spellcheck="false"
      :placeholder="'bash\nread'"
    ></textarea>

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
