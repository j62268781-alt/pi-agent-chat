import codiconTtf from "@vscode/codicons/dist/codicon.ttf?inline";

/**
 * `@vscode/codicons` is shipped as a subset: only the glyphs referenced by the
 * components and stylesheets are declared, so the @font-face rule is registered
 * here instead of pulling in the package's full stylesheet.
 *
 * Both entries call this — the webview's and the design preview's. The preview
 * renders the real components, so a font it did not load was invisible there
 * and every icon (send button, toolbar, this round's compaction divider) read
 * as blank while the shipped UI showed it.
 */
export function installCodiconFont(): void {
  const style = document.createElement("style");
  style.textContent = `@font-face{font-family:"codicon";font-display:block;src:url(${codiconTtf}) format("truetype")}`;
  document.head.prepend(style);
}
