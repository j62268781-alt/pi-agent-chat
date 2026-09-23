// The gate a folderless window is answered by (see workspace-gate.ts).
//
// What matters is that the webview is never left waiting: the boot page has to
// learn why it cannot start, the folder picker has to be reachable, and a prompt
// that somehow got through must be refused out loud rather than dropped.

import { beforeEach, describe, expect, it, vi } from "vitest";

const vscodeMock = vi.hoisted(() => {
  const listeners: Array<() => void> = [];
  return {
    executed: [] as string[],
    folders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
    listeners,
  };
});

vi.mock("vscode", () => ({
  commands: {
    executeCommand: (command: string) => {
      vscodeMock.executed.push(command);
    },
  },
  env: { language: "en" },
  workspace: {
    get workspaceFolders() {
      return vscodeMock.folders;
    },
    // `utils/i18n` reads configuration before it can translate anything.
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
    onDidChangeWorkspaceFolders: (listener: () => void) => {
      vscodeMock.listeners.push(listener);
      return { dispose: () => {} };
    },
  },
}));

const { createWorkspaceGate } = await import("../../../../src/providers/chat/workspace-gate.ts");

function makeHarness() {
  const posts: Array<Record<string, unknown>> = [];
  const picks: number[] = [];
  let receive: ((msg: unknown) => void) | undefined;
  const gate = createWorkspaceGate({
    onOpenFolderRequested: () => picks.push(Date.now()),
    host: {
      postMessage: (msg) => posts.push(msg as Record<string, unknown>),
      onDidReceiveMessage: (listener) => {
        receive = listener;
        return { dispose: () => {} };
      },
      onDidDispose: () => ({ dispose: () => {} }),
    },
    onFolder: (folder) => posts.push({ started: folder }),
  });
  return {
    posts,
    picks,
    gate,
    send: (msg: unknown) => receive?.(msg),
  };
}

describe("workspace gate", () => {
  beforeEach(() => {
    vscodeMock.executed.length = 0;
    vscodeMock.folders = undefined;
    vscodeMock.listeners.length = 0;
  });

  it("tells the webview a folder is required as soon as it is ready", () => {
    const { posts, send } = makeHarness();

    send({ type: "webviewReady" });

    expect(posts).toEqual([{ type: "workspaceRequired", required: true }]);
  });

  it("runs VS Code's folder picker when the boot page asks for one", () => {
    const { picks, send } = makeHarness();

    send({ type: "openFolder" });

    expect(vscodeMock.executed).toEqual(["workbench.action.files.openFolder"]);
    // The pick reloads the window onto another workspace, so the request to
    // come back has to be recorded before it runs.
    expect(picks).toHaveLength(1);
  });

  it("refuses a prompt aloud instead of dropping it", () => {
    const { posts, send } = makeHarness();

    send({ type: "prompt", message: "hello" });

    expect(posts).toEqual([{ type: "error", message: "Open a workspace folder to start pi." }]);
  });

  it("starts the chat once a folder is added to the window", () => {
    const { posts } = makeHarness();

    vscodeMock.folders = [{ uri: { fsPath: "/tmp/project" } }];
    for (const listener of vscodeMock.listeners) listener();

    expect(posts).toEqual([{ started: "/tmp/project" }]);
  });

  it("stays quiet for a folder change that leaves it folderless", () => {
    const { posts } = makeHarness();

    for (const listener of vscodeMock.listeners) listener();

    expect(posts).toEqual([]);
  });

  it("stops answering the webview once disposed", () => {
    const { posts, gate, send } = makeHarness();

    gate.dispose();
    send({ type: "webviewReady" });

    expect(posts).toEqual([]);
  });
});
