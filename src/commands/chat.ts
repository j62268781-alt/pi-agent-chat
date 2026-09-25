// Commands that open the Pi chat UI.
//
// Every implementation module is pulled in with `await import()` rather than a
// static import: `chat-panel.ts` / `chat-sidebar.ts` transitively import the pi
// SDK, and activating those at startup would balloon the main chunk.

import * as vscode from "vscode";
import type { BridgeConfig } from "../services/bridge/types.ts";
import type { ChatTracker } from "../providers/chat/chat-tracker.ts";
import { t } from "../utils/i18n.ts";
import { resolveUiMode } from "../utils/ui-mode.ts";
import { resolveExplorerCwd } from "../utils/vscode-helpers.ts";

export interface ChatCommandDeps {
  extensionUri: vscode.Uri;
  chatTracker: ChatTracker;
  bridgeConfig(): BridgeConfig | undefined;
}

async function openPanel(deps: ChatCommandDeps, cwd?: string): Promise<void> {
  const { openChatPanel } = await import("../providers/chat/chat-panel.ts");
  await openChatPanel({
    extensionUri: deps.extensionUri,
    bridgeConfig: deps.bridgeConfig(),
    tracker: deps.chatTracker,
    cwd,
  });
}

async function openSidebar(deps: ChatCommandDeps): Promise<void> {
  const { openSidebarChat } = await import("../providers/chat/chat-sidebar.ts");
  await openSidebarChat({
    extensionUri: deps.extensionUri,
    bridgeConfig: deps.bridgeConfig(),
    // The panel's own bookkeeping — without it the sidebar chat loses what the
    // user picked (the model/name memory) the moment it is opened from a command.
    chatTracker: deps.chatTracker,
  });
}

export function registerChatCommands(deps: ChatCommandDeps): vscode.Disposable[] {
  return [
    // Primary entry point: honours the `ui` setting.
    vscode.commands.registerCommand("pi-agent-chat.open", async () => {
      if (resolveUiMode() === "webview") return openPanel(deps);
      return openSidebar(deps);
    }),

    vscode.commands.registerCommand("pi-agent-chat.openInNewWindow", async () => {
      if (resolveUiMode() === "sidebar") return;
      await openPanel(deps);
      try {
        await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
      } catch {
        // Command is unavailable on some window layouts; the panel is already open.
      }
    }),

    vscode.commands.registerCommand("pi-agent-chat.openInFolder", async (uri?: vscode.Uri) => {
      const cwd = resolveExplorerCwd(uri);
      if (!cwd) {
        void vscode.window.showErrorMessage(
          t("Pi: Unable to resolve a folder from the selected item."),
        );
        return;
      }
      await openPanel(deps, cwd);
    }),

    vscode.commands.registerCommand("pi-agent-chat.openInSidebar", () => openSidebar(deps)),
  ];
}
