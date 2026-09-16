// Path abbreviation helpers.
//
// The host injects the home directory, path separator and workspace root into
// the HTML, so both shortening helpers degrade to a no-op when a value is
// missing (which happens when the bundle is opened in a plain browser).

import { homeDir, pathSep, workspaceDir } from "./injected";

/** `C:\Users\me\src\a.ts` -> `~/src/a.ts` when it lives under the home directory. */
export function shortenToolPath(path: string): string {
  if (typeof path !== "string" || !path) return "";
  const home = homeDir();
  const sep = pathSep();
  if (home && (path === home || path.startsWith(home + sep))) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

/** Make a path relative to the workspace root, falling back to `~` shortening. */
export function shortenWorkspacePath(path: string): string {
  if (typeof path !== "string" || !path) return "";
  const workspace = workspaceDir();
  const sep = pathSep();
  if (workspace && (path === workspace || path.startsWith(workspace + sep))) {
    if (path === workspace) return ".";
    return path.slice(workspace.length + sep.length) || ".";
  }
  return shortenToolPath(path);
}

/** Trailing path segment, tolerant of both separators. */
export function basenameOf(path: string): string {
  if (!path) return "";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}
