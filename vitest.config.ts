import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Host modules import `vscode` as a value; outside an extension host there is
    // no such module, only its types. The stub is deliberately minimal.
    alias: { vscode: fileURLToPath(new URL("test/unit/stubs/vscode.ts", import.meta.url)) },
  },
  test: {
    // Unit tests live in `test/unit/`, mirroring `src/`. `test/e2e/` is the
    // end-to-end harness with its own runner, so it is never collected here,
    // and the webview package keeps its own tests (jsdom + the vue plugin) —
    // which is why an explicit include is better than the bare default glob.
    include: ["test/unit/**/*.test.ts"],
  },
});
