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
import { setConfigValue } from "../../stubs/vscode.ts";

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
  /** Every `setModel`/`setThinkingLevel`/`setSessionName` pi was sent. */
  calls: [] as Array<Record<string, unknown>>,
  /** What the title generator would answer for this first message. */
  title: undefined as string | undefined,
  /** Answers served in order, before `title` takes over. */
  titleScript: [] as Array<string | undefined>,
  /** How many times the generator was asked. */
  titleCalls: 0,
  /** The sound files the host asked a player for. */
  sounds: [] as string[],
  /** Set by a test to hold the title back until it says so. */
  titleGate: null as Promise<void> | null,
}));

vi.mock("../../../../src/services/chat/completion-sound.ts", () => ({
  COMPLETION_SOUND_FILE: "resources/completion.wav",
  playCompletionSound: (file: string) => {
    harness.sounds.push(file);
  },
}));

vi.mock("../../../../src/services/chat/session-title.ts", () => ({
  generateSessionTitle: async () => {
    harness.titleCalls += 1;
    if (harness.titleGate) await harness.titleGate;
    return harness.titleScript.length > 0 ? harness.titleScript.shift() : harness.title;
  },
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
      newSession: async () => {
        // What pi does for `new_session`: the runtime is rebuilt onto a session
        // of its own — a fresh id, and the file path it will write (the path is
        // assigned when the session is created, the write itself is lazy).
        harness.state.sessionId = "session-guide";
        harness.state.sessionFile = "/tmp/pi-sessions/guide.jsonl";
        return { cancelled: false };
      },
      prompt: async () => {},
      setModel: async (provider: string, modelId: string) => {
        harness.calls.push({ type: "setModel", provider, modelId });
        // pi echoes the model it is now on — that is what the panel reads back.
        harness.state.model = { provider, id: modelId, name: modelId } as RpcState["model"];
        return harness.state.model;
      },
      setThinkingLevel: async (level: string) => {
        harness.calls.push({ type: "setThinkingLevel", level });
        harness.state.thinkingLevel = level;
      },
      setSessionName: async (name: string) => {
        harness.calls.push({ type: "setSessionName", name });
        harness.state.sessionName = name;
      },
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
const listOf = () => lists().at(-1)?.sessions as Array<Record<string, unknown>> | undefined;
const lastState = () => states().at(-1)?.state as RpcState | undefined;

async function boot(preferences?: {
  readLastModel(): { provider: string; modelId: string; thinkingLevel?: string } | undefined;
  writeLastModel(value: { provider: string; modelId: string; thinkingLevel?: string }): void;
}): Promise<Session> {
  const session = await createChatSession({
    extensionUri: {
      fsPath: "/fake/extension",
      path: "/fake/extension",
      scheme: "file",
    } as never,
    cwd: "/tmp/work",
    traceTag: "test",
    preferences,
    host: {
      postMessage: (msg: unknown) => posts().push(msg as Record<string, unknown>),
      onDidReceiveMessage: () => ({ dispose: () => {} }),
      onDidDispose: () => ({ dispose: () => {} }),
    },
  });
  if (!session) throw new Error("session was not created");
  return session;
}

/** What the "+" guide does: mark a new session, then send its first message. */
const guideSend = async (session: Session, message: string) => {
  await session.sendFromWebview({ type: "newSession" });
  await session.sendFromWebview({ type: "prompt", message });
};

/** Boot a session with the state a live one would have (a session already open). */
async function bootWithSessionOpen(preferences?: Parameters<typeof boot>[0]): Promise<Session> {
  harness.state.sessionId = "session-before";
  harness.state.sessionFile = "/tmp/pi-sessions/before.jsonl";
  const session = await boot(preferences);
  await session.sendFromWebview({ type: "webviewReady" });
  await vi.waitFor(() => expect(states().length).toBeGreaterThan(0));
  // Hydration is two interleaved bursts of awaits — the constructor's own and
  // the one `webviewReady` triggers — and zeroing the counters mid-flight leaves
  // the tail of the boot counted as whatever the test does next. Every mocked
  // call resolves in a microtask, so a macrotask drains both.
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.calls.length = 0;
  harness.posts.length = 0;
  return session;
}

// Every describe reuses this one harness — one pi, one state object — so the
// reset belongs to the file, not to the first block that needed it: a test that
// leaves a session name behind changes what the next one boots into.
beforeEach(() => {
  harness.posts.length = 0;
  harness.listed.length = 0;
  harness.calls.length = 0;
  // Empty by default: the title coroutine is fire-and-forget, and a test that
  // does not care about naming must not leave one running behind it.
  harness.title = undefined;
  harness.titleScript = [];
  harness.titleCalls = 0;
  harness.sounds.length = 0;
  harness.titleGate = null;
  harness.state.sessionId = undefined;
  harness.state.sessionFile = undefined;
  harness.state.sessionName = undefined;
  harness.state.messageCount = 0;
  harness.state.model = null;
  harness.state.thinkingLevel = "off";
});

describe("the state the host pushes", () => {
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

  // The header shows an unnamed session under a date, and the switcher's row
  // dates it from `SessionManager.list` — not from the file's mtime (measured:
  // seconds to minutes apart). One source, or the two disagree.
  it("dates the session the way its own row in the switcher is dated", async () => {
    const modified = new Date("2026-09-25T09:46:04.225Z");
    harness.state.sessionId = "session-before";
    harness.state.sessionFile = "/tmp/pi-sessions/before.jsonl";
    harness.listed.push({
      path: "/tmp/pi-sessions/before.jsonl",
      name: "",
      firstMessage: "先看登录流程",
      modified,
      messageCount: 2,
    });
    const session = await boot();
    await session.sendFromWebview({ type: "webviewReady" });

    await vi.waitFor(() =>
      expect(
        posts()
          .filter((p) => p.type === "sessionInfo")
          .at(-1),
      ).toMatchObject({
        sessionFile: "/tmp/pi-sessions/before.jsonl",
        modified: modified.toISOString(),
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
  it("carries the live session before pi has written its file", async () => {
    // The session the guide's send replaces; the row that has to appear is the
    // replacement's, whose file pi has not written yet.
    harness.state.sessionId = "session-before";
    harness.state.sessionFile = "/tmp/pi-sessions/before.jsonl";
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
    harness.state.sessionId = "session-before";
    harness.state.sessionFile = "/tmp/pi-sessions/before.jsonl";
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

// `new_session` is a fresh pi session, and pi gives it the model from its own
// settings — measured against the real binary: a session sitting on
// turing/deepseek-v4.1-flash comes back on solar/qoder/deepseek-flash after
// `new_session`, while switching *back* to a session that ran restores that
// session's own model. So the pick the user made by hand only survives a "+" if
// the panel hands it to pi itself (彬哥: 我在 turing 上，点 + 发第一条就变回 solar).
describe("the model a new session starts on", () => {
  const pick = { provider: "turing", modelId: "deepseek-v4.1-flash", thinkingLevel: "low" };
  const prefs = (last?: typeof pick) => ({
    readLastModel: () => last,
    writeLastModel: () => {},
  });

  it("is the one the user picked, not pi's default", async () => {
    harness.state.model = { provider: "solar", id: "qoder/deepseek-flash" } as RpcState["model"];
    const session = await bootWithSessionOpen(prefs(pick));

    await guideSend(session, "先看登录流程");

    expect(harness.calls).toContainEqual({
      type: "setModel",
      provider: "turing",
      modelId: "deepseek-v4.1-flash",
    });
    expect(harness.calls).toContainEqual({ type: "setThinkingLevel", level: "low" });
    // The picker paints whatever `state.model` says, so it has to say the pick.
    await vi.waitFor(() => expect(lastState()?.model).toMatchObject({ provider: "turing" }));
  });

  it("is pi's own default when the user never picked one", async () => {
    harness.state.model = { provider: "solar", id: "qoder/deepseek-flash" } as RpcState["model"];
    const session = await bootWithSessionOpen(prefs(undefined));

    await guideSend(session, "先看登录流程");

    expect(harness.calls).toEqual([]);
    await vi.waitFor(() => expect(lastState()?.model).toMatchObject({ provider: "solar" }));
  });

  it("is what pi reports back after a pick, so the next session can reuse it", async () => {
    const written: Array<{ provider: string; modelId: string; thinkingLevel?: string }> = [];
    const session = await bootWithSessionOpen({
      readLastModel: () => undefined,
      writeLastModel: (value) => written.push(value),
    });
    harness.state.thinkingLevel = "high";

    await session.sendFromWebview({
      type: "setModel",
      provider: "turing",
      modelId: "deepseek-v4.1-flash",
    });

    expect(written).toEqual([
      { provider: "turing", modelId: "deepseek-v4.1-flash", thinkingLevel: "high" },
    ]);
  });
});

// The guide's send replaces the session *while the message that caused it is on
// screen*, and pi's new session has no transcript of its own — the message is
// only reaching pi now. Re-reading that empty list emptied the panel and brought
// the new-session guide back until pi echoed the message (彬哥: 闪到原始新会话页面
// 然后又恢复), so this landing keeps the transcript instead.
describe("the guide's own replacement", () => {
  it("keeps the transcript the panel already has", async () => {
    const session = await bootWithSessionOpen();

    await guideSend(session, "先看登录流程");

    expect(posts().filter((p) => p.type === "adoptSession")).toHaveLength(1);
    expect(posts().filter((p) => p.type === "messages")).toEqual([]);
  });

  it("still hands the header the session it landed on", async () => {
    const session = await bootWithSessionOpen();

    await guideSend(session, "先看登录流程");

    await vi.waitFor(() =>
      expect(
        posts()
          .filter((p) => p.type === "sessionInfo")
          .at(-1),
      ).toMatchObject({
        sessionFile: "/tmp/pi-sessions/guide.jsonl",
      }),
    );
    expect(lastState()?.sessionFile).toBe("/tmp/pi-sessions/guide.jsonl");
  });
});

// The guide's session shows up as a timestamp in the switcher until it has a
// name. The name comes from the message that created it — generated in-process
// while the first turn runs, written quietly (no toast), and never over a name
// the user has set themselves.
describe("naming the session the guide created", () => {
  it("writes the generated title into pi and into the switcher", async () => {
    const session = await bootWithSessionOpen();
    harness.title = "登录会话丢失";

    await guideSend(session, "先看登录流程，为什么刷新之后 session 会丢");

    await vi.waitFor(() =>
      expect(harness.calls).toContainEqual({ type: "setSessionName", name: "登录会话丢失" }),
    );
    await vi.waitFor(() => expect(listOf()?.[0]).toMatchObject({ name: "登录会话丢失" }));
    // Its own push, not the user-rename path: nobody asked for this name.
    expect(
      posts().some((p) => p.type === "toast" && String(p.message).includes("登录会话丢失")),
    ).toBe(false);
  });

  it("leaves a name the user set themselves alone", async () => {
    const session = await bootWithSessionOpen();
    let release: () => void = () => {};
    harness.titleGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await guideSend(session, "先看登录流程");
    await session.sendFromWebview({ type: "setSessionName", name: "我自己起的" });
    release();
    await vi.waitFor(() =>
      expect(harness.calls.filter((c) => c.type === "setSessionName")).toHaveLength(1),
    );
    // The title ran after the rename and had to stand down: the rename is the
    // only name pi was ever given.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.calls.filter((c) => c.type === "setSessionName")).toHaveLength(1);
    expect(harness.state.sessionName).toBe("我自己起的");
    harness.titleGate = null;
  });

  it("stores nothing when the generator has no title to give", async () => {
    const session = await bootWithSessionOpen();

    await guideSend(session, "先看登录流程");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(harness.calls.filter((c) => c.type === "setSessionName")).toEqual([]);
  });

  // The model call can come back empty — a gateway that is down, a reply that
  // sanitized away — and a session that is never named is what 彬哥 reported.
  // The settle of the turn it belongs to is the second chance.
  it("tries again at the settle when the first attempt came back empty", async () => {
    const session = await bootWithSessionOpen();
    harness.titleScript = [undefined, "登录会话丢失"];

    await guideSend(session, "先看登录流程，为什么刷新之后 session 会丢");
    harness.onEvent?.({ type: "agent_start" });
    harness.onEvent?.({ type: "agent_settled" });

    await vi.waitFor(() =>
      expect(harness.calls).toContainEqual({ type: "setSessionName", name: "登录会话丢失" }),
    );
    expect(harness.titleCalls).toBe(2);
  });

  it("gives up after two attempts, however many turns follow", async () => {
    const session = await bootWithSessionOpen();
    harness.title = undefined;

    await guideSend(session, "先看登录流程");
    for (let turn = 0; turn < 3; turn++) {
      harness.onEvent?.({ type: "agent_start" });
      harness.onEvent?.({ type: "agent_settled" });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Two calls for this session, not one per turn: a session that cannot be
    // named must not keep spending model calls for the rest of its life.
    expect(harness.titleCalls).toBe(2);
    expect(harness.calls.filter((c) => c.type === "setSessionName")).toEqual([]);
  });
});

// The chime moved to the host (`completion-sound.ts`): the panel cannot be
// trusted for it — it has no audio rights until the user touches it, and VS Code
// disposes the whole document when the view is put away, so a run that ends while
// the user is elsewhere rang nothing at all. The host has no such gate, and the
// moment it rings is the settle of the run.
describe("the completion chime", () => {
  beforeEach(() => {
    // The setting is the panel's own switch (`pi-agent-chat.chatCompletionSound`).
    setConfigValue("chatCompletionSound", true);
  });

  const settle = (session: Session, stopReason?: string) => {
    harness.onEvent?.({ type: "agent_start" });
    if (stopReason)
      harness.onEvent?.({
        type: "message_end",
        message: { role: "assistant", stopReason },
      } as unknown as RpcEvent);
    harness.onEvent?.({ type: "agent_settled" });
    return session;
  };

  it("rings when a run settles", async () => {
    const session = await bootWithSessionOpen();

    settle(session);

    // The file as it ships: `resources/` is what the .vsix carries.
    expect(harness.sounds).toEqual([expect.stringContaining("resources/completion.wav")]);
  });

  it("stays silent for a run the user stopped", async () => {
    const session = await bootWithSessionOpen();

    settle(session, "aborted");

    expect(harness.sounds).toEqual([]);
  });

  it("rings again for the next run after a stopped one", async () => {
    const session = await bootWithSessionOpen();

    settle(session, "aborted");
    settle(session);

    expect(harness.sounds).toHaveLength(1);
  });

  it("stays silent when the setting is off", async () => {
    setConfigValue("chatCompletionSound", false);
    const session = await bootWithSessionOpen();

    settle(session);

    expect(harness.sounds).toEqual([]);
  });
});
