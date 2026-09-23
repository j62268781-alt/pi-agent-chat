// Extension entry point: pure wiring.
//
// Everything with real behaviour lives in `commands/` (VSCode command
// handlers), `providers/` (webview hosts) or `services/` (UI-decoupled logic).
// Implementation modules are reached through `await import()` so activation
// stays cheap — the pi SDK is only loaded when a chat surface actually opens.

import * as vscode from "vscode";
import { registerCommands } from "./commands/index.ts";
import { createChatTracker, type ChatTracker } from "./providers/chat/chat-tracker.ts";
import { disposeRpcTrace } from "./providers/chat/rpc-trace.ts";
import { registerRewindContentProvider } from "./providers/chat/rewind-provider.ts";
import {
  BRIDGE_SETTING_KEY,
  cancelPendingRestart,
  currentBridgeConfig,
  describeInvalidBridgeSetting,
  scheduleBridgeRestart,
  startBridge,
  stopBridge,
} from "./services/bridge/runtime.ts";
import { invalidatePiBinaryCache } from "./services/pi/process.ts";
import { configureDevHostRoot } from "./utils/chat-cwd.ts";
import { TERMINAL_TITLE } from "./utils/constants.ts";
import { t } from "./utils/i18n.ts";
import { resolveUiMode } from "./utils/ui-mode.ts";
import { lazyViewProvider } from "./utils/vscode-helpers.ts";

const CHAT_SIDEBAR_VIEW_ID = "pi-agent-chat.chatSidebar";
const PI_BINARY_SETTING = "pi-agent-chat.path";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const extensionUri = context.extensionUri;
  const chatTracker = createChatTracker(context);
  configureDevHostRoot(
    extensionUri.fsPath,
    context.extensionMode === vscode.ExtensionMode.Production,
  );

  await bindBridge(context);
  context.subscriptions.push(
    registerRewindContentProvider(),
    watchConfiguration(context),
    { dispose: () => void stopBridge() },
    vscode.window.registerWebviewViewProvider(
      CHAT_SIDEBAR_VIEW_ID,
      lazyViewProvider(async () => {
        const { createChatSidebarViewProvider } = await import("./providers/chat/chat-sidebar.ts");
        return createChatSidebarViewProvider({
          extensionUri,
          bridgeConfig: currentBridgeConfig(),
          chatTracker,
        });
      }),
    ),
  );

  registerCommands(context, {
    extensionUri,
    chatTracker,
    bridgeConfig: currentBridgeConfig,
  });

  const { shouldRegisterTestingCommands } = await import("./commands/testing-gate.ts");
  if (shouldRegisterTestingCommands(context.extensionMode)) {
    const { registerTestingCommands } = await import("./commands/testing.ts");
    context.subscriptions.push(...registerTestingCommands());
  }

  // In editor-panel mode, reopen whatever chat panels were alive last session.
  if (resolveUiMode() === "webview") restoreTrackedPanels(extensionUri, chatTracker);
  // A folder pick asked for the chat to come back: the window reloaded onto the
  // new workspace and would otherwise land with no chat and no way to the one
  // that asked (its tracked panels belong to the workspace it left).
  if (chatTracker.consumeReopenAfterFolder()) openChatAfterFolder(extensionUri, chatTracker);
}

export async function deactivate(): Promise<void> {
  await disposeChatSurfaces();
  disposeRpcTrace();
  for (const terminal of vscode.window.terminals) {
    if (terminal.name === TERMINAL_TITLE) terminal.dispose();
  }
  cancelPendingRestart();
  await stopBridge();
}

/** Bind the bridge and surface a warning when a fallback endpoint was used. */
async function bindBridge(context: vscode.ExtensionContext): Promise<void> {
  const { fellBackReason } = await startBridge(context, vscode.env.sessionId);
  if (!fellBackReason) return;
  const config = currentBridgeConfig();
  const actual = config?.socketPath ?? config?.url ?? "a random port";
  void vscode.window.showWarningMessage(t("Pi bridge: {0} — using {1}.", fellBackReason, actual));
}

function watchConfiguration(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(PI_BINARY_SETTING)) invalidatePiBinaryCache();
    if (!event.affectsConfiguration(BRIDGE_SETTING_KEY)) return;

    // The settings UI commits on every keystroke, so validate and restart only
    // once the value has settled instead of churning the bridge mid-typing.
    scheduleBridgeRestart(vscode.env.sessionId, async () => {
      const value = vscode.workspace
        .getConfiguration("pi-agent-chat")
        .get<string>("bridgeSocket", "");
      const invalid = describeInvalidBridgeSetting(value, vscode.env.sessionId);
      if (invalid) {
        void vscode.window.showWarningMessage(invalid);
        return;
      }
      await bindBridge(context);
    });
  });
}

function restoreTrackedPanels(extensionUri: vscode.Uri, chatTracker: ChatTracker): void {
  void chatTracker.restore(async (sessionFile, panelId) => {
    const { openChatPanel } = await import("./providers/chat/chat-panel.ts");
    await openChatPanel({
      extensionUri,
      bridgeConfig: currentBridgeConfig(),
      tracker: chatTracker,
      sessionFile,
      panelId,
    });
  });
}

/** Bring the chat back after the reload an `Open Folder…` caused, in whichever
 *  surface this window uses — the sidebar view is part of the layout and comes
 *  back on its own, but focusing it is what tells the user where the chat went. */
function openChatAfterFolder(extensionUri: vscode.Uri, chatTracker: ChatTracker): void {
  void (async () => {
    try {
      if (resolveUiMode() === "sidebar") {
        const { openSidebarChat } = await import("./providers/chat/chat-sidebar.ts");
        await openSidebarChat({
          extensionUri,
          bridgeConfig: currentBridgeConfig(),
          chatTracker,
        });
        return;
      }
      const { getActivePanelHandle, openChatPanel } = await import("./providers/chat/chat-panel.ts");
      // The new workspace may have restored a chat of its own; landing on any
      // chat is the point, so a second panel is not worth opening.
      const open = getActivePanelHandle();
      if (open) {
        open.panel.reveal(open.panel.viewColumn ?? vscode.ViewColumn.Active, false);
        return;
      }
      await openChatPanel({
        extensionUri,
        bridgeConfig: currentBridgeConfig(),
        tracker: chatTracker,
      });
    } catch (e) {
      console.error("[pi-agent-chat] Failed to reopen the chat after opening a folder", e);
    }
  })();
}

/** Dispose chat surfaces that may never have been imported. */
async function disposeChatSurfaces(): Promise<void> {
  try {
    const { disposeAllChatPanels } = await import("./providers/chat/chat-panel.ts");
    disposeAllChatPanels();
  } catch {
    // chat panel module never loaded — nothing to dispose
  }
  try {
    const { disposeSidebarChat } = await import("./providers/chat/chat-sidebar.ts");
    disposeSidebarChat();
  } catch {
    // sidebar chat module never loaded — nothing to dispose
  }
}
