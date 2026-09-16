// Commands that open the Pi settings surface: the webview settings panel and
// the two underlying JSON files.

import * as vscode from "vscode";

async function revealJsonFile(ensureExists: () => string): Promise<void> {
  const path = ensureExists();
  const document = await vscode.workspace.openTextDocument(path);
  await vscode.window.showTextDocument(document);
}

export function registerSettingsCommands(extensionUri: vscode.Uri): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("pi-agent-chat.openSettings", async (tab?: string) => {
      const { openSettingsPanel } = await import("../providers/settings/settings-panel.ts");
      await openSettingsPanel(extensionUri, tab);
    }),

    vscode.commands.registerCommand("pi-agent-chat.openSettingsJson", async () => {
      const { ensureSettingsJsonExists } = await import("../services/settings/settings-config.ts");
      await revealJsonFile(ensureSettingsJsonExists);
    }),

    vscode.commands.registerCommand("pi-agent-chat.openModelsJson", async () => {
      const { ensureModelsJsonExists } = await import("../services/models/models-config.ts");
      await revealJsonFile(ensureModelsJsonExists);
    }),
  ];
}
