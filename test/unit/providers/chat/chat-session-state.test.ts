// What the host tells the webview about the session it is holding.
//
// The header's "+" is gated on the host's own message count (`sessionHasMessages`
// in ChatToolbar.vue), so that count has to travel with every change the
// transcript makes. The host pushes it at boot, at a switch, and on a
// model/thinking/name change — the run itself was missing: a session the guide
// created is pushed with count 0 the moment it is born, and stayed 0 for the
// whole conversation, so the "+" never came back (彬哥: "点不了没反应"). The
// transcript held both messages and pi's own `get_state` said `2`; only the
// mirror the button reads was frozen.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RpcClient, RpcEvent, RpcState } from "../../../../src/protocol/rpc.ts";

const harness = vi.hoisted(() => ({
  posts: [] as Array<Record<string, unknown>>,
  onEvent: undefined as ((event: RpcEvent) => void) | undefined,
  /** What `SessionManager.list` would find on disk. */
  listed: [] as Array<Record<string, unknown>>,
  /**
   * What pi would answer right now — the test moves it as the session grows.
   * A session nothing has been sent to yet has no file: pi writes the JSONL
   * lazily, on the first turn.
   */
  state: {
    sessionFile: undefined as string | undefined,
    sessionName: undefined as string | undefined,
    messageCount: 0,
    isStreaming: false,
    model: null,
    thinkingLevel: "off",
  } as RpcState & { messageCount: number },
}));

vi.mock("../../../../src/services/rpc/client.ts", () => ({
  createRpcClient: async (options: { handlers: { onEvent: (event: RpcEvent) => void } }) => {
    harness.onEvent = options.handlers.onEvent;
    const rpc = {
      getState: async () => ({ ...harness.state }),
      getMessages: async () => [],
      getAvailableModels: async () => [],
      getAvailableThinkingLevels: async () => [],
      getCommands: async () => [],
      getSessionStatsFull: async () => ({}),
      newSession: async () => ({ cancelled: false }),
      prompt: async () => {},
      dispose: async () => {},
      lastStderr: () => "",
    };
    return rpc as unknown as RpcClient;
  },
}));

vi.mock("../../../../src/services/pi/process.ts", () => ({
  ensurePiBinary: async () => "/fake/pi",
  createRpcEnvironment: () => undefined,
  createRpcShellArgs: () => [],
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  SessionManager: { list: async () => harness.listed },
}));

vi.mock("../../../../src/services/settings/settings-config.ts", () => ({
  readEnabledModelKeys: () => [],
  toggleFavoriteModel: () => {},
}));

const { createChatSession } = await import("../../../../src/providers/chat/chat-session.ts");

type Session = NonNullable<Awaited<ReturnType<typeof createChatSession>>>;

const posts = () => harness.posts;
const states = () => posts().filter((p) => p.type === "state");
const lists = () => posts().filter((p) => p.type === "sessionsList");

async function boot(): Promise<Session> {
  const session = await createChatSession({
    extensionUri: {
      fsPath: "/fake/extension",
      path: "/fake/extension",
      scheme: "file",
    } as never,
    cwd: "/tmp/work",
    traceTag: "test",
    host: {
      postMessage: (msg: unknown) => posts().push(msg as Record<string, unknown>),
      onDidReceiveMessage: () => ({ dispose: () => {} }),
      onDidDispose: () => ({ dispose: () => {} }),
    },
  });
  if (!session) throw new Error("session was not created");
  return session;
}

describe("the state the host pushes", () => {
  beforeEach(() => {
    harness.posts.length = 0;
    harness.listed.length = 0;
    harness.state.sessionFile = undefined;
    harness.state.sessionName = undefined;
    harness.state.messageCount = 0;
  });

  it("carries the run's fresh message count when the run settles", async () => {
    const session = await boot();
    await session.sendFromWebview({ type: "webviewReady" });
    await vi.waitFor(() => expect(states().length).toBeGreaterThan(0));

    // The turn: the user's message and the answer both land in the transcript,
    // so pi's count moves while the run is in flight.
    const before = posts().length;
    harness.state.messageCount = 2;
    harness.onEvent?.({ type: "agent_start" });
    harness.onEvent?.({ type: "agent_settled" });

    await vi.waitFor(() =>
      expect(
        posts()
          .slice(before)
          .filter((p) => p.type === "state")
          .at(-1)?.state,
      ).toMatchObject({
        messageCount: 2,
      }),
    );
  });

  it("names the session file a lazily-created session only writes on its first turn", async () => {
    const session = await boot();
    await session.sendFromWebview({ type: "webviewReady" });
    await vi.waitFor(() => expect(states().length).toBeGreaterThan(0));

    const before = posts().length;
    harness.state.sessionFile = "/tmp/pi-sessions/first-turn.jsonl";
    harness.state.sessionName = "first turn";
    harness.onEvent?.({ type: "agent_start" });
    harness.onEvent?.({ type: "agent_settled" });

    await vi.waitFor(() =>
      expect(
        posts()
          .slice(before)
          .filter((p) => p.type === "sessionInfo")
          .at(-1),
      ).toMatchObject({ sessionFile: "/tmp/pi-sessions/first-turn.jsonl" }),
    );
  });
});

// pi writes a session's JSONL when its first turn ends, and the list is a disk
// scan — so a session the guide just created was on no scan at all: the switcher
// listed every session except the one in use (彬哥: 发完消息要等它跑完才出现在列表里).
describe("the session list", () => {
  const listOf = () => lists().at(-1)?.sessions as Array<Record<string, unknown>> | undefined;

  const guideSend = async (session: Session, message: string) => {
    await session.sendFromWebview({ type: "newSession" });
    await session.sendFromWebview({ type: "prompt", message });
  };

  it("carries the live session before pi has written its file", async () => {
    harness.state.sessionFile = "/tmp/pi-sessions/guide.jsonl";
    const session = await boot();
    await session.sendFromWebview({ type: "webviewReady" });
    await vi.waitFor(() => expect(states().length).toBeGreaterThan(0));

    harness.posts.length = 0;
    await guideSend(session, "先看登录流程");
    await session.sendFromWebview({ type: "listSessions" });

    await vi.waitFor(() => expect(listOf()).toHaveLength(1));
    expect(listOf()?.[0]).toMatchObject({
      file: "/tmp/pi-sessions/guide.jsonl",
      firstMessage: "先看登录流程",
    });
  });

  it("hands the row back to the disk scan once the file exists", async () => {
    harness.state.sessionFile = "/tmp/pi-sessions/guide.jsonl";
    const session = await boot();
    await session.sendFromWebview({ type: "webviewReady" });
    await vi.waitFor(() => expect(states().length).toBeGreaterThan(0));
    await guideSend(session, "先看登录流程");

    harness.listed.push({
      path: "/tmp/pi-sessions/guide.jsonl",
      name: "登录流程",
      firstMessage: "先看登录流程",
      modified: new Date(),
      messageCount: 2,
    });
    harness.posts.length = 0;
    await session.sendFromWebview({ type: "listSessions" });

    await vi.waitFor(() => expect(listOf()).toHaveLength(1));
    expect(listOf()?.[0]).toMatchObject({ name: "登录流程", messageCount: 2 });
  });
});
