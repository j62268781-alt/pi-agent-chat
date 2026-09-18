// Everything the e2e harness needs to know about paths and pinned settings.
//
// Shared by three consumers that never run in the same process: the outer
// runner (`runner.ts`), the in-host mocha suite (`suite/cases/*`), and the
// vitest unit tests (`fixture.test.ts`). Each gets its own inlined copy via
// rolldown, so this module must stay free of module-level mutable state.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Pinned for every e2e run. Verified against the solar provider:
 * `qoder/qwen3.8-max` returns 404 model_not_found for this account group, while
 * `qoder/qwen3.8-flash`, `qoder/glm-5.3-flash` and `deepseek-v4.1-flash` all
 * answer. A trivial turn on the flash model measured 20.4s.
 */
export const E2E_MODEL = "solar/qoder/qwen3.8-flash";

/** `${publisher}.${name}` from package.json; the M1 suite asserts this matches. */
export const EXTENSION_ID = "johnny-zhao.pi-agent-chat";

/**
 * Machine install verified at 1.138.0 / stable / arm64. Note the macOS binary is
 * named `Code`, not `Electron` — getting this wrong silently falls through to a
 * ~900MB download into `.vscode-test/`.
 */
const DARWIN_VSCODE = "/Applications/Visual Studio Code.app/Contents/MacOS/Code";

export interface Fixture {
  /** Single removable root; every other path is nested under it. */
  root: string;
  workspace: string;
  userDataDir: string;
  extensionsDir: string;
  sessionsDir: string;
  piBin: string;
}

/**
 * Resolved explicitly rather than via `which pi`, because `npm run` prepends
 * `node_modules/.bin` to PATH while a bare `node test/e2e/.build/runner.cjs`
 * does not — the same code would otherwise pick a different binary depending on
 * how it was launched. The order mirrors the extension's own probe
 * (src/services/pi/binary.ts:60), which prefers the workspace-local pi.
 */
export function resolvePiBinary(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot: string = process.cwd(),
): string {
  if (env.PI_E2E_PI) return env.PI_E2E_PI;
  const workspacePi = join(repoRoot, "node_modules/.bin/pi");
  if (existsSync(workspacePi)) return workspacePi;
  try {
    const resolved = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
    if (resolved) return resolved;
  } catch {
    // `which` exits non-zero when pi is not on PATH; fall through to the last
    // candidate in binary.ts's probe order.
  }
  const fallback = join(env.HOME ?? "", ".local/bin/pi");
  if (existsSync(fallback)) return fallback;
  throw new Error("cannot locate the pi binary; set PI_E2E_PI to an absolute path");
}

/**
 * Deliberately does not use @vscode/test-electron's `reuseMachineInstall`: the
 * `code` CLI is not on PATH on this machine, so its resolution heuristics are
 * unreliable. Returning undefined makes test-electron download its own copy into
 * `defaultCachePath` (.vscode-test/) instead.
 */
export function resolveVsCodeExecutablePath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.PI_E2E_VSCODE) return env.PI_E2E_VSCODE;
  if (process.platform === "darwin" && existsSync(DARWIN_VSCODE)) return DARWIN_VSCODE;
  return undefined;
}

/**
 * Settings for the fixture workspace. `path` and `args` must be present before
 * activation: pi binary resolution is cached and only invalidated on a
 * `pi-agent-chat.path` config-change event (src/extension.ts:83).
 *
 * `PI_CODING_AGENT_SESSION_DIR` rides in through `pi-agent-chat.env`, which
 * `createRpcEnvironment` (src/services/rpc/process.ts:158-166) merges into the
 * subprocess env. It is not one of the extension-injected PI_VSCODE_* vars, so
 * it cannot be overwritten.
 */
export function fixtureSettings(opts: {
  piBin: string;
  sessionsDir: string;
  offline: boolean;
}): Record<string, unknown> {
  return {
    "pi-agent-chat.path": opts.piBin,
    "pi-agent-chat.ui": "sidebar",
    "pi-agent-chat.args": ["--model", E2E_MODEL],
    "pi-agent-chat.env": {
      PI_CODING_AGENT_SESSION_DIR: opts.sessionsDir,
      ...(opts.offline ? { PI_OFFLINE: "1" } : {}),
    },
    "pi-agent-chat.rpcTrace": true,
    // Keep the fixture window quiet and deterministic.
    "telemetry.telemetryLevel": "off",
    "workbench.startupEditor": "none",
    "workbench.enableExperiments": false,
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
  };
}

export function createFixture(opts: { offline?: boolean } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "pi-e2e-"));
  const fixture: Fixture = {
    root,
    workspace: join(root, "workspace"),
    userDataDir: join(root, "user-data"),
    extensionsDir: join(root, "extensions"),
    sessionsDir: join(root, "pi-sessions"),
    piBin: resolvePiBinary(),
  };

  for (const dir of [
    fixture.workspace,
    fixture.userDataDir,
    fixture.extensionsDir,
    fixture.sessionsDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  mkdirSync(join(fixture.workspace, ".vscode"), { recursive: true });
  writeFileSync(
    join(fixture.workspace, ".vscode", "settings.json"),
    `${JSON.stringify(
      fixtureSettings({
        piBin: fixture.piBin,
        sessionsDir: fixture.sessionsDir,
        offline: opts.offline ?? true,
      }),
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(fixture.workspace, "sample.md"), "# pi-agent-chat e2e fixture\n");

  return fixture;
}

export function disposeFixture(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

export interface RunningProcess {
  pid: number;
  command: string;
}

/**
 * Every running process with its pid. `-ww` matters: without it macOS truncates
 * to the terminal width and `--model` sits at the very end of pi's argument
 * list. Longest line measured on this machine: 3151 chars.
 */
export function runningProcesses(): RunningProcess[] {
  return execFileSync("ps", ["-Awwo", "pid=,command="], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .map((line) => {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (!match) return undefined;
      const [, pid = "", command = ""] = match;
      return { pid: Number(pid), command };
    })
    .filter((entry): entry is RunningProcess => entry !== undefined);
}

/**
 * pi rewrites its own process title after startup, which wipes argv and leaves
 * `ps` showing a space-padded bare `pi` (FINDINGS §11.4). So a process counts as
 * pi either while it still carries the launcher argv — a window of a few hundred
 * milliseconds — or once it has collapsed to that bare title.
 */
export function isPiProcess(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed === "pi") return true;
  return trimmed.includes("--mode rpc") && trimmed.includes(`--model ${E2E_MODEL}`);
}

export function piProcessPids(processes: RunningProcess[] = runningProcesses()): number[] {
  return processes.filter((p) => isPiProcess(p.command)).map((p) => p.pid);
}
