import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import { EXTENSION_MODE_PRODUCTION } from "../../../../src/commands/testing-gate.ts";
import {
  inboundEvents,
  inboundResponses,
  inboundUiRequests,
  type RpcTraceEntry,
} from "../../rpc-log.ts";
import {
  readTranscripts,
  rpcEntries,
  sendWebviewMessage,
  sessionsDir,
  waitForRpc,
} from "../harness.ts";

describe("M2 — hydration and stimulus", () => {
  it("registers the dev-only stimulus command", async () => {
    // The host this case runs in is never Production: the runner passes an
    // `extensionTestsPath`, so per the vscode typings the extension reports
    // ExtensionMode.Test (3) here. Accepting Development/Test is exactly the
    // property the gate relies on, and what this case proves is the gate's
    // non-Production branch (plus that activation wires the command in).
    //
    // The Production branch cannot be reached from inside the host, so it is
    // pinned below instead: the host has the real `vscode` module, making this
    // the only place with both the hand-copied constant and the platform enum.
    // Should `vscode.ExtensionMode.Production` ever move off 1, this fails
    // while the pure unit test in src/commands/testing-gate.test.ts (which can
    // only see the literal against itself) would keep passing.
    assert.equal(
      EXTENSION_MODE_PRODUCTION,
      vscode.ExtensionMode.Production,
      "testing-gate.ts's Production literal has drifted from vscode.ExtensionMode",
    );

    const registered = await vscode.commands.getCommands(true);
    assert.ok(registered.includes("pi-agent-chat.__webviewMessage"));
  });

  it("hydrates models, thinking levels, commands and session stats from real pi", async () => {
    // The sidebar session starts on its own when the view resolves (M1 case 4),
    // so hydration requests are already in flight. pi needs ~4.5s to answer the
    // first one (FINDINGS §11.2), which is why this waits rather than reads once.
    //
    // This log is shared with the M1 cases, which have already resolved the
    // sidebar session, so record what was on disk before waiting: that is what
    // separates a wait satisfied by fresh traffic from one satisfied by history.
    const responses = inboundResponses(rpcEntries()).filter((r) => r.success);
    const already = [...new Set(responses.map((r) => r.command))].sort();
    console.log(
      `[m2 finding] hydration commands already logged: ${already.join(", ") || "(none)"}`,
    );

    const entries = await waitForRpc(
      (all) => {
        const commands = new Set(
          inboundResponses(all)
            .filter((r) => r.success)
            .map((r) => r.command),
        );
        return (
          commands.has("get_available_models") &&
          commands.has("get_available_thinking_levels") &&
          commands.has("get_commands") &&
          commands.has("get_session_stats")
        );
      },
      { timeoutMs: 60_000, what: "the four hydration responses" },
    );

    const byCommand = new Map(
      inboundResponses(entries)
        .filter((r) => r.success)
        .map((r) => [r.command, r.data] as const),
    );

    const models = (byCommand.get("get_available_models") as { models?: unknown[] } | undefined)
      ?.models;
    assert.ok(Array.isArray(models) && models.length > 0, "expected at least one model");

    const levels = (
      byCommand.get("get_available_thinking_levels") as { levels?: unknown[] } | undefined
    )?.levels;
    assert.ok(Array.isArray(levels) && levels.length > 0, "expected at least one thinking level");

    const piCommands = (byCommand.get("get_commands") as { commands?: unknown[] } | undefined)
      ?.commands;
    assert.ok(
      Array.isArray(piCommands) && piCommands.length > 0,
      "expected at least one pi command",
    );

    const stats = byCommand.get("get_session_stats") as Record<string, unknown> | undefined;
    assert.ok(stats, "expected session stats");
    // `sessionFile` is the one field whose shape was verified by measurement
    // (FINDINGS §11.3). Print the real key set so Task 6 can record it and M3 can
    // assert on `contextUsage` with a known shape instead of a guess.
    console.log(`[m2 finding] get_session_stats keys: ${Object.keys(stats).sort().join(", ")}`);
    assert.ok(
      typeof stats.sessionFile === "string" && stats.sessionFile.length > 0,
      "expected a session file path",
    );
  });

  it("receives the unsolicited startup widgets and statuses", async () => {
    // pi pushes these before answering anything (FINDINGS §11.2), so any
    // assertion on "the first inbound message" would be wrong.
    //
    // The wait accepts EITHER method: what this case asserts is that both are
    // present in the same snapshot, so tying the wait to `setStatus` alone
    // would make the wait fail on a method-name detail rather than on the
    // property under test.
    const entries = await waitForRpc(
      (all) => {
        const methods = new Set(inboundUiRequests(all).map((r) => r.method));
        return methods.has("setWidget") || methods.has("setStatus");
      },
      { timeoutMs: 60_000, what: "a startup setWidget or setStatus ui request" },
    );
    const methods = new Set(inboundUiRequests(entries).map((r) => r.method));
    assert.ok(methods.has("setWidget"), `expected setWidget among ${[...methods].join(", ")}`);
    assert.ok(methods.has("setStatus"), `expected setStatus among ${[...methods].join(", ")}`);
  });
});

describe("M2 — real turn", () => {
  it("completes a real turn and emits agent_start → message_* → agent_settled", async () => {
    const before = inboundEvents(rpcEntries()).length;
    await sendWebviewMessage({ type: "prompt", message: "Reply with the single word: ok" });

    const entries = await waitForRpc((all) => inboundEvents(all).includes("agent_settled"), {
      timeoutMs: 120_000,
      what: "agent_settled after a real prompt",
    });

    const events = inboundEvents(entries);
    const turn = events.slice(before);
    assert.ok(turn.includes("agent_start"), `expected agent_start in ${turn.join(", ")}`);
    assert.ok(
      turn.includes("message_start") && turn.includes("message_end"),
      `expected message_start and message_end in ${turn.join(", ")}`,
    );
    // Structural only: never assert on what the model said.
    //
    // Assert the ORDER by index rather than "the last element is agent_settled":
    // `waitForRpc` returns as soon as agent_settled appears, so further events
    // (queue_update, a later settle) can land between that poll and this slice,
    // and a last-element assertion would fail for a reason unrelated to the turn.
    const order = ["agent_start", "message_start", "message_end", "agent_settled"].map((name) =>
      turn.indexOf(name),
    );
    assert.ok(
      order.every((at, i) => at >= 0 && (i === 0 || at > (order[i - 1] ?? -1))),
      `expected agent_start < message_start < message_end < agent_settled, saw ${turn.join(", ")}`,
    );

    const prompts = inboundResponses(entries).filter((r) => r.command === "prompt");
    assert.ok(prompts.length > 0, "expected a prompt response");
    assert.ok(
      prompts.every((r) => r.success),
      "prompt should not report failures",
    );
  });

  it("writes the session to disk once a prompt exists", async () => {
    // Settles the M1 open question (§6 / §11.3): with no prompt pi reported a
    // sessionFile path but wrote nothing. "At least one file exists" would also
    // pass on a stub written at session creation, so decode the transcript and
    // require a real, complete exchange. No wait is needed before reading: pi
    // flushes the assistant record before emitting the agent_settled the case
    // above waited for (measurement in `readTranscripts`).
    const transcripts = readTranscripts(sessionsDir());
    assert.ok(
      transcripts.length > 0,
      `expected a session transcript under ${sessionsDir()} after a real prompt`,
    );
    for (const transcript of transcripts) {
      assert.equal(
        transcript.malformed.length,
        0,
        `expected JSONL, but ${transcript.file} has unparseable line(s), first: ` +
          `line ${transcript.malformed[0]?.line}: ${transcript.malformed[0]?.text.slice(0, 80)}`,
      );
    }

    const messages = transcripts.flatMap((t) => t.records).map((r) => r.message);
    const roles = messages.map((m) => m?.role);
    assert.ok(roles.includes("user"), `expected a user record, saw roles: ${roles.join(", ")}`);
    const assistants = messages.filter((m) => m !== undefined && m.role === "assistant");
    assert.ok(
      assistants.length > 0,
      `expected an assistant record, saw roles: ${roles.join(", ")}`,
    );
    const reply = assistants.at(-1);
    assert.ok(reply, "expected an assistant record");
    assert.ok(
      Array.isArray(reply.content) && reply.content.length > 0,
      `expected the assistant record to carry non-empty content, got ` +
        `${JSON.stringify(reply.content)?.slice(0, 120)}`,
    );
  });

  it("stops streaming when the turn is aborted", async () => {
    // Snapshot the delta count BEFORE this turn's prompt. The trace log is
    // shared across every case in the run, so a bare ">= 1 message_update"
    // predicate is satisfied instantly by the PREVIOUS turn's deltas — the abort
    // would then be sent before pi starts streaming and the cancellation
    // assertion below would hold trivially. Measured during execution: with the
    // naive predicate the abort went out ~40ms after the prompt and cancelled a
    // request that had not begun streaming.
    const countDeltas = (entries: RpcTraceEntry[]): number =>
      inboundEvents(entries).filter((e) => e === "message_update").length;
    const deltasBeforePrompt = countDeltas(rpcEntries());

    await sendWebviewMessage({
      type: "prompt",
      message: "Count from 1 to 400, one number per line, with no other text.",
    });

    // Now this genuinely waits for THIS turn to start streaming.
    await waitForRpc((all) => countDeltas(all) > deltasBeforePrompt, {
      timeoutMs: 120_000,
      what: "the first message_update delta of this turn",
    });

    // Same snapshot discipline for the abort response: a bare "an abort
    // response exists" predicate would be satisfied by any earlier aborted turn
    // in a reused host, and the error would be "waited for nothing". Require
    // the count to grow after this abort is sent.
    const abortsBefore = inboundResponses(rpcEntries()).filter((r) => r.command === "abort").length;
    await sendWebviewMessage({ type: "abort" });
    const entries = await waitForRpc(
      (all) => inboundResponses(all).filter((r) => r.command === "abort").length > abortsBefore,
      { timeoutMs: 30_000, what: "the abort response" },
    );
    const abortResponse = inboundResponses(entries)
      .filter((r) => r.command === "abort")
      .at(-1);
    assert.ok(abortResponse?.success, "abort should succeed");

    // `abort` resolves with no data (src/services/rpc/client.ts:205), so
    // cancellation is shown structurally: the stream must have STOPPED. Sample
    // twice after the abort and require the count to be stable between the two
    // later samples rather than immediately after the response — a few in-flight
    // deltas can legitimately land after the abort is acknowledged, and asserting
    // no growth at all would flake on them.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const deltasSettled = countDeltas(rpcEntries());
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const deltasLater = countDeltas(rpcEntries());
    assert.equal(
      deltasLater,
      deltasSettled,
      `expected streaming to have stopped, but message_update kept growing: ${deltasSettled} → ${deltasLater}`,
    );
    assert.ok(
      deltasSettled > deltasBeforePrompt,
      "expected the aborted turn to have produced some deltas before the abort",
    );

    // The freeze assertions above cannot distinguish "the abort cancelled the
    // stream" from "the model finished inside the sampling window". The
    // transcript can: it is pi's own record, written for its own turn, and only
    // an actual cancellation sets the last assistant record's `stopReason` to
    // "aborted" (a turn that ran to completion writes "stop"). No wait needed
    // before this read — the record is flushed before pi answers the abort
    // (measurement in `readTranscripts`).
    const assistants = readTranscripts(sessionsDir())
      .flatMap((t) => t.records)
      .map((r) => r.message)
      .filter((m) => m !== undefined && m.role === "assistant");
    const aborted = assistants.at(-1);
    assert.ok(
      aborted,
      `expected an assistant record in the session transcript under ${sessionsDir()}`,
    );
    assert.equal(
      aborted.stopReason,
      "aborted",
      "expected the transcript's last assistant record to carry stopReason=aborted; " +
        "a turn the model finished on its own writes stopReason=stop",
    );
  });
});
