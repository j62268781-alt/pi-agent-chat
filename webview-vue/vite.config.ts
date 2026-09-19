import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * The chat and settings webviews are two builds of one Vite project.
 *
 * `--mode chat` and `--mode settings` set `__PI_PAGE__`, which `App.vue` uses to
 * pick a page; everything belonging to the other page is tree-shaken away. Each
 * build emits a single self-contained HTML file (`vite-plugin-singlefile`
 * inlines all JS/CSS/fonts), which the extension host embeds with `?raw` and
 * then serves through `webview.html` — so no `localResourceRoots`,
 * `asWebviewUri` or CSP plumbing is needed.
 */
type WebviewPage = "chat" | "settings";

/**
 * The single source of truth for this package's import aliases. `vitest.config.ts`
 * imports it too, so the test run and the build can never drift apart.
 */
export function webviewAliases(page: WebviewPage): Record<string, string> {
  return {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    // Shared postMessage contract, owned by the extension host.
    "@protocol": fileURLToPath(new URL("../src/protocol", import.meta.url)),
    // The page this bundle is built for. Resolving it here (rather than
    // branching on `__PI_PAGE__` at runtime) guarantees that the other
    // page's components and stylesheets never enter this bundle.
    "@page": fileURLToPath(
      new URL(
        `./src/pages/${page === "settings" ? "SettingsPage" : "ChatPage"}.vue`,
        import.meta.url,
      ),
    ),
  };
}

/** Same deal as the aliases: one definition of the compile-time page flag. */
export function webviewDefines(page: WebviewPage): Record<string, string> {
  return { __PI_PAGE__: JSON.stringify(page) };
}

export default defineConfig(({ mode }) => {
  const page: WebviewPage = mode === "settings" ? "settings" : "chat";

  return {
    plugins: [vue(), viteSingleFile()],
    resolve: {
      alias: webviewAliases(page),
    },
    define: webviewDefines(page),
    server: {
      fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
    },
    build: {
      outDir: `dist/${page}`,
      emptyOutDir: true,
      // Inline every asset (codicon.ttf, KaTeX css, SVG sources) so the webview
      // stays a single file with no runtime fetches.
      assetsInlineLimit: 100 * 1024 * 1024,
    },
  };
});
