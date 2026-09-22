// Reads the `pi-agent-chat.chat*` display settings into the shape the webview
// expects.
//
// Both chat hosts funnel through here so the HTML bootstrap payload and the
// live `displaySettings` push can never drift apart.

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, sep } from "node:path";
import * as vscode from "vscode";
import type { ChatDisplaySettings } from "../../protocol/messages.ts";
import { getLocale } from "../../utils/i18n.ts";
import { resolveUiMode } from "../../utils/ui-mode.ts";
import type { ChatWebviewOptions } from "./webview-html.ts";

const BG_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

const MAX_BG_SIZE = 10 * 1024 * 1024;

/**
 * Inline a local image as a data URL so the webview needs no `localResourceRoots`
 * entry for it. Returns `""` for anything unusable (missing, too large, not an
 * image).
 */
export function resolveChatBackground(path?: string): string {
  if (!path || !isAbsolute(path)) return "";
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return "";
  }
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BG_SIZE) return "";
  const mime = BG_MIME[extname(path).toLowerCase()];
  if (!mime) return "";
  try {
    return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
  } catch {
    return "";
  }
}

/** Snapshot the display settings; safe to call from a config-change listener. */
export function readChatDisplaySettings(): ChatDisplaySettings {
  const config = vscode.workspace.getConfiguration("pi-agent-chat");
  return {
    fontSize: config.get<number>("chatFontSize") ?? 13,
    surface: resolveUiMode() === "sidebar" ? "sidebar" : "editor",
    backgroundImage: resolveChatBackground(config.get<string>("chatBackgroundImage")),
    backgroundOpacity: config.get<number>("chatBackgroundOpacity") ?? 1,
    sendShortcut: config.get<string>("chatSendShortcut") === "ctrlEnter" ? "ctrlEnter" : "enter",
    runningSendBehavior:
      config.get<string>("chatRunningSendBehavior") === "steer" ? "steer" : "queue",
    collapseWork: config.get<boolean>("chatCollapseWork") ?? true,
    expandToolCalls: config.get<boolean>("chatExpandToolCalls") ?? false,
    expandThinking: config.get<boolean>("chatExpandThinking") ?? false,
    keepReadingAnchor: config.get<boolean>("chatKeepReadingAnchor") ?? false,
    completionSound: config.get<boolean>("chatCompletionSound") ?? true,
  };
}

/**
 * The full bootstrap payload for `getChatWebviewHtml`. Both hosts call this so
 * the panel payload cannot drift from the sidebar's.
 */
export function buildChatWebviewOptions(workspace?: string): ChatWebviewOptions {
  return {
    home: homedir(),
    sep,
    workspace: workspace ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    language: getLocale(),
    mermaidTheme:
      vscode.workspace.getConfiguration("pi-agent-chat").get<string>("chatMermaidTheme") ??
      "default",
    display: readChatDisplaySettings(),
  };
}

/**
 * Settings whose change can be applied by pushing `displaySettings` again,
 * without re-rendering the webview.
 */
const LIVE_KEYS = [
  "chatFontSize",
  "chatBackgroundImage",
  "chatBackgroundOpacity",
  "chatSendShortcut",
  "chatRunningSendBehavior",
  "chatCollapseWork",
  "chatExpandToolCalls",
  "chatExpandThinking",
  "chatKeepReadingAnchor",
  "chatCompletionSound",
] as const;

/** True when the change only needs a `displaySettings` push. */
export function affectsLiveDisplaySettings(event: vscode.ConfigurationChangeEvent): boolean {
  return LIVE_KEYS.some((key) => event.affectsConfiguration(`pi-agent-chat.${key}`));
}

/**
 * Settings baked into the HTML at creation and only re-read by a full webview
 * reload: the locale picks the translation bundle at module scope, and the
 * mermaid theme is consumed once when mermaid initialises.
 */
export function affectsBakedHtml(event: vscode.ConfigurationChangeEvent): boolean {
  return (
    event.affectsConfiguration("pi-agent-chat.language") ||
    event.affectsConfiguration("pi-agent-chat.chatMermaidTheme")
  );
}
