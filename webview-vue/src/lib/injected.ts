// Typed access to the configuration the extension host substitutes into the
// built HTML. Values are unresolved placeholder needles when the host did not
// provide them, so every accessor validates.

import type { ChatDisplaySettings } from "@protocol/messages";

const PLACEHOLDER = /^PI_[A-Z_]+_PLACEHOLDER$/;

interface InjectedConfig {
  home: string;
  sep: string;
  workspace: string;
  lang: string;
  mermaidTheme: string;
  /** JSON-encoded `ChatDisplaySettings`. */
  display: string;
}

const raw = (key: keyof InjectedConfig): string => {
  const value = window.__PI__?.[key];
  if (typeof value !== "string" || PLACEHOLDER.test(value)) return "";
  return value;
};

/** Home directory used to abbreviate paths. */
export const homeDir = (): string => raw("home");

/** Path separator reported by the host. */
export const pathSep = (): string => raw("sep") || "/";

/** Workspace root, used to shorten file paths in tool output. */
export const workspaceDir = (): string => raw("workspace");

/** Resolved UI language, e.g. `"en"` or `"zh-cn"`. */
export const language = (): string => raw("lang") || "en";

/** Mermaid theme name for rendered diagrams. */
export const mermaidTheme = (): string => raw("mermaidTheme") || "default";

/**
 * Display preferences. Doubles as the initial value for the live store: the
 * host pushes the same object again on every configuration change so the
 * webview never needs a reload to pick a change up.
 */
export function displaySettings(): ChatDisplaySettings {
  const defaults: ChatDisplaySettings = {
    fontSize: 13,
    backgroundImage: "",
    backgroundOpacity: 1,
    sendShortcut: "enter",
    runningSendBehavior: "queue",
    collapseWork: true,
    showToolCallCount: true,
    expandToolCalls: false,
    expandThinking: false,
    keepReadingAnchor: false,
  };

  const encoded = raw("display");
  if (!encoded) return defaults;
  try {
    const parsed = JSON.parse(encoded) as Partial<ChatDisplaySettings>;
    return { ...defaults, ...parsed };
  } catch {
    // A malformed payload means the host substituted something unexpected;
    // falling back to defaults keeps the webview usable.
    return defaults;
  }
}
