// A stand-in for the settings extension host, so the settings webview can be
// looked at without opening VS Code.
//
// The contract (`src/protocol/settings.ts`) is small at boot: the page sends
// `ready`, the host answers `init` (which selects the first tab), and each tab
// asks for its data with `tabLoad`. Reads and the five save messages are served
// from fixtures; the mutations (add provider, write a prompt…) are ignored —
// this harness is for looking at, not for exercising the file system.
//
// `lib/bridge.ts` grabs `acquireVsCodeApi()` at module scope, so this must run
// before the app module is imported. `settings-main.ts` installs it first and
// only then dynamically imports the page.

import type { SettingsTabId, SettingsToWebview, WebviewToSettings } from "@protocol/settings";
import { SETTINGS_TAB_IDS } from "@protocol/settings";
import { SETTINGS_FIXTURES } from "./settings-fixtures";

declare global {
  interface Window {
    acquireVsCodeApi?: () => {
      postMessage(message: unknown): void;
      getState<T = unknown>(): T | undefined;
      setState: (_state: unknown) => void;
    };
  }
}

const params = new URLSearchParams(location.search);

/** Deliver a host message the way `webview.postMessage` does. */
function reply(message: SettingsToWebview): void {
  window.postMessage(message, "*");
}

function sendTabData(tab: SettingsTabId): void {
  const data = SETTINGS_FIXTURES[tab] as unknown as Record<string, unknown>;
  reply({ type: "tabData", tab, data });
}

function handle(message: WebviewToSettings): void {
  switch (message.type) {
    case "ready":
      reply({
        type: "init",
        lang: params.get("lang") ?? "zh-cn",
        hasWorkspace: true,
        initialTab: params.get("tab"),
        tabs: [...SETTINGS_TAB_IDS],
      });
      break;
    case "tabLoad":
    case "refresh":
      sendTabData(message.tab);
      break;
    case "saveSettings":
      reply({ type: "saved", what: "settings" });
      break;
    case "saveChatSettings":
      reply({ type: "saved", what: "chat" });
      break;
    case "saveSystemPrompt":
      reply({ type: "saved", what: "system" });
      break;
    case "saveAppendSystemPrompt":
      reply({ type: "saved", what: "append" });
      break;
    case "saveCommitConfig":
      reply({ type: "saved", what: "commit" });
      break;
    default:
      // Every other message would write to a config file; the preview declines.
      console.info("[preview host] ignored", message.type);
      break;
  }
}

/** Install the API object `lib/bridge.ts` looks for. Call before importing the page. */
export function installSettingsHost(): void {
  window.acquireVsCodeApi = () => ({
    postMessage: (message: unknown) => handle(message as WebviewToSettings),
    getState: <T>() => undefined as T | undefined,
    setState: (_state: unknown) => {},
  });
}
