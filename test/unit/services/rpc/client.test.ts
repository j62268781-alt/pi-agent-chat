import { afterEach, describe, expect, it } from "vitest";
import {
  COMPACTION_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  SESSION_REPLACEMENT_TIMEOUT_MS,
  createRpcClient,
} from "../../../../src/services/rpc/client.ts";
import type { RpcClient } from "../../../../src/protocol/rpc.ts";

// Stand-in for `pi --mode rpc`, spoken through the node binary itself so the
// suite needs no pi installation: `get_state` answers at once, `slow` and
// `late` answer after 300ms, `hang` never answers.
const FAKE_PI = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  for (let nl = buffer.indexOf("\\n"); nl !== -1; nl = buffer.indexOf("\\n")) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (!line.trim()) continue;
    const command = JSON.parse(line);
    const answer = (data) =>
      process.stdout.write(
        JSON.stringify({
          id: command.id,
          type: "response",
          command: command.type,
          success: true,
          data,
        }) + "\\n",
      );
    if (command.type === "get_state") answer({ sessionId: "fake-session" });
    if (command.type === "slow" || command.type === "late") {
      setTimeout(() => answer({ ok: true }), 300);
    }
  }
});
`;

const started: RpcClient[] = [];
const errors: Error[] = [];

async function start(): Promise<RpcClient> {
  const client = await createRpcClient({
    piPath: process.execPath,
    args: ["-e", FAKE_PI],
    handlers: {
      onEvent: () => {},
      onExtensionUiRequest: () => {},
      onExit: () => {},
      onError: (err) => errors.push(err),
    },
  });
  started.push(client);
  return client;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((client) => client.dispose()));
  errors.length = 0;
});

describe("rpc request timeouts", () => {
  it("resolves a command pi answers", async () => {
    const client = await start();
    await expect(client.getState()).resolves.toMatchObject({ sessionId: "fake-session" });
  });

  it("rejects a command pi never answers, naming the command and the wait", async () => {
    const client = await start();
    await expect(client.request({ type: "hang" }, 1000)).rejects.toThrow(
      'Pi did not answer "hang" within 1s.',
    );
  });

  it("drops a late answer instead of disturbing the client", async () => {
    const client = await start();
    await expect(client.request({ type: "late" }, 150)).rejects.toThrow(/did not answer "late"/);
    // The answer lands well after the rejection; it must go nowhere.
    await sleep(300);
    expect(errors).toEqual([]);
    await expect(client.getState()).resolves.toMatchObject({ sessionId: "fake-session" });
  });

  it("answers inside the timeout without rejecting", async () => {
    const client = await start();
    await expect(client.request({ type: "slow" }, 5000)).resolves.toEqual({ ok: true });
    expect(errors).toEqual([]);
  });

  it("gives session replacement and compaction more room than an ordinary command", () => {
    expect(SESSION_REPLACEMENT_TIMEOUT_MS).toBeGreaterThan(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(COMPACTION_TIMEOUT_MS).toBeGreaterThan(SESSION_REPLACEMENT_TIMEOUT_MS);
  });
});
