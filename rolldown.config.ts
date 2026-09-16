import { readFileSync } from "node:fs";
import { defineConfig } from "rolldown";

/**
 * Inlines webview build output as a string constant.
 *
 * The Vue webviews are built by Vite (`webview-vue/`) into self-contained
 * single-file HTML documents. This plugin lets the extension host embed them
 * with `import html from ".../index.html?raw"`, so the shipped `.vsix` contains
 * no separate webview assets and the webview needs no `localResourceRoots` or
 * `asWebviewUri` wiring.
 */
const rawAssetPlugin = {
  name: "raw-asset",
  async resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith("?raw")) return null;
    const resolved = await this.resolve(source.slice(0, -4), importer, { skipSelf: true });
    if (!resolved) return null;
    return { id: resolved.id + "?raw", moduleSideEffects: false };
  },
  load(id: string) {
    if (!id.endsWith("?raw")) return null;
    return `export default ${JSON.stringify(readFileSync(id.slice(0, -4), "utf8"))};`;
  },
};

export default defineConfig({
  input: "src/extension.ts",
  external: ["vscode"],
  platform: "node",
  // pi-ai declares `sideEffects` in its package.json in a way that excludes the
  // OAuth flow modules (dist/bun-oauth.js). Registering them is a real side
  // effect — it arms the `bundledLoaders` fast path that bypasses
  // bundler-opaque dynamic imports — so force moduleSideEffects for that package
  // to keep rolldown from tree-shaking the registration away.
  treeshake: {
    moduleSideEffects: (id) => (id.includes("@earendil-works/pi-ai/") ? true : undefined),
  },
  output: {
    dir: "dist",
    cleanDir: true,
    entryFileNames: "extension.cjs",
    chunkFileNames: "chunks/[name]-[hash].cjs",
    format: "cjs",
    sourcemap: true,
    minify: true,
  },
  plugins: [rawAssetPlugin],
});
