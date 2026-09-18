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
import { TERMINAL_TITLE } from "./utils/constants.ts";
import { t } from "./utils/i18n.ts";
import { resolveUiMode } from "./utils/ui-mode.ts";
import { lazyViewProvider } from "./utils/vscode-helpers.ts";

const CHAT_SIDEBAR_VIEW_ID = "pi-agent-chat.chatSidebar";
const PI_BINARY_SETTING = "pi-agent-chat.path";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const extensionUri = context.extensionUri;
  const chatTracker = createChatTracker(context);

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
