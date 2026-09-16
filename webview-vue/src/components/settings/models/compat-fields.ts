// The per-provider / per-model compatibility override table.
//
// `pi` reads every one of these from `models.json`'s `compat` object; the UI
// exposes them as a tri-state bool, a select, or a JSON blob, grouped by the API
// protocol they belong to. Ported verbatim from the legacy `models.ts`.

import { t } from "@/lib/i18n.ts";

export type CompatFieldType = "bool" | "select" | "json";
export type CompatGroup = "openai" | "anthropic";

export interface CompatFieldDef {
  name: string;
  type: CompatFieldType;
  options?: readonly string[];
  group: CompatGroup;
}

export const COMPAT_FIELDS: readonly CompatFieldDef[] = [
  { name: "supportsStore", type: "bool", group: "openai" },
  { name: "supportsDeveloperRole", type: "bool", group: "openai" },
  { name: "supportsReasoningEffort", type: "bool", group: "openai" },
  { name: "supportsUsageInStreaming", type: "bool", group: "openai" },
  { name: "supportsStrictMode", type: "bool", group: "openai" },
  { name: "supportsOpenAIGrammarTools", type: "bool", group: "openai" },
  { name: "requiresToolResultName", type: "bool", group: "openai" },
  { name: "requiresAssistantAfterToolResult", type: "bool", group: "openai" },
  { name: "requiresThinkingAsText", type: "bool", group: "openai" },
  { name: "requiresReasoningContentOnAssistantMessages", type: "bool", group: "openai" },
  { name: "sendSessionAffinityHeaders", type: "bool", group: "openai" },
  { name: "supportsLongCacheRetention", type: "bool", group: "openai" },
  { name: "supportsFinishReason", type: "bool", group: "openai" },
  {
    name: "maxTokensField",
    type: "select",
    group: "openai",
    options: ["", "max_completion_tokens", "max_tokens"],
  },
  {
    name: "thinkingFormat",
    type: "select",
    group: "openai",
    options: [
      "",
      "openai",
      "openrouter",
      "deepseek",
      "together",
      "baseten",
      "zai",
      "qwen",
      "chat-template",
      "qwen-chat-template",
      "string-thinking",
      "ant-ling",
    ],
  },
  { name: "cacheControlFormat", type: "select", group: "openai", options: ["", "anthropic"] },
  {
    name: "sessionAffinityFormat",
    type: "select",
    group: "openai",
    options: ["", "openai", "openai-nosession", "openrouter"],
  },
  { name: "deferredToolsMode", type: "select", group: "openai", options: ["", "kimi"] },
  { name: "chatTemplateKwargs", type: "json", group: "openai" },
  { name: "chatTemplateArgs", type: "json", group: "openai" },
  { name: "openRouterRouting", type: "json", group: "openai" },
  { name: "vercelGatewayRouting", type: "json", group: "openai" },
  { name: "supportsEagerToolInputStreaming", type: "bool", group: "anthropic" },
  { name: "supportsCacheControlOnTools", type: "bool", group: "anthropic" },
  { name: "forceAdaptiveThinking", type: "bool", group: "anthropic" },
  { name: "allowEmptySignature", type: "bool", group: "anthropic" },
  { name: "supportsStrictTools", type: "bool", group: "anthropic" },
];

/** API protocol options, `""` meaning "inherit from the provider". */
export const API_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "(default)" },
  { value: "openai-completions", label: "OpenAI Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
];

/**
 * Which compat groups apply to an API protocol. An unset protocol (`""`) can be
 * either, so both groups stay visible.
 */
export function compatVisibility(api: string): Record<CompatGroup, boolean> {
  return {
    openai: api === "" || api === "openai-completions" || api === "openai-responses",
    anthropic: api === "" || api === "anthropic-messages",
  };
}

/** A bool override renders as a three-way select: unset / true / false. */
export function boolOverrideValue(current: unknown): "Default" | "True" | "False" {
  if (current === true) return "True";
  if (current === false) return "False";
  return "Default";
}

export function safeJsonStringify(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2);
    return text === undefined ? "" : text;
  } catch {
    return "";
  }
}

/**
 * The editors' intermediate representation: every field as a plain string, so
 * an invalid JSON blob can survive while it is being typed. `serializeCompat`
 * turns it back into the `compat` object `models.json` stores.
 */
export type CompatDraft = Record<string, string>;

export function compatDraftFrom(compat: Record<string, unknown> | undefined): CompatDraft {
  const draft: CompatDraft = {};
  for (const field of COMPAT_FIELDS) {
    const current = compat?.[field.name];
    if (field.type === "bool") draft[field.name] = boolOverrideValue(current);
    else if (field.type === "select")
      draft[field.name] = typeof current === "string" ? current : "";
    else draft[field.name] = current == null ? "" : safeJsonStringify(current);
  }
  return draft;
}

/**
 * Serialise a draft into a `compat` object. Fields belonging to a group that the
 * selected API protocol hides are skipped, so switching protocols never writes
 * the other group's overrides.
 */
export function serializeCompat(
  draft: CompatDraft,
  api: string,
): { value: Record<string, unknown> | null; errors: string[] } {
  const flags = compatVisibility(api);
  const result: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const field of COMPAT_FIELDS) {
    if (!flags[field.group]) continue;
    const raw = draft[field.name] ?? "";
    if (field.type === "bool") {
      if (raw === "True") result[field.name] = true;
      else if (raw === "False") result[field.name] = false;
    } else if (field.type === "select") {
      if (raw) result[field.name] = raw;
    } else {
      const text = raw.trim();
      if (!text) continue;
      try {
        result[field.name] = JSON.parse(text);
      } catch {
        errors.push(t("Invalid JSON in {0}", field.name));
      }
    }
  }
  return { value: Object.keys(result).length === 0 ? null : result, errors };
}
