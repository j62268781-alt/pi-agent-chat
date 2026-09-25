// The tracker's cross-workspace marker: "Open Folder…" reloads the window onto
// another workspace, and everything the chat remembered lives in
// `workspaceState`, which belongs to the workspace it left. So the request to
// come back has to survive in `globalState` — and must not fire long after a
// folder pick the user cancelled.

import { describe, expect, it } from "vitest";
import { createChatTracker } from "../../../../src/providers/chat/chat-tracker.ts";

function memento() {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string, fallback?: T): T | undefined =>
      values.has(key) ? (values.get(key) as T) : fallback,
    update: async (key: string, value: unknown): Promise<void> => {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
    },
    keys: () => [...values.keys()],
  };
}

function makeTracker() {
  const workspaceState = memento();
  const globalState = memento();
  // Only the two mementos are reached; the tracker never touches the rest.
  const context = { workspaceState, globalState } as unknown as Parameters<
    typeof createChatTracker
  >[0];
  return { tracker: createChatTracker(context), workspaceState, globalState };
}

describe("reopen-after-folder marker", () => {
  it("is absent until a folder pick asks for it", () => {
    const { tracker } = makeTracker();

    expect(tracker.consumeReopenAfterFolder()).toBe(false);
  });

  it("hands the request over exactly once", () => {
    const { tracker } = makeTracker();

    tracker.markReopenAfterFolder();

    expect(tracker.consumeReopenAfterFolder()).toBe(true);
    // A second reload (an extension update, say) must not open a chat by itself.
    expect(tracker.consumeReopenAfterFolder()).toBe(false);
  });

  it("keeps the request where a workspace change cannot reach it", () => {
    const { tracker, workspaceState, globalState } = makeTracker();

    tracker.markReopenAfterFolder();

    expect(globalState.keys()).toHaveLength(1);
    expect(workspaceState.keys()).toEqual([]);
  });

  it("expires a request the user never completed", () => {
    const { tracker, globalState } = makeTracker();
    const stale = Date.now() - 5 * 60_000;
    void globalState.update("pi-agent-chat.reopenAfterFolder", stale);

    expect(tracker.consumeReopenAfterFolder()).toBe(false);
    // Consumed either way: a stale marker is spent, not left to fire later.
    expect(tracker.consumeReopenAfterFolder()).toBe(false);
  });
});

// pi hands a replacement session the model from its own settings, so the one the
// user picked by hand only survives if the panel keeps it (彬哥: 我在 turing 上,
// 点 + 发第一条就变回 solar). It is per-workspace: the same habit in the same
// project, not a model choice leaking into every other repo.
describe("the model the user last picked", () => {
  it("is nothing until the user picks one", () => {
    const { tracker, workspaceState } = makeTracker();

    expect(tracker.readLastModel()).toBeUndefined();
    expect(workspaceState.keys()).toEqual([]);
  });

  it("remembers the model together with its thinking level", async () => {
    const { tracker } = makeTracker();

    tracker.writeLastModel({
      provider: "turing",
      modelId: "deepseek-v4.1-flash",
      thinkingLevel: "low",
    });

    expect(tracker.readLastModel()).toEqual({
      provider: "turing",
      modelId: "deepseek-v4.1-flash",
      thinkingLevel: "low",
    });
  });

  it("stays in this workspace", () => {
    const { tracker, workspaceState, globalState } = makeTracker();

    tracker.writeLastModel({ provider: "turing", modelId: "deepseek-v4.1-flash" });

    expect(workspaceState.keys()).toEqual(["pi-agent-chat.lastPickedModel"]);
    expect(globalState.keys()).toEqual([]);
  });

  it("ignores a half-written value instead of handing it to pi", () => {
    const { tracker, workspaceState } = makeTracker();
    void workspaceState.update("pi-agent-chat.lastPickedModel", { provider: "turing" });

    expect(tracker.readLastModel()).toBeUndefined();
  });
});
