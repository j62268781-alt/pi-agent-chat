// Small helpers shared by command registrations.

import { statSync } from "node:fs";
import { dirname } from "node:path";
import * as vscode from "vscode";

/**
 * Resolve a usable working directory from an Explorer-context command argument.
 *  - File            -> its parent directory
 *  - Folder          -> itself
 *  - Missing on disk -> `undefined`
 *  - No uri (palette) -> first workspace folder
 */
export function resolveExplorerCwd(uri: vscode.Uri | undefined): string | undefined {
  if (!uri || uri.scheme !== "file") {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
  const fsPath = uri.fsPath;
  try {
    const stat = statSync(fsPath);
    return stat.isDirectory() ? fsPath : dirname(fsPath);
  } catch {
    return undefined;
  }
}

/**
 * Wrap a lazy `WebviewViewProvider` factory so the implementing module — and
 * its dependency tree, e.g. the pi SDK — is only imported when the user first
 * opens the corresponding view, not at activation time.
 */
export function lazyViewProvider(
  factory: () => Promise<vscode.WebviewViewProvider>,
): vscode.WebviewViewProvider {
  let pending: Promise<vscode.WebviewViewProvider> | undefined;
  const resolve = () => (pending ??= factory());
  return {
    async resolveWebviewView(
      webviewView: vscode.WebviewView,
      context: vscode.WebviewViewResolveContext,
      token: vscode.CancellationToken,
    ) {
      const provider = await resolve();
      return provider.resolveWebviewView(webviewView, context, token);
    },
  };
}
