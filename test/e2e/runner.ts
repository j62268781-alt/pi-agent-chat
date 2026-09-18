// Outer process: build, prepare an isolated fixture, launch VS Code, then verify
// nothing was left behind. All assertions about the extension itself live in
// `suite/cases/`; this file only orchestrates and checks the seams that are
// invisible from inside the host (orphan processes, temp dirs).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runTests } from "@vscode/test-electron";
import {
  createFixture,
  disposeFixture,
  piProcessPids,
  resolveVsCodeExecutablePath,
  type Fixture,
} from "./fixture.ts";

/**
 * `process.cwd()` rather than `__dirname`: this module is bundled into
 * `.build/runner.cjs`, so source-relative paths would resolve against the output
 * directory. pnpm/npm always run scripts with cwd = package root, and the guard
 * below fails loudly if that ever stops being true.
 */
function resolveRepoRoot(): string {
  const root = process.cwd();
  const manifestPath = join(root, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`no package.json under cwd ${root}; run this through npm/pnpm`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string };
  if (manifest.name !== "pi-agent-chat") {
    throw new Error(`cwd ${root} is not the pi-agent-chat repo root (name: ${manifest.name})`);
  }
  return root;
}

function build(repoRoot: string): number {
  // Hard ordering: the extension build inlines webview-vue/dist/**/index.html
  // with ?raw (src/providers/chat/webview-html.ts:4), so the webview must exist
  // first. `pnpm run build` already runs build:webview before build:extension.
  const result = spawnSync("pnpm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });
  return result.status ?? 1;
}

async function main(): Promise<number> {
  const repoRoot = resolveRepoRoot();
  const argv = process.argv.slice(2);
  const offline = !argv.includes("--no-offline");
  const keep = argv.includes("--keep");

  if (!argv.includes("--skip-build")) {
    const status = build(repoRoot);
    if (status !== 0) return status;
  }

  // Differential orphan detection: pi's title rewrite makes argv matching
  // unreliable, so instead of asking "is a pi running" afterwards we ask "did
  // the set of pi pids grow and then fail to shrink". Baseline is captured
  // before VS Code starts so a pi the user is running by hand is not mistaken
  // for an orphan.
  const piPidsBefore = new Set(piProcessPids());
  const fixture: Fixture = createFixture({ offline });
  const vscodeExecutablePath = resolveVsCodeExecutablePath();

  console.log(`[e2e] fixture   ${fixture.root}`);
  console.log(`[e2e] pi        ${fixture.piBin}`);
  console.log(`[e2e] vscode    ${vscodeExecutablePath ?? "(download into .vscode-test/)"}`);
  console.log(`[e2e] offline   ${offline}`);

  let exitCode = 0;
  let failure: string | undefined;
  try {
    exitCode = await runTests({
      // Omitted entirely when undefined so test-electron falls back to its own
      // download; passing `undefined` explicitly would be equivalent but reads
      // worse in the resolved options.
      ...(vscodeExecutablePath === undefined ? {} : { vscodeExecutablePath }),
      extensionDevelopmentPath: repoRoot,
      extensionTestsPath: join(repoRoot, "test/e2e/.build/suite/index.cjs"),
      launchArgs: [
        fixture.workspace,
        "--user-data-dir",
        fixture.userDataDir,
        "--extensions-dir",
        fixture.extensionsDir,
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        "--new-window",
      ],
      extensionTestsEnv: {
        PI_E2E_REPO: repoRoot,
        PI_E2E_WORKSPACE: fixture.workspace,
        PI_E2E_SESSIONS: fixture.sessionsDir,
        PI_E2E_PI_BIN: fixture.piBin,
        // Also injected through pi-agent-chat.env in the fixture settings. Set
        // here too so pi isolation survives a regression in the settings path.
        PI_CODING_AGENT_SESSION_DIR: fixture.sessionsDir,
        PI_E2E_USER_DATA: fixture.userDataDir,
      },
    });
  } catch (error) {
    // @vscode/test-electron v3 throws TestRunFailedError on a non-zero exit.
    failure = error instanceof Error ? error.message : String(error);
  }

  const survivors = piProcessPids().filter((pid) => !piPidsBefore.has(pid));
  if (survivors.length > 0) {
    console.error(
      `[e2e] ${survivors.length} pi process(es) started by this run survived teardown: ` +
        survivors.join(", "),
    );
  }

  if (keep || exitCode !== 0 || failure !== undefined || survivors.length > 0) {
    // The user-data-dir — including the rpcTrace output under user-data/logs/ —
    // is the only way to diagnose a launch that never got as far as reporting,
    // and `--keep` makes it inspectable after a success too.
    console.log(`[e2e] fixture kept for inspection: ${fixture.root}`);
  } else {
    disposeFixture(fixture.root);
  }

  if (failure !== undefined) {
    console.error(`[e2e] run failed: ${failure}`);
    return 1;
  }
  return survivors.length > 0 ? 1 : exitCode;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
