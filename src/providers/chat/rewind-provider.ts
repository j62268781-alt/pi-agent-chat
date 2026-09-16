// Serves the read-only side of the `pi-rewind:` scheme so the built-in diff
// editor can show a file's snapshot from `~/.pi/snapshots/<session>/<hash>`
// against the working copy.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";

export const REWIND_SCHEME = "pi-rewind";

/**
 * URI shapes understood by this provider:
 *   pi-rewind:empty/...                              -> empty document
 *   pi-rewind:snapshot/<sessionId>/<hash>            -> snapshot contents
 */
const provider: vscode.TextDocumentContentProvider = {
  provideTextDocumentContent(uri: vscode.Uri): string {
    const parts = String(uri.path || "")
      .replace(/^\/+/, "")
      .split("/");
    if (parts[0] === "empty") return "";
    if (parts[0] === "snapshot" && parts[1] && parts[2]) {
      try {
        return readFileSync(join(homedir(), ".pi", "snapshots", parts[1], parts[2]), "utf8");
      } catch {
        return "";
      }
    }
    return "";
  },
};

export function registerRewindContentProvider(): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider(REWIND_SCHEME, provider);
}
