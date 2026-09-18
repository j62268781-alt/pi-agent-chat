// Bundled to `test/e2e/.build/suite/index.cjs` and passed to
// @vscode/test-electron as `extensionTestsPath`. VS Code's extension host
// requires this module and awaits its `run()` export.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import Mocha from "mocha";

/** A trivial real-pi turn measured 20.4s; leave room for tool calls. */
const SUITE_TIMEOUT_MS = 120_000;

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: SUITE_TIMEOUT_MS });

  const casesDir = join(__dirname, "cases");
  const names = readdirSync(casesDir)
    .filter((name) => name.endsWith(".cjs"))
    .sort();
  for (const name of names) mocha.addFile(join(casesDir, name));

  // No explicit loadFiles(): it is protected in mocha 12's typings, and run()
  // calls it implicitly whenever files were added and lazyLoad is off (the
  // default) — see `Mocha.prototype.run` in mocha/lib/mocha.cjs.
  const failures = await new Promise<number>((resolve) => {
    mocha.run((count) => resolve(count));
  });
  if (failures > 0) throw new Error(`${failures} e2e case(s) failed`);
}
