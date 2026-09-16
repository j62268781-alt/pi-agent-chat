// The settings postMessage contract — the second (and only other) JSON
// boundary between the extension host and a Vue webview.
//
// `src/protocol/messages.ts` owns the *chat* panel's channel; this file owns
// the *settings* panel's, which is a separate `WebviewPanel` with its own
// `onDidReceiveMessage` handler (`src/providers/settings/settings-panel.ts`).
// The two never overlap: the settings webview sends `ready` (the chat panel
// sends `webviewReady`) and answers with `init` (the chat panel answers with
// `ready`), so a message can only ever be handled by the panel that expects it.
//
// Message flow
//   webview -> host : WebviewToSettings (`vscode.postMessage`)
//   host -> webview : SettingsToWebview (`webview.postMessage`)
//
// Everything the host actually implements is listed here: the authoring rule is
// to mirror `switch (msg.type)` in settings-panel.ts exactly rather than the
// legacy webview's (incomplete) local declarations.

// ---------------------------------------------------------------------------
// shared shapes
// ---------------------------------------------------------------------------

/** Scope selector shared by agents, prompts, skills and MCP servers. */
export type SettingsScope = "user" | "project";

/** The eight tabs the host advertises in `init.tabs`, in display order. */
export const SETTINGS_TAB_IDS = [
  "models",
  "agents",
  "prompts",
  "skills",
  "mcp",
  "commit",
  "sysprompt",
  "settings",
] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

/** Runtime guard for the tab ids above; `init.tabs` and `tabData.tab` are
 * plain strings on the wire, so both sides narrow through this. */
export function isSettingsTabId(value: string): value is SettingsTabId {
  return (SETTINGS_TAB_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// tab data — `tabData.data`, one shape per tab id
// ---------------------------------------------------------------------------

/** A provider summarised from `~/.pi/agent/models.json`. */
export interface CustomProviderSummary {
  id: string;
  name: string;
  /** Always `"custom"` — the host only reports models.json providers here. */
  type: "custom";
  modelCount: number;
}

/** One model inside a models.json provider entry. */
export interface ModelsJsonModel {
  id?: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    tiers?: unknown;
  };
  headers?: Record<string, string>;
  samplingParams?: Record<string, unknown>;
  compat?: Record<string, unknown>;
}

/** One provider entry of `models.json`. */
export interface ModelsJsonProvider {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  compat?: Record<string, unknown>;
  models?: ModelsJsonModel[];
  modelOverrides?: Record<string, unknown>;
}

export interface ModelsJson {
  providers?: Record<string, ModelsJsonProvider>;
}

export interface OAuthProviderStatus {
  id: string;
  name: string;
  connected: boolean;
}

export interface ApiKeyProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  modelCount: number;
}

export interface ModelsTabData {
  providers: CustomProviderSummary[];
  modelsJson: ModelsJson;
  oauthStatuses: OAuthProviderStatus[];
  apikeyStatuses: ApiKeyProviderStatus[];
}

/** Mirrors `AgentFile` in `src/services/agents/agents-config.ts`. */
export interface AgentItem {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  disableModelInvocation: boolean;
  isBuiltin: boolean;
  hasOverride: boolean;
  source: "builtin" | "user" | "project";
  filePath: string;
}

export interface AgentsTabData {
  agents: AgentItem[];
  hasWorkspace: boolean;
  /** `provider/modelId` keys offered by the Model picker. */
  models: string[];
}

/** One prompt template reported by pi's resource loader. */
export interface PromptItem {
  name: string;
  description: string;
  argumentHint: string | null;
  content: string;
  filePath: string;
  scope: string;
  origin: string;
  source: string;
  /** False for package/builtin prompts, which the UI must not offer to edit. */
  editable: boolean;
  sourceLabel: string;
}

export interface PromptsTabData {
  prompts: PromptItem[];
  hasWorkspace: boolean;
}

/** One skill reported by pi's resource loader. */
export interface SkillItem {
  name: string;
  description: string;
  disableModelInvocation: boolean;
  body: string;
  filePath: string;
  baseDir: string;
  scope: string;
  sourceLabel: string;
  editable: boolean;
}

export interface SkillsTabData {
  skills: SkillItem[];
  hasWorkspace: boolean;
}

/** Mirrors `ServerEntry` in `src/services/mcp/mcp-config.ts`. */
export interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  bearerToken?: string;
  disabled?: boolean;
  directTools?: string[] | boolean;
}

export interface McpServerItem {
  name: string;
  entry: McpServerEntry;
  source: SettingsScope;
}

export interface McpTabData {
  servers: McpServerItem[];
  hasWorkspace: boolean;
  userPath: string;
  projectPath: string;
}

export interface CommitTabData {
  commitModel: string;
  commitLanguage: string;
  commitMessagePrompt: string;
  /** `pi-agent-chat.commitLanguage` enum, sourced from the host. */
  languages: string[];
  models: string[];
}

export interface SysPromptTabData {
  systemPrompt: { content: string };
  appendSystemPrompt: { content: string };
}

/** `~/.pi/agent/settings.json`, verbatim. */
export interface GeneralTabData {
  values: Record<string, unknown>;
}

/** Tab id -> the payload `buildTabData` produces for it. */
export interface SettingsTabDataMap {
  models: ModelsTabData;
  agents: AgentsTabData;
  prompts: PromptsTabData;
  skills: SkillsTabData;
  mcp: McpTabData;
  commit: CommitTabData;
  sysprompt: SysPromptTabData;
  settings: GeneralTabData;
}

// ---------------------------------------------------------------------------
// OAuth progress — mirrors `OAuthProgressEvent` in services/models/oauth-flow.ts
// ---------------------------------------------------------------------------

export interface OAuthProgressEvent {
  type:
    | "auth_url"
    | "device_code"
    | "prompt"
    | "select"
    | "progress"
    | "success"
    | "error"
    | "cancelled";
  url?: string;
  instructions?: string;
  userCode?: string;
  verificationUri?: string;
  message?: string;
  placeholder?: string;
  options?: { id: string; label: string }[];
  /** Correlates a `respond` message with the prompt that asked for it. */
  token?: string;
}

// ---------------------------------------------------------------------------
// webview -> settings host
// ---------------------------------------------------------------------------

/** Form payload written into a user/project agent markdown file. */
export interface AgentFormData {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  disableModelInvocation: boolean;
}

/** Form payload written into a prompt template markdown file. */
export interface PromptFormData {
  name: string;
  description: string;
  argumentHint: string;
  content: string;
}

/** Form payload written into a SKILL.md file. */
export interface SkillFormData {
  name: string;
  description: string;
  body: string;
  disableModelInvocation: boolean;
}

/**
 * The MCP editor's raw form. `parseServerEntry` on the host turns the newline
 * separated strings into arrays/records, so the shape is deliberately flat.
 */
export interface McpServerForm {
  name: string;
  _transport?: string;
  command?: string;
  args?: string;
  env?: string;
  cwd?: string;
  url?: string;
  headers?: string;
  bearerToken?: string;
  disabled?: boolean;
  directTools?: string;
  directToolsAll?: boolean;
}

export type WebviewToSettings =
  /** Sent once the Vue app has mounted; the host answers with `init`. */
  | { type: "ready" }
  /** Fetch one tab's data. The host replies with `tabData` (or `error`). */
  | { type: "tabLoad"; tab: SettingsTabId }
  /** Reload the given tab — same handler as `tabLoad`, used by the nav button. */
  | { type: "refresh"; tab: SettingsTabId }
  // ---- models ----
  | { type: "openModelsFile" }
  | { type: "addProvider"; name: string; entry: Record<string, unknown> }
  | { type: "updateProvider"; name: string; updates: Record<string, unknown> }
  | {
      type: "renameProviderAndUpdate";
      oldName: string;
      newName: string;
      updates: Record<string, unknown>;
    }
  | { type: "deleteProvider"; name: string }
  | { type: "addModel"; providerName: string; model: Record<string, unknown> }
  | {
      type: "updateModel";
      providerName: string;
      modelId: string;
      updates: Record<string, unknown>;
    }
  | { type: "deleteModel"; providerName: string; modelId: string }
  | { type: "oauthLogin"; providerId: string }
  | { type: "oauthRespond"; token: string; value: string }
  | { type: "oauthCancel" }
  | { type: "oauthLogout"; providerId: string }
  | { type: "saveApiKey"; providerId: string; apiKey: string }
  | { type: "removeApiKey"; providerId: string }
  | { type: "writeModelsJson"; data: ModelsJson }
  // ---- agents ----
  | { type: "createAgent"; scope: string; data: AgentFormData }
  | { type: "updateAgent"; scope: string; data: AgentFormData }
  | { type: "deleteAgent"; name: string; scope: string }
  | { type: "resetBuiltin"; name: string; scope: string }
  | { type: "openAgentFile"; filePath: string }
  // ---- prompts ----
  | { type: "createPrompt"; scope: string; data: PromptFormData }
  | { type: "updatePrompt"; scope: string; data: PromptFormData }
  | { type: "deletePrompt"; name: string; scope: string }
  | { type: "openPromptFile"; filePath: string }
  // ---- skills ----
  | { type: "createSkill"; scope: string; data: SkillFormData }
  | { type: "updateSkill"; filePath: string; data: SkillFormData }
  | { type: "deleteSkill"; baseDir: string }
  | { type: "openSkillFile"; filePath: string }
  // ---- mcp ----
  | { type: "openMcpFile"; scope: string }
  | { type: "addServer"; name: string; scope: string; entry: McpServerForm }
  | { type: "updateServer"; name: string; scope: string; entry: McpServerForm }
  | { type: "deleteServer"; name: string; scope: string }
  | { type: "toggleDisabled"; name: string; scope: string }
  // ---- settings.json ----
  | { type: "saveSettings"; patch: Record<string, unknown> }
  | { type: "openSettingsFile" }
  // ---- system prompt ----
  | { type: "saveSystemPrompt"; content: string }
  | { type: "saveAppendSystemPrompt"; content: string }
  | { type: "openSystemPromptFile" }
  | { type: "openAppendSystemPromptFile" }
  // ---- commit message ----
  | {
      type: "saveCommitConfig";
      commitModel: string;
      commitLanguage: string;
      commitMessagePrompt: string;
    };

// ---------------------------------------------------------------------------
// settings host -> webview
// ---------------------------------------------------------------------------

/** Which save confirmation arrived; each maps to its own toast. */
export type SavedWhat = "settings" | "system" | "append" | "commit";

export type SettingsToWebview =
  /** Answer to `ready`: the boot burst that enables the whole page. */
  | {
      type: "init";
      lang: string;
      hasWorkspace: boolean;
      /** Set when the panel was opened from the command palette with a tab. */
      initialTab: string | null;
      tabs: string[];
    }
  /** Sent when an already-open panel is re-opened with a different tab. */
  | { type: "setTab"; tab: string }
  | { type: "tabData"; tab: string; data: Record<string, unknown> }
  | { type: "oauthProgress"; event: OAuthProgressEvent }
  | { type: "saved"; what: SavedWhat }
  | { type: "error"; message: string };

/** Narrowing helper, matching `MessageOf` in `./messages.ts`. */
export type SettingsMessageOf<T extends { type: string }, K extends T["type"]> = Extract<
  T,
  { type: K }
>;
