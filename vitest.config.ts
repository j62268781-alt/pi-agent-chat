import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests live in `test/unit/`, mirroring `src/`. `test/e2e/` is the
    // end-to-end harness with its own runner, so it is never collected here,
    // and the webview package keeps its own tests (jsdom + the vue plugin) —
    // which is why an explicit include is better than the bare default glob.
    include: ["test/unit/**/*.test.ts"],
  },
});
