import { describe, expect, it } from "vitest";
import type { RpcClient, RpcState } from "../../../../src/protocol/rpc.ts";
import {
  createSessionMutations,
  sessionIdentity,
  waitForSessionReplacement,
  type SessionBusy,
} from "../../../../src/providers/chat/session-replacement.ts";

/** Only identity is ever read, so a client stub is enough. */
function fakeClient(): RpcClient {
  return {} as RpcClient;
}

function state(identity: { sessionId?: string; sessionFile?: string }): RpcState {
  return { model: null, thinkingLevel: "off", isStreaming: false, ...identity };
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

describe("createSessionMutations", () => {
  it("runs one operation at a time, in the order they were queued", async () => {
    const client = fakeClient();
    const mutations = createSessionMutations({
      client: () => client,
      disposed: () => false,
      busy: () => undefined,
    });
    const log: string[] = [];
    const slow = mutations.run(async () => {
      log.push("a:enter");
      await sleep(30);
      log.push("a:exit");
    });
    const fast = mutations.run(async () => {
      log.push("b:enter");
      log.push("b:exit");
    });
    await Promise.all([slow, fast]);
    expect(log).toEqual(["a:enter", "a:exit", "b:enter", "b:exit"]);
  });

  it("keeps the queue moving after an operation fails", async () => {
    const client = fakeClient();
    const mutations = createSessionMutations({
      client: () => client,
      disposed: () => false,
      busy: () => undefined,
    });
    const failed = mutations.run(async () => {
      throw new Error("switch failed");
    });
    await expect(failed).rejects.toThrow("switch failed");
    await expect(mutations.run(async () => "ran")).resolves.toBe("ran");
  });

  it("refuses to start on a closed chat", async () => {
    const mutations = createSessionMutations({
      client: fakeClient,
      disposed: () => true,
      busy: () => undefined,
    });
    await expect(mutations.run(async () => "ran")).rejects.toThrow(
      "This chat was closed before the operation finished.",
    );
  });

  it("surfaces a pi restart that happened mid-operation", async () => {
    let client = fakeClient();
    const mutations = createSessionMutations({
      client: () => client,
      disposed: () => false,
      busy: () => undefined,
    });
    await expect(
      mutations.run(async (guard) => {
        client = fakeClient();
        guard.assertCurrent();
      }),
    ).rejects.toThrow("Pi restarted before the operation finished.");
  });

  it("refuses a replacement while a run is in flight, inside the queue", async () => {
    let busy: SessionBusy | undefined;
    const mutations = createSessionMutations({
      client: fakeClient,
      disposed: () => false,
      busy: () => busy,
    });
    // Busy by the time the operation gets its turn, not when it was enqueued.
    const queued = mutations.run(async (guard) => {
      guard.assertIdle();
      return "ran";
    });
    busy = "streaming";
    await expect(queued).rejects.toThrow("Stop the agent before changing sessions.");
  });
});

describe("sessionIdentity", () => {
  it("reads the identity pi answers with, tolerating a session without a file", () => {
    expect(sessionIdentity(state({ sessionId: "s1", sessionFile: "/tmp/a.jsonl" }))).toEqual({
      sessionId: "s1",
      sessionFile: "/tmp/a.jsonl",
    });
    expect(sessionIdentity(state({ sessionId: "s1" }))).toEqual({
      sessionId: "s1",
      sessionFile: undefined,
    });
    expect(sessionIdentity(undefined)).toEqual({ sessionId: undefined, sessionFile: undefined });
  });
});

describe("waitForSessionReplacement", () => {
  it("returns as soon as pi is on the requested file", async () => {
    const asked = "/tmp/wanted.jsonl";
    const landed = await waitForSessionReplacement(
      async () => state({ sessionId: "s2", sessionFile: asked }),
      { sessionId: "s1", sessionFile: "/tmp/left.jsonl" },
      asked,
      { timeoutMs: 200, pollMs: 5 },
    );
    expect(landed.sessionFile).toBe(asked);
  });

  it("polls through a state that lags the switch", async () => {
    const asked = "/tmp/wanted.jsonl";
    let answers = 0;
    const landed = await waitForSessionReplacement(
      async () => {
        answers += 1;
        return answers < 3
          ? state({ sessionId: "s1", sessionFile: "/tmp/left.jsonl" })
          : state({ sessionId: "s2", sessionFile: asked });
      },
      { sessionId: "s1", sessionFile: "/tmp/left.jsonl" },
      asked,
      { timeoutMs: 500, pollMs: 5 },
    );
    expect(answers).toBe(3);
    expect(landed.sessionId).toBe("s2");
  });

  it("reports a switch that never landed", async () => {
    await expect(
      waitForSessionReplacement(
        async () => state({ sessionId: "s1", sessionFile: "/tmp/left.jsonl" }),
        { sessionId: "s1", sessionFile: "/tmp/left.jsonl" },
        "/tmp/wanted.jsonl",
        { timeoutMs: 30, pollMs: 5 },
      ),
    ).rejects.toThrow("Pi did not switch to the requested session.");
  });

  it("treats any other session as the proof for a replacement with no target", async () => {
    const landed = await waitForSessionReplacement(
      async () => state({ sessionId: "s2", sessionFile: "/tmp/fresh.jsonl" }),
      { sessionId: "s1", sessionFile: "/tmp/left.jsonl" },
      undefined,
      { timeoutMs: 200, pollMs: 5 },
    );
    expect(landed.sessionId).toBe("s2");
  });

  it("reports a replacement that never produced another session", async () => {
    await expect(
      waitForSessionReplacement(
        async () => state({ sessionId: "s1", sessionFile: "/tmp/left.jsonl" }),
        { sessionId: "s1", sessionFile: "/tmp/left.jsonl" },
        undefined,
        { timeoutMs: 30, pollMs: 5 },
      ),
    ).rejects.toThrow("Pi did not start the new session.");
  });

  it("does not wait when there was no identity to compare against", async () => {
    let answers = 0;
    const landed = await waitForSessionReplacement(
      async () => {
        answers += 1;
        return state({ sessionId: "s1" });
      },
      {},
      undefined,
      { timeoutMs: 200, pollMs: 5 },
    );
    expect(answers).toBe(1);
    expect(landed.sessionId).toBe("s1");
  });
});
