// Typed access to the configuration the extension host substitutes into the
// built HTML. Values are unresolved placeholder needles when the host did not
// provide them, so every accessor validates.

const PLACEHOLDER = /^PI_[A-Z_]+_PLACEHOLDER$/;

interface InjectedConfig {
  home: string;
  sep: string;
  workspace: string;
  fontSize: string;
  lang: string;
  mermaidTheme: string;
  bgImage: string;
  bgOpacity: string;
  sendShortcut: string;
}

const raw = (key: keyof InjectedConfig): string => {
  const value = window.__PI__?.[key];
  if (typeof value !== "string" || PLACEHOLDER.test(value)) return "";
  return value;
};

const number = (key: keyof InjectedConfig, fallback: number): number => {
  const parsed = Number(raw(key));
  return Number.isFinite(parsed) ? parsed : fallback;
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

/** Base font size in px for the chat transcript. */
export const chatFontSize = (): number => number("fontSize", 13);

/** Chat send shortcut: `"enter"` or `"ctrlEnter"`. */
export const sendShortcut = (): "enter" | "ctrlEnter" =>
  raw("sendShortcut") === "ctrlEnter" ? "ctrlEnter" : "enter";

/** Optional chat background image as a data URL. */
export const backgroundImage = (): string => raw("bgImage");

/** Background image opacity, clamped to 0..1. */
export const backgroundOpacity = (): number => Math.min(1, Math.max(0, number("bgOpacity", 1)));
