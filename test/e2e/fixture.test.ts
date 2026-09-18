import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFixture,
  disposeFixture,
  E2E_MODEL,
  fixtureSettings,
  isPiProcess,
  piProcessPids,
  resolvePiBinary,
  resolveVsCodeExecutablePath,
} from "./fixture.ts";

const created: string[] = [];

function newFixture(offline = true): ReturnType<typeof createFixture> {
  const fixture = createFixture({ offline });
  created.push(fixture.root);
  return fixture;
}

afterEach(() => {
  while (created.length > 0) {
    const root = created.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("fixtureSettings", () => {
  it("pins the pi binary and model before activation", () => {
    const settings = fixtureSettings({
      piBin: "/tmp/pi",
      sessionsDir: "/tmp/sessions",
      offline: true,
    });

    // The pi binary path is cached and only invalidated on a config-change
    // event (src/extension.ts:83), so it has to be written into the fixture
    // settings rather than changed mid-run.
    expect(settings["pi-agent-chat.path"]).toBe("/tmp/pi");
    expect(settings["pi-agent-chat.args"]).toEqual(["--model", E2E_MODEL]);
    expect(settings["pi-agent-chat.env"]).toEqual({
      PI_CODING_AGENT_SESSION_DIR: "/tmp/sessions",
      PI_OFFLINE: "1",
    });
    expect(settings["pi-agent-chat.ui"]).toBe("sidebar");
  });

  it("omits PI_OFFLINE when offline is false", () => {
    const settings = fixtureSettings({
      piBin: "/tmp/pi",
      sessionsDir: "/tmp/sessions",
      offline: false,
    });
    expect(settings["pi-agent-chat.env"]).toEqual({
      PI_CODING_AGENT_SESSION_DIR: "/tmp/sessions",
    });
  });
});

describe("resolveVsCodeExecutablePath", () => {
  it("prefers PI_E2E_VSCODE over everything", () => {
    expect(resolveVsCodeExecutablePath({ PI_E2E_VSCODE: "/custom/Electron" })).toBe(
      "/custom/Electron",
    );
  });

  // The fixed macOS path only exists on darwin; probe rather than assume.
  it.skipIf(process.platform !== "darwin")("resolves an existing VS Code binary", () => {
    const resolved = resolveVsCodeExecutablePath({});
    if (!existsSync("/Applications/Visual Studio Code.app")) {
      expect(resolved).toBeUndefined();
      return;
    }
    // Guards the failure mode that silently costs a ~900MB download: the macOS
    // binary is named `Code`, not `Electron`, and a wrong name makes the
    // existsSync probe fail so test-electron downloads its own copy instead.
    expect(resolved).toBe("/Applications/Visual Studio Code.app/Contents/MacOS/Code");
    expect(existsSync(resolved ?? "")).toBe(true);
  });

  it("returns undefined off darwin so test-electron downloads instead", () => {
    if (process.platform === "darwin") return;
    expect(resolveVsCodeExecutablePath({})).toBeUndefined();
  });
});

describe("resolvePiBinary", () => {
  it("honours PI_E2E_PI", () => {
    expect(resolvePiBinary({ PI_E2E_PI: "/custom/pi" })).toBe("/custom/pi");
  });

  it("prefers the workspace pi over PATH, matching binary.ts:60", () => {
    const root = process.cwd();
    const workspacePi = join(root, "node_modules/.bin/pi");
    // `npm run` prepends node_modules/.bin to PATH but a bare
    // `node test/e2e/.build/runner.cjs` does not; resolving explicitly keeps the
    // choice stable either way.
    if (!existsSync(workspacePi)) return;
    expect(resolvePiBinary({}, root)).toBe(workspacePi);
  });
});

describe("isPiProcess", () => {
  it("matches the transient launcher argv that carries the fixture args", () => {
    expect(
      isPiProcess(
        "node /repo/node_modules/.bin/pi -e /repo/pi-extensions/pi-vscode-bridge.js --mode rpc --model solar/qoder/qwen3.8-flash",
      ),
    ).toBe(true);
  });

  it("matches the bare title pi rewrites itself to (FINDINGS §11.4)", () => {
    // pi calls setproctitle, which overwrites the argv area and pads with
    // spaces. After that `ps` shows only `pi`, so the long-form match alone
    // would miss every steady-state process.
    expect(isPiProcess("pi")).toBe(true);
    expect(isPiProcess("pi             ")).toBe(true);
  });

  it("does not match unrelated commands that merely mention pi", () => {
    expect(isPiProcess("grep --color=auto pi")).toBe(false);
    expect(isPiProcess("/usr/bin/pipenv install")).toBe(false);
    expect(isPiProcess("node /repo/node_modules/.bin/pi-doctor")).toBe(false);
    expect(isPiProcess("")).toBe(false);
  });
});

describe("piProcessPids", () => {
  it("returns the pids of matching processes", () => {
    expect(
      piProcessPids([
        // `--mode rpc` on its own is not enough: the model check is what keeps
        // a pi the user started by hand out of this run's orphan set.
        { pid: 10, command: "/usr/bin/node --mode rpc" },
        { pid: 11, command: "pi   " },
        { pid: 12, command: "/sbin/launchd" },
      ]),
    ).toEqual([11]);
  });
});

describe("createFixture", () => {
  it("creates every directory and writes the workspace settings", () => {
    const fixture = newFixture();

    for (const dir of [
      fixture.workspace,
      fixture.userDataDir,
      fixture.extensionsDir,
      fixture.sessionsDir,
    ]) {
      expect(existsSync(dir)).toBe(true);
    }

    const settingsPath = join(fixture.workspace, ".vscode", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);

    const written = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    expect(written["pi-agent-chat.args"]).toEqual(["--model", E2E_MODEL]);
    expect(written["pi-agent-chat.env"]).toMatchObject({
      PI_CODING_AGENT_SESSION_DIR: fixture.sessionsDir,
    });
  });

  it("resolves a pi binary that exists and is executable", () => {
    const fixture = newFixture();
    expect(fixture.piBin.startsWith("/")).toBe(true);
    expect(existsSync(fixture.piBin)).toBe(true);
  });

  it("nests every path under a single removable root", () => {
    const fixture = newFixture();
    for (const dir of [
      fixture.workspace,
      fixture.userDataDir,
      fixture.extensionsDir,
      fixture.sessionsDir,
    ]) {
      expect(dir.startsWith(fixture.root)).toBe(true);
    }
    disposeFixture(fixture.root);
    expect(existsSync(fixture.root)).toBe(false);
  });
});
