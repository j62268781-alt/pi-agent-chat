import { readdirSync } from "node:fs";
import { defineConfig } from "rolldown";

/**
 * Case files are discovered rather than listed, so adding a case never means
 * editing this config. The name mapping mirrors what `suite/index.ts` reads back
 * at runtime: `cases/<name>.cjs` under the output dir.
 */
const CASES_DIR = "test/e2e/suite/cases";
const caseEntries = Object.fromEntries(
  readdirSync(CASES_DIR)
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => [`suite/cases/${name.slice(0, -".test.ts".length)}`, `${CASES_DIR}/${name}`]),
);

/**
 * The e2e suite is bundled to CommonJS because VS Code's extension host
 * `require()`s whatever `extensionTestsPath` points at, and mocha's `addFile`
 * needs each case to be a separate on-disk module.
 *
 * Shared modules (fixture.ts, harness.ts) are extracted into `chunks/` by
 * `chunkFileNames`, the same way the extension build does it — so the runner
 * and the cases all see one copy at runtime.
 *
 * Deliberately not minified: when a case fails, the stack trace is the main
 * diagnostic we get.
 */
export default defineConfig({
  input: {
    runner: "test/e2e/runner.ts",
    "suite/index": "test/e2e/suite/index.ts",
    ...caseEntries,
  },
  // `vscode` is injected by the extension host at runtime; `mocha` and
  // `@vscode/test-electron` resolve from the repo's node_modules at runtime.
  external: ["vscode", "mocha", "@vscode/test-electron"],
  platform: "node",
  output: {
    dir: "test/e2e/.build",
    cleanDir: true,
    entryFileNames: "[name].cjs",
    chunkFileNames: "chunks/[name]-[hash].cjs",
    format: "cjs",
    sourcemap: true,
    minify: false,
  },
});
