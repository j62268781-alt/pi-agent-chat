// Editor/Explorer context-menu commands that append the current selection
// (as a fenced code block) or a file/folder (as an `@` mention) to the
// composer input of an already-open webview chat panel or sidebar chat.

import { relative } from "node:path";
import { homedir } from "node:os";
import * as vscode from "vscode";
import { t } from "../utils/i18n.ts";

interface ChatTarget {
  post(msg: unknown): void;
  reveal(): void;
}

async function resolveTarget(): Promise<ChatTarget | undefined> {
  const { getSidebarChatTarget, focusSidebarChat } =
    await import("../providers/chat/chat-sidebar.ts");
  const sidebar = getSidebarChatTarget();
  if (sidebar) {
    return {
      post: (msg) => sidebar.session.host.postMessage(msg),
      reveal: () => focusSidebarChat(),
    };
  }
  const { getActivePanelHandle } = await import("../providers/chat/chat-panel.ts");
  const handle = getActivePanelHandle();
  if (handle) {
    return {
      post: (msg) => void handle.panel.webview.postMessage(msg),
      reveal: () => handle.panel.reveal(handle.panel.viewColumn ?? vscode.ViewColumn.Active),
    };
  }
  return undefined;
}

function displayPath(uri: vscode.Uri): string {
  // asRelativePath handles multi-root workspaces and remote schemes (SSH/WSL)
  // without dropping to a local-only fsPath; false => omit the workspace
  // folder prefix so the path stays relative to the containing folder.
  let p = vscode.workspace.asRelativePath(uri, false);
  if (uri.scheme === "file") {
    const home = homedir();
    const sep = process.platform === "win32" ? "\\" : "/";
    if (p === uri.fsPath && (p === home || p.startsWith(home + sep)) && p.length > home.length) {
      p = "~/" + relative(home, p).split("\\").join("/");
    }
  }
  return p.split("\\").join("/");
}

function toastNoChat(): void {
  void vscode.window.showInformationMessage(t("Pi: Open a Pi Chat first to use this command."));
}

function appendToChat(target: ChatTarget, text: string): void {
  target.post({ type: "appendInput", text });
  target.reveal();
}

export async function addSelectionToChat(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage(t("Pi: No active editor to add."));
    return;
  }
  if (editor.selection.isEmpty) {
    void vscode.window.showInformationMessage(t("Pi: Make a selection in the editor first."));
    return;
  }
  const target = await resolveTarget();
  if (!target) {
    toastNoChat();
    return;
  }
  const chip = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    path: displayPath(editor.document.uri),
    startLine: editor.selection.start.line + 1,
    endLine: editor.selection.end.line + 1,
  };
  target.post({ type: "addContextChips", chips: [chip] });
  target.reveal();
}

export async function addFileToChat(uri?: vscode.Uri): Promise<void> {
  let targetUri: vscode.Uri | undefined = uri?.scheme === "file" ? uri : undefined;
  if (!targetUri) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage(t("Pi: No active editor to add."));
      return;
    }
    targetUri = editor.document.uri;
  }
  const target = await resolveTarget();
  if (!target) {
    toastNoChat();
    return;
  }
  appendToChat(target, `@${displayPath(targetUri)} `);
}
