// Single registration point for every command contributed by this extension.

import * as vscode from "vscode";
import type { BridgeConfig } from "../services/bridge/types.ts";
import type { ChatTracker } from "../providers/chat/chat-tracker.ts";
import { addFileToChat, addSelectionToChat } from "./add-to-chat.ts";
import { registerChatCommands } from "./chat.ts";
import { registerGitCommitCommands } from "./git-commit.ts";
import { registerSettingsCommands } from "./settings.ts";

export interface CommandDeps {
  extensionUri: vscode.Uri;
  chatTracker: ChatTracker;
  /** Resolved lazily: the bridge can restart underneath an open panel. */
  bridgeConfig(): BridgeConfig | undefined;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [
    ...registerChatCommands(deps),
    ...registerSettingsCommands(deps.extensionUri),
    ...registerGitCommitCommands(),
    vscode.commands.registerCommand("pi-agent-chat.addSelectionToChat", () => addSelectionToChat()),
    vscode.commands.registerCommand("pi-agent-chat.addFileToChat", (uri?: vscode.Uri) =>
      addFileToChat(uri),
    ),
  ];
  context.subscriptions.push(...disposables);
  return disposables;
}
