import { strict as assert } from "node:assert";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { E2E_MODEL, EXTENSION_ID } from "../../fixture.ts";
import { inboundResponses } from "../../rpc-log.ts";
import {
  env,
  filesUnder,
  repoRoot,
  rpcEntries,
  sessionsDir,
  waitForRpc,
  workspaceDir,
} from "../harness.ts";

interface Manifest {
  name?: string;
  publisher?: string;
  contributes?: { commands?: { command: string }[] };
}

function manifest(): Manifest {
  return JSON.parse(readFileSync(join(repoRoot(), "package.json"), "utf8")) as Manifest;
}

// E2E_MODEL is "<provider>/<model id>", but pi's get_state response reports the
// two halves separately (`data.model.provider`, `data.model.id`). Observed on pi
// 0.85.1 (2026-09-18): provider "solar", id "qoder/qwen3.8-flash", with `name`
// mirroring the id and `api` "openai-completions". Derive both halves from the
// pinned constant instead of writing the model string a second time.
const [E2E_PROVIDER = "", ...E2E_MODEL_PARTS] = E2E_MODEL.split("/");
const E2E_MODEL_ID = E2E_MODEL_PARTS.join("/");

/** `data.model` of a get_state response: what pi reports it loaded, not what we asked for. */
function reportedModel(data: unknown): { id?: unknown; provider?: unknown } {
  return (data as { model?: { id?: unknown; provider?: unknown } } | undefined)?.model ?? {};
}

describe("M1 — harness bootstrap", () => {
  it("propagates extensionTestsEnv into the extension host", () => {
    // Settles M1 open question #1: runTest.js applies extensionTestsEnv through
    // cp.spawn's env, so it must be visible here. realpathSync on both sides
    // because macOS resolves /var/folders/... to /private/var/folders/...
    const expected = realpathSync(workspaceDir());
    const folders = vscode.workspace.workspaceFolders ?? [];
    assert.equal(folders.length, 1, "the fixture workspace should be the only folder");
    assert.equal(realpathSync(folders[0]?.uri.fsPath ?? ""), expected);
    assert.ok(sessionsDir().length > 0);
  });

  it("activates the extension under its manifest id", async () => {
    const { name, publisher } = manifest();
    assert.equal(`${publisher}.${name}`, EXTENSION_ID, "EXTENSION_ID drifted from package.json");

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not present in this VS Code instance`);
    if (!extension.isActive) await extension.activate();
    assert.equal(extension.isActive, true);
  });

  it("registers every command declared in contributes.commands", async () => {
    // Read from package.json rather than a hardcoded list, so adding or removing
    // a command cannot silently leave this assertion stale.
    const declared = (manifest().contributes?.commands ?? []).map((entry) => entry.command);
    assert.ok(
      declared.length >= 11,
      `expected the 11 contributed commands, saw ${declared.length}`,
    );

    const registered = new Set(await vscode.commands.getCommands(true));
    assert.deepEqual(
      declared.filter((command) => !registered.has(command)),
      [],
    );
  });

  it("spawns the real pi subprocess with the fixture args, and pi reports the pinned model", async () => {
    // Previously this matched the pi process through `ps`, which only works for
    // the few hundred milliseconds before pi rewrites its process title and
    // wipes argv (FINDINGS §11.4). What pi reports about itself is the stronger
    // proof: a successful get_state response carries the model pi actually
    // loaded, so this fails if `pi-agent-chat.args` stops carrying
    // `--model solar/qoder/qwen3.8-flash` (fixture.ts) or if a different model
    // gets spawned. A hand-started pi cannot satisfy it either, and the
    // provider/id halves it reports are derived from E2E_MODEL above, not
    // re-typed here.
    //
    // openSidebarChat bails silently in three places (chat-sidebar.ts:257-267)
    // and waitForView() has a hardcoded 5s timeout (chat-sidebar.ts:65-81), so
    // re-issue the command if nothing arrives; it is idempotent once
    // sidebarState.session exists.
    const deadline = Date.now() + 120_000;
    for (let attempt = 1; ; attempt += 1) {
      await vscode.commands.executeCommand("pi-agent-chat.openInSidebar");
      const reported = await waitForRpc(
        (entries) =>
          inboundResponses(entries).some((r) => {
            if (r.command !== "get_state" || !r.success) return false;
            const model = reportedModel(r.data);
            return model.provider === E2E_PROVIDER && model.id === E2E_MODEL_ID;
          }),
        {
          timeoutMs: 30_000,
          what: `a successful get_state response reporting ${E2E_MODEL} (attempt ${attempt})`,
        },
      )
        .then(() => true)
        .catch(() => false);
      if (reported) return;
      // pi answering with some other model is definitive: this retry loop exists
      // for openSidebarChat's silent bails (no RPC arrives at all), and calling
      // it again reuses the already-spawned pi, so the model cannot change.
      // Failing right here also keeps this assert under mocha's 120s per-test
      // cap, which the deadline below would otherwise race.
      const getStates = inboundResponses(rpcEntries()).filter((r) => r.command === "get_state");
      if (getStates.length > 0 || Date.now() > deadline) {
        // waitForRpc's timeout tail truncates each line at 80 chars, which hides
        // the model id, so name the distinct models pi actually reported.
        const models = [
          ...new Set(
            getStates.slice(-3).map((r) => {
              const model = reportedModel(r.data);
              return `${String(model.provider)}/${String(model.id)}`;
            }),
          ),
        ];
        assert.fail(
          `pi never reported ${E2E_MODEL} in a successful get_state response` +
            (models.length > 0
              ? `; it reported ${models.join(", ")} instead`
              : ` after ${attempt} openInSidebar attempt(s)`) +
            ". Likely causes: ensurePiBinary returned undefined because pi-agent-chat.path " +
            "is not executable (src/services/rpc/process.ts:55-71 fails silently), the " +
            "sidebar view never resolved, or pi-agent-chat.args no longer carries the " +
            "pinned --model. The runner keeps the fixture on failure — read " +
            "<fixture>/user-data/logs/**/output_logging_*/1-Pi Chat RPC.log.",
        );
      }
      console.log(`[m1] attempt ${attempt} produced no get_state for the pinned model, retrying`);
    }
  });

  it("points pi's session storage at the fixture directory", () => {
    // pi reports a sessionFile under our redirected directory in its
    // get_session_stats response, but writes nothing until a prompt exists
    // (FINDINGS §6, §11.3). M2 sends real prompts and asserts the file appears.
    const dir = sessionsDir();
    assert.ok(dir.startsWith("/"), `expected an absolute session dir, got ${dir}`);
    assert.equal(dir, env("PI_E2E_SESSIONS"));
    assert.ok(existsSync(dir), `${dir} should have been created by the fixture`);
    console.log(`[m1 finding] files under PI_CODING_AGENT_SESSION_DIR: ${filesUnder(dir).length}`);
  });

  it("pins an absolute, non-empty pi binary path", () => {
    // ensurePiBinary (src/services/rpc/process.ts:55-71) silently returns
    // undefined when the binary is not executable, and openChatPanel then bails
    // without throwing. Assert the pin is sane so a silent no-op cannot be
    // mistaken for a passing run.
    const piBin = env("PI_E2E_PI_BIN");
    assert.ok(piBin.startsWith("/"), `expected an absolute pi path, got ${piBin}`);
  });
});
