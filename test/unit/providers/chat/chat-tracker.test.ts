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
      (values.has(key) ? (values.get(key) as T) : fallback),
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
