<!--
  MCP Servers tab: the merged view of `~/.agents/mcp.json` (user) and
  `<folder>/.mcp.json` (project), where a project server shadows a user server of
  the same name.

  Editing always posts the flat `McpServerForm` — the host's `parseServerEntry`
  owns the conversion into the `command`/`url` + `args`/`env`/`headers` shape, so
  the transport switch only decides which fields the form shows.
-->
<script setup lang="ts">
import { ref } from "vue";
import type { McpServerEntry, McpServerItem, McpTabData } from "@protocol/settings";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";
import ItemBadge from "./ItemBadge.vue";
import ItemRow from "./ItemRow.vue";
import ScopeSelect from "./ScopeSelect.vue";
import SectionHeader from "./SectionHeader.vue";

const props = defineProps<{ data: McpTabData }>();
const store = useSettingsStore();

const mode = ref<"list" | "new" | "edit">("list");
const editing = ref<McpServerItem | null>(null);
const error = ref("");

const form = ref({
  scope: "user",
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  env: "",
  cwd: "",
  url: "",
  headers: "",
  bearerToken: "",
  directTools: "",
  directToolsAll: false,
  disabled: false,
});

/** `KEY=VALUE` lines; headers use `KEY: VALUE` instead. */
function kvToLines(kv: Record<string, string> | undefined, separator = "="): string {
  if (!kv) return "";
  return Object.entries(kv)
    .map(([key, value]) => `${key}${separator}${value}`)
    .join("\n");
}

function formatTransport(entry: McpServerEntry): string {
  if (entry.url) return entry.url;
  if (entry.command) {
    return entry.command + (entry.args?.length ? ` ${entry.args.join(" ")}` : "");
  }
  return t("(no transport)");
}

function transportBadge(entry: McpServerEntry): { label: string; variant: string } {
  if (entry.url) return { label: t("http"), variant: "http" };
  if (entry.command) return { label: t("stdio"), variant: "stdio" };
  return { label: "?", variant: "other" };
}

function startNew(): void {
  editing.value = null;
  error.value = "";
  form.value = {
    scope: "user",
    name: "",
    transport: "stdio",
    command: "",
    args: "",
    env: "",
    cwd: "",
    url: "",
    headers: "",
    bearerToken: "",
    directTools: "",
    directToolsAll: false,
    disabled: false,
  };
  mode.value = "new";
}

function startEdit(server: McpServerItem): void {
  const entry = server.entry;
  editing.value = server;
  error.value = "";
  form.value = {
    scope: server.source,
    name: server.name,
    transport: entry.url ? "http" : "stdio",
    command: entry.command ?? "",
    args: (entry.args ?? []).join("\n"),
    env: kvToLines(entry.env),
    cwd: entry.cwd ?? "",
    url: entry.url ?? "",
    headers: kvToLines(entry.headers, ": "),
    bearerToken: entry.bearerToken ?? "",
    directTools: typeof entry.directTools === "boolean" ? "" : (entry.directTools ?? []).join("\n"),
    directToolsAll: entry.directTools === true,
    disabled: entry.disabled === true,
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
    error.value = t("Server name is required");
    return;
  }
  const value = form.value;
  const entry = {
    name,
    _transport: value.transport,
    command: value.command,
    args: value.args,
    env: value.env,
    cwd: value.cwd,
    url: value.url,
    headers: value.headers,
    bearerToken: value.bearerToken,
    directTools: value.directTools,
    directToolsAll: value.directToolsAll,
    disabled: value.disabled,
  };
  const current = editing.value;
  if (current) {
    store.send({ type: "updateServer", name, scope: current.source, entry });
  } else {
    store.send({ type: "addServer", name, scope: value.scope, entry });
  }
  toList();
}
</script>

<template>
  <div v-if="mode === 'list'" class="tab-section">
    <SectionHeader :title="t('MCP Servers')">
      <button class="btn-primary" type="button" @click="startNew">
        <span class="codicon codicon-add"></span> {{ t("Add Server") }}
      </button>
      <button
        class="btn-secondary"
        type="button"
        :title="t('Open user mcp.json')"
        @click="store.send({ type: 'openMcpFile', scope: 'user' })"
      >
        <span class="codicon codicon-go-to-file"></span> {{ t("user mcp.json") }}
      </button>
      <button
        v-if="props.data.hasWorkspace"
        class="btn-secondary"
        type="button"
        :title="t('Open project mcp.json')"
        @click="store.send({ type: 'openMcpFile', scope: 'project' })"
      >
        <span class="codicon codicon-go-to-file"></span> {{ t("project mcp.json") }}
      </button>
    </SectionHeader>

    <div class="item-list">
      <span v-if="props.data.servers.length === 0" class="dim">
        {{ t("No servers configured.") }}
      </span>
      <ItemRow
        v-for="server in props.data.servers"
        :key="server.name"
        :name="server.name"
        :description="formatTransport(server.entry)"
      >
        <template #badges>
          <ItemBadge :label="t(server.source)" :variant="server.source" />
          <ItemBadge
            :label="transportBadge(server.entry).label"
            :variant="transportBadge(server.entry).variant"
          />
          <ItemBadge v-if="server.entry.disabled" :label="t('Disabled')" variant="disabled" />
        </template>
        <template #actions>
          <button class="btn-icon" type="button" :title="t('Edit')" @click="startEdit(server)">
            <span class="codicon codicon-edit"></span>
          </button>
          <button
            class="btn-icon"
            type="button"
            :title="server.entry.disabled ? t('Enable') : t('Disable')"
            @click="store.send({ type: 'toggleDisabled', name: server.name, scope: server.source })"
          >
            <span
              class="codicon"
              :class="server.entry.disabled ? 'codicon-circle-filled' : 'codicon-circle-slash'"
            ></span>
          </button>
          <button
            class="btn-icon btn-danger"
            type="button"
            :title="t('Delete')"
            @click="store.send({ type: 'deleteServer', name: server.name, scope: server.source })"
          >
            <span class="codicon codicon-trash"></span>
          </button>
        </template>
      </ItemRow>
    </div>
  </div>

  <div v-else class="editor-card">
    <h3>{{ editing ? t("Edit: {0}", editing.name) : t("Add Server") }}</h3>
    <div v-if="error" class="error">{{ error }}</div>

    <ScopeSelect
      v-if="!editing"
      v-model="form.scope"
      :has-workspace="props.data.hasWorkspace"
      :label="t('Scope')"
      :user-label="t('user (~/.agents/mcp.json)')"
      :project-label="t('project (.mcp.json)')"
    />

    <label class="field-label">{{ t("Name") }}</label>
    <input v-model="form.name" placeholder="my-server" :disabled="!!editing" />

    <label class="field-label">{{ t("Transport") }}</label>
    <select v-model="form.transport">
      <option value="stdio">{{ t("stdio (local command)") }}</option>
      <option value="http">{{ t("http (remote URL)") }}</option>
    </select>

    <template v-if="form.transport === 'stdio'">
      <label class="field-label">{{ t("Command") }}</label>
      <input v-model="form.command" placeholder="npx" />
      <label class="field-label">{{ t("Args (one per line)") }}</label>
      <textarea
        v-model="form.args"
        class="ta"
        style="height: 60px"
        spellcheck="false"
        :placeholder="'-y\n@modelcontextprotocol/server-foo'"
      ></textarea>
      <label class="field-label">{{ t("Env (KEY=VALUE, one per line)") }}</label>
      <textarea
        v-model="form.env"
        class="ta"
        style="height: 60px"
        spellcheck="false"
        placeholder="API_KEY=xxx"
      ></textarea>
      <label class="field-label">{{ t("cwd") }}</label>
      <input v-model="form.cwd" />
    </template>

    <template v-else>
      <label class="field-label">{{ t("URL") }}</label>
      <input v-model="form.url" placeholder="https://example.com/mcp" />
      <label class="field-label">{{ t("Headers (KEY: VALUE, one per line)") }}</label>
      <textarea
        v-model="form.headers"
        class="ta"
        style="height: 60px"
        spellcheck="false"
        placeholder="Authorization: Bearer xxx"
      ></textarea>
      <label class="field-label">{{ t("Bearer token") }}</label>
      <input v-model="form.bearerToken" />
    </template>

    <label class="field-label">{{ t('Direct tools (one per line, or "all")') }}</label>
    <textarea
      v-model="form.directTools"
      class="ta"
      style="height: 60px"
      spellcheck="false"
      :placeholder="'tool_a\ntool_b'"
    ></textarea>

    <label class="check-label">
      <input v-model="form.directToolsAll" type="checkbox" />
      {{ t("All tools direct") }}
    </label>
    <label class="check-label">
      <input v-model="form.disabled" type="checkbox" />
      {{ t("Disabled") }}
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
