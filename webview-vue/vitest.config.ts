import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { webviewAliases, webviewDefines } from "./vite.config.ts";

/**
 * The webview package owns its own test runner. It needs `vue()` plus this
 * package's alias table — neither of which the host-side root config has, and
 * duplicating them there is what makes aliases drift.
 */
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: webviewAliases("chat") },
  define: webviewDefines("chat"),
  test: {
    // `lib/i18n.ts` reads `window.__PI__` at import time and the render path is
    // DOM-only from there on, so the whole package tests against jsdom.
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
