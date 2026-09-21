// The `~/.pi/agent/settings.json` schema the General tab renders: sixteen
// groups of typed fields, ported verbatim from the legacy `tabs/settings.ts`.
//
// Only presentation lives here; the dirty-tracking and patch-building rules live
// in the helpers below, mirroring the legacy `currentValue` / `setAt` pair.

import { t } from "@/lib/i18n.ts";

export type SettingFieldType = "bool" | "enum" | "number" | "string" | "string[]" | "json";

export interface SettingField {
  /** Dotted path inside settings.json, e.g. `compaction.enabled`. */
  key: string;
  label: string;
  type: SettingFieldType;
  desc?: string;
  options?: string[];
  /**
   * Display text per `options` entry, same order. Without it a select shows the
   * raw value, which reads wrong for an enum whose values are English idiom
   * (`queue` / `steer`) inside a translated panel.
   */
  optionLabels?: string[];
  /** Value shown when settings.json has no entry for `key`. */
  def?: unknown;
  placeholder?: string;
  min?: number;
  max?: number;
}

export interface SettingGroup {
  title: string;
  fields: SettingField[];
}

export const SETTING_GROUPS: readonly SettingGroup[] = [
  {
    title: t("Model & Thinking"),
    fields: [
      {
        key: "defaultProvider",
        label: t("Default provider"),
        type: "string",
        placeholder: "anthropic",
      },
      {
        key: "defaultModel",
        label: t("Default model"),
        type: "string",
        placeholder: "claude-sonnet-4-20250514",
      },
      {
        key: "defaultThinkingLevel",
        label: t("Default thinking level"),
        type: "enum",
        options: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
      },
      {
        key: "hideThinkingBlock",
        label: t("Hide thinking block"),
        type: "bool",
        desc: t("Hide thinking blocks in output"),
      },
      {
        key: "showCacheMissNotices",
        label: t("Show cache-miss notices"),
        type: "bool",
        desc: t("Show transcript notices for significant prompt-cache misses"),
      },
      {
        key: "thinkingBudgets",
        label: t("Thinking budgets"),
        type: "json",
        desc: t('Custom token budgets per thinking level, e.g. {"low": 4096}'),
      },
    ],
  },
  {
    title: t("UI & Display"),
    fields: [
      { key: "theme", label: t("Theme"), type: "string", def: "dark", placeholder: "dark" },
      {
        key: "externalEditor",
        label: t("External editor"),
        type: "string",
        desc: t('Command for Ctrl+G external editor (e.g. "code --wait")'),
      },
      {
        key: "quietStartup",
        label: t("Quiet startup"),
        type: "bool",
        desc: t("Hide startup header"),
      },
      {
        key: "defaultProjectTrust",
        label: t("Default project trust"),
        type: "enum",
        options: ["ask", "always", "never"],
        desc: t("Fallback project trust behavior (global only)"),
      },
      {
        key: "collapseChangelog",
        label: t("Collapse changelog"),
        type: "bool",
        desc: t("Show condensed changelog after updates"),
      },
      { key: "enableInstallTelemetry", label: t("Install telemetry"), type: "bool", def: true },
      {
        key: "enableAnalytics",
        label: t("Analytics"),
        type: "bool",
        desc: t("Opt-in analytics data sharing"),
      },
      { key: "trackingId", label: t("Tracking ID"), type: "string" },
      {
        key: "doubleEscapeAction",
        label: t("Double-escape action"),
        type: "enum",
        options: ["tree", "fork", "none"],
        def: "tree",
      },
      {
        key: "treeFilterMode",
        label: t("Tree filter mode"),
        type: "enum",
        options: ["default", "no-tools", "user-only", "labeled-only", "all"],
        def: "default",
      },
      {
        key: "editorPaddingX",
        label: t("Editor padding X"),
        type: "number",
        min: 0,
        max: 3,
        def: 0,
      },
      { key: "outputPad", label: t("Output pad"), type: "number", min: 0, max: 1, def: 1 },
      {
        key: "autocompleteMaxVisible",
        label: t("Autocomplete max visible"),
        type: "number",
        min: 3,
        max: 20,
        def: 5,
      },
      {
        key: "showHardwareCursor",
        label: t("Show hardware cursor"),
        type: "bool",
        desc: t("Show the terminal cursor while TUI positions it for IME support"),
      },
      {
        key: "tuiMode",
        label: t("TUI mode"),
        type: "enum",
        options: ["regular", "fullscreen"],
        def: "regular",
        desc: t('Interactive TUI mode: "regular" or experimental "fullscreen"'),
      },
      {
        key: "fullscreenScrollbar",
        label: t("Fullscreen scrollbar"),
        type: "enum",
        options: ["auto", "always", "hidden"],
        def: "auto",
        desc: t(
          'Fullscreen transcript scrollbar: "auto" shows it while scrolling, "always" keeps it visible, "hidden" hides it',
        ),
      },
    ],
  },
  {
    title: t("Network"),
    fields: [
      {
        key: "httpProxy",
        label: t("HTTP proxy"),
        type: "string",
        placeholder: "http://127.0.0.1:7890",
        desc: t("Applied as HTTP_PROXY and HTTPS_PROXY (global only)"),
      },
    ],
  },
  {
    title: t("Warnings"),
    fields: [
      {
        key: "warnings.anthropicExtraUsage",
        label: t("Anthropic extra usage warning"),
        type: "bool",
        def: true,
        desc: t("Show a warning when Anthropic subscription auth may use paid extra usage"),
      },
    ],
  },
  {
    title: t("Compaction"),
    fields: [
      {
        key: "compaction.enabled",
        label: t("Enabled"),
        type: "bool",
        def: true,
        desc: t("Enable auto-compaction"),
      },
      {
        key: "compaction.reserveTokens",
        label: t("Reserve tokens"),
        type: "number",
        def: 16384,
        desc: t("Tokens reserved for LLM response"),
      },
      {
        key: "compaction.keepRecentTokens",
        label: t("Keep recent tokens"),
        type: "number",
        def: 20000,
        desc: t("Recent tokens to keep (not summarized)"),
      },
    ],
  },
  {
    title: t("Branch Summary"),
    fields: [
      {
        key: "branchSummary.reserveTokens",
        label: t("Reserve tokens"),
        type: "number",
        def: 16384,
        desc: t("Tokens reserved for branch summarization"),
      },
      {
        key: "branchSummary.skipPrompt",
        label: t("Skip prompt"),
        type: "bool",
        desc: t('Skip "Summarize branch?" prompt on /tree navigation'),
      },
    ],
  },
  {
    title: t("Retry"),
    fields: [
      {
        key: "retry.enabled",
        label: t("Enabled"),
        type: "bool",
        def: true,
        desc: t("Enable automatic agent-level retry on transient errors"),
      },
      { key: "retry.maxRetries", label: t("Max retries"), type: "number", def: 3 },
      {
        key: "retry.baseDelayMs",
        label: t("Base delay (ms)"),
        type: "number",
        def: 2000,
        desc: t("Exponential backoff base (2s, 4s, 8s)"),
      },
      { key: "retry.provider.timeoutMs", label: t("Provider timeout (ms)"), type: "number" },
      {
        key: "retry.provider.maxRetries",
        label: t("Provider max retries"),
        type: "number",
        def: 0,
      },
      {
        key: "retry.provider.maxRetryDelayMs",
        label: t("Provider max retry delay (ms)"),
        type: "number",
        def: 60000,
      },
    ],
  },
  {
    title: t("Message Delivery"),
    // `steeringMode` / `followUpMode` are deliberately absent: they only release
    // messages pi already holds, so a panel that also owns our pending queue
    // would be one knob for two different queues. pi reads them from
    // settings.json still — `pi-agent-chat.openSettingsJson` is the way in.
    fields: [
      {
        key: "transport",
        label: t("Transport"),
        type: "enum",
        options: ["sse", "websocket", "websocket-cached", "auto"],
        def: "auto",
      },
      { key: "httpIdleTimeoutMs", label: t("HTTP idle timeout (ms)"), type: "number", def: 300000 },
      {
        key: "websocketConnectTimeoutMs",
        label: t("WebSocket connect timeout (ms)"),
        type: "number",
        def: 15000,
      },
    ],
  },
  {
    title: t("Images"),
    fields: [
      {
        key: "images.autoResize",
        label: t("Auto-resize images"),
        type: "bool",
        def: true,
        desc: t("Resize images to 2000x2000 max"),
      },
      {
        key: "images.blockImages",
        label: t("Block images"),
        type: "bool",
        desc: t("Block all images from being sent to the LLM"),
      },
    ],
  },
  {
    title: t("Shell"),
    fields: [
      {
        key: "shellPath",
        label: t("Shell path"),
        type: "string",
        desc: t("Custom shell path (e.g. for Cygwin on Windows)"),
      },
      {
        key: "shellCommandPrefix",
        label: t("Command prefix"),
        type: "string",
        desc: t('Prefix for every bash command (e.g. "shopt -s expand_aliases")'),
      },
      {
        key: "npmCommand",
        label: t("npm command"),
        type: "string[]",
        desc: t("Command argv for npm operations (one entry per line)"),
      },
    ],
  },
  {
    title: t("Sessions"),
    fields: [
      {
        key: "sessionDir",
        label: t("Session directory"),
        type: "string",
        placeholder: ".pi/sessions",
      },
    ],
  },
  {
    title: t("Model Cycling"),
    fields: [
      {
        key: "enabledModels",
        label: t("Enabled models"),
        type: "string[]",
        desc: t("Model patterns for Ctrl+P cycling (one per line, globs like claude-* supported)"),
      },
    ],
  },
  {
    title: t("Markdown"),
    fields: [
      { key: "markdown.codeBlockIndent", label: t("Code block indent"), type: "string", def: "  " },
      {
        key: "markdown.mermaid",
        label: t("Mermaid rendering"),
        type: "enum",
        options: ["off", "final", "streaming"],
        def: "streaming",
        desc: t('Mermaid rendering mode: "off", "final", or "streaming"'),
      },
    ],
  },
  {
    title: t("Resources"),
    fields: [
      {
        key: "packages",
        label: t("Packages"),
        type: "json",
        desc: t("npm/git packages to load resources from (JSON array)"),
      },
      {
        key: "extensions",
        label: t("Extensions"),
        type: "string[]",
        desc: t("Local extension file paths or directories (one per line)"),
      },
      {
        key: "skills",
        label: t("Skills"),
        type: "string[]",
        desc: t("Local skill file paths or directories (one per line)"),
      },
      {
        key: "prompts",
        label: t("Prompts"),
        type: "string[]",
        desc: t("Local prompt template paths or directories (one per line)"),
      },
      {
        key: "themes",
        label: t("Themes"),
        type: "string[]",
        desc: t("Local theme file paths or directories (one per line)"),
      },
      {
        key: "enableSkillCommands",
        label: t("Enable skill commands"),
        type: "bool",
        def: true,
        desc: t("Register skills as /skill:name commands"),
      },
    ],
  },
];

/**
 * The 常规 tab: settings that live in VS Code's own config (`pi-agent-chat.*`)
 * rather than `~/.pi/agent/settings.json`, because pi does not read them — they
 * decide how *our* composer and transcript behave. Kept in their own array so a
 * field here can never be mistaken for one pi will honour.
 */
export const CHAT_SETTING_GROUPS: readonly SettingGroup[] = [
  {
    // Not 「消息投递」 — pi's tab already owns that title for its release
    // strategies, and two groups answering to one name read as a bug.
    title: t("Chat Behaviour"),
    fields: [
      {
        key: "chatRunningSendBehavior",
        label: t("Running send mode"),
        type: "enum",
        options: ["queue", "steer"],
        optionLabels: [t("Queue"), t("Steer")],
        def: "queue",
        desc: t("What a message sent while the agent is working does by default."),
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// value helpers
// ---------------------------------------------------------------------------

/** What the editor holds: a checkbox boolean, or a text/number/JSON string. */
export type EditorValue = string | boolean;

export function getAt(values: Record<string, unknown>, path: string): unknown {
  let current: unknown = values;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Nested write, creating intermediate objects — the shape `saveSettings` wants. */
export function setAt(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] ?? "";
    const next = current[part];
    if (next === null || typeof next !== "object" || Array.isArray(next)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1] ?? ""] = value;
}

/** settings.json value with the field's default applied. */
export function initialValue(field: SettingField, values: Record<string, unknown>): unknown {
  return getAt(values, field.key) ?? field.def;
}

export function toEditor(field: SettingField, initial: unknown): EditorValue {
  switch (field.type) {
    case "bool":
      return initial === true;
    case "string[]":
      return Array.isArray(initial) ? initial.map(String).join("\n") : "";
    case "json": {
      if (initial === undefined || initial === null) return "";
      try {
        return JSON.stringify(initial);
      } catch {
        return "";
      }
    }
    default:
      return initial === undefined || initial === null ? "" : String(initial);
  }
}

export interface EditorRead {
  dirty: boolean;
  /** `undefined` clears the key from settings.json. */
  value: unknown;
  /** True when a JSON field cannot be parsed, so the caller refuses to save. */
  error?: boolean;
}

/** Compare an editor value against the value it started from. */
export function readEditor(field: SettingField, editor: EditorValue, initial: unknown): EditorRead {
  switch (field.type) {
    case "bool": {
      const value = editor === true;
      return { dirty: value !== (initial === true), value };
    }
    case "number": {
      const raw = typeof editor === "string" ? editor : String(editor);
      if (raw === "") return { dirty: initial !== undefined && initial !== null, value: undefined };
      const value = Number(raw);
      return { dirty: value !== Number(initial), value };
    }
    case "string[]": {
      const raw = typeof editor === "string" ? editor : String(editor);
      const value = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const before = Array.isArray(initial) ? initial.map(String) : [];
      const same = value.length === before.length && value.every((x, i) => x === before[i]);
      return { dirty: !same, value };
    }
    case "json": {
      const raw = (typeof editor === "string" ? editor : String(editor)).trim();
      if (raw === "") return { dirty: initial !== undefined && initial !== null, value: undefined };
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { dirty: true, value: undefined, error: true };
      }
      const same = JSON.stringify(parsed) === JSON.stringify(initial ?? null);
      return { dirty: !same, value: parsed };
    }
    default: {
      const value = typeof editor === "string" ? editor : String(editor);
      return { dirty: value !== String(initial ?? ""), value };
    }
  }
}

/** Deep-merge a settings patch, mirroring the host's `mergeSettingsPatch`. */
export function mergeValues(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      out[key] = mergeValues(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}
