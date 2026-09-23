import * as vscode from "vscode";
import { t } from "../../utils/i18n.ts";
import type { WebviewToExt } from "../../protocol/messages.ts";
import type { ChatHost } from "./chat-session.ts";

/**
 * A chat asked for in a window with no workspace folder.
 *
 * pi files its sessions per project, so there is nothing to run against — and
 * spawning it anyway would file the conversation under whatever cwd the
 * extension host happens to have, which is not a project the user chose. So no
 * session is created yet: this object answers the webview in its place, the boot
 * page says what is missing and offers the folder picker, and the session starts
 * the moment a folder exists.
 */
export interface WorkspaceGate {
  dispose(): void;
}

export function createWorkspaceGate(opts: {
  host: ChatHost;
  /** A folder appeared — open the chat on it. */
  onFolder: (folder: string) => void;
  /**
   * Runs before VS Code's picker. Picking a folder reloads the window onto
   * another workspace, so the chat has to record that it wants to come back —
   * the reload destroys everything this object holds.
   */
  onOpenFolderRequested: () => void;
}): WorkspaceGate {
  let disposed = false;

  const post = (msg: unknown): void => {
    if (!disposed) opts.host.postMessage(msg);
  };

  const messages = opts.host.onDidReceiveMessage((raw) => {
    const msg = raw as WebviewToExt | undefined;
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "webviewReady":
        post({ type: "workspaceRequired", required: true });
        break;
      case "openFolder":
        opts.onOpenFolderRequested();
        void vscode.commands.executeCommand("workbench.action.files.openFolder");
        break;
      case "prompt":
        // The boot page covers the composer, so this only fires for a message
        // already in flight. Say why instead of dropping it silently.
        post({ type: "error", message: t("Open a workspace folder to start pi.") });
        break;
    }
  });

  // "Add Folder to Workspace" adds one to the open window instead of reloading
  // it, so the gate has to watch for the folder it is waiting on.
  const folders = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (folder) opts.onFolder(folder);
  });

  return {
    dispose: () => {
      disposed = true;
      messages.dispose();
      folders.dispose();
    },
  };
}
