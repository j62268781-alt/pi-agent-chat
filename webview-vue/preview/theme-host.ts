// Applying one of VS Code's real themes to a preview document.
//
// The host hands a webview two things: the current theme's colours and its size
// tokens (`getWebviewThemeData()` merges the colour registry with the size-token
// registry). `themes.generated.ts` carries both, materialized from the local VS
// Code install, and this module puts them on the document the way the host does
// — so a preview measurement is a host measurement.

import { DESIGN_TOKENS, THEMES, type PreviewTheme } from "./themes.generated";

/** The host injects these alongside the theme colours; the preview supplies
 *  stand-ins so the typography is not measuring a browser default instead. The
 *  size tokens come from the real payload, same as a webview's. */
const HOST_FONT_VARS: Record<string, string> = {
  "--vscode-font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  "--vscode-font-size": "13px",
  "--vscode-editor-font-family": "Menlo, Monaco, 'Courier New', monospace",
  "--vscode-editor-font-size": "13px",
  ...DESIGN_TOKENS,
};

/** The theme named by `?theme=`, or the default. */
export function themeFromUrl(): PreviewTheme {
  const wanted = new URLSearchParams(location.search).get("theme");
  const fallback = THEMES[0];
  if (!fallback) throw new Error("preview/themes.generated.ts is empty — run gen-theme-vars.mjs");
  return THEMES.find((entry) => entry.id === wanted) ?? fallback;
}

export function applyPreviewTheme(next: PreviewTheme): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries({ ...next.vars, ...HOST_FONT_VARS })) {
    root.style.setProperty(name, value);
  }
  document.body.classList.remove(
    "vscode-light",
    "vscode-dark",
    "vscode-high-contrast",
    "vscode-high-contrast-light",
  );
  // `vscode-light` / `vscode-dark` is also what tells the token layer, the icon
  // rules and mermaid's theme resolution which kind of theme is in play.
  document.body.classList.add(...next.classes);
}
