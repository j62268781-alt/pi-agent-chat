// Substitutes the host-injected configuration into the built chat webview HTML.

import type { ChatDisplaySettings } from "../../protocol/messages.ts";
import chatHtml from "../../../webview-vue/dist/chat/index.html?raw";

export interface ChatWebviewOptions {
  /** Home directory, used by the webview to abbreviate paths to `~/…`. */
  home: string;
  /** Platform path separator. */
  sep: string;
  /** Workspace root used to make tool paths relative. */
  workspace?: string;
  /** Resolved UI language; selects the translation bundle. */
  language: string;
  /** Mermaid theme name. */
  mermaidTheme: string;
  /** Initial display preferences; re-pushed on change. */
  display: ChatDisplaySettings;
}

/**
 * Escape a value for embedding inside a double-quoted JavaScript string in the
 * HTML. `<` is escaped too so a value can never close the surrounding script.
 */
function escapeJsString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/</g, "\\u003c");
}

export function getChatWebviewHtml(options: ChatWebviewOptions): string {
  const replaceAll = (haystack: string, needle: string, value: string) =>
    haystack.split(needle).join(value);

  let html = chatHtml;
  html = replaceAll(html, "PI_HOME_PLACEHOLDER", escapeJsString(options.home));
  html = replaceAll(html, "PI_SEP_PLACEHOLDER", escapeJsString(options.sep));
  html = replaceAll(html, "PI_WORKSPACE_PLACEHOLDER", escapeJsString(options.workspace ?? ""));
  html = replaceAll(html, "PI_LANG_PLACEHOLDER", escapeJsString(options.language));
  html = replaceAll(html, "PI_MERMAID_THEME_PLACEHOLDER", escapeJsString(options.mermaidTheme));
  // Embedded as a JSON *string* so an unreplaced needle still parses.
  html = replaceAll(
    html,
    "PI_DISPLAY_PLACEHOLDER",
    escapeJsString(JSON.stringify(options.display)),
  );
  return html;
}
