// Sidebar chat: hosts the chat webview UI in a WebviewView (own
// `pi-agent-chat` activity bar container, separate from any other Pi view)
// instead of an editor-tab WebviewPanel. A single session runs in the
// background; closing/hiding the view keeps the RPC subprocess alive, and
// re-resolving the view re-attaches the same session. No RPC process is
// spawned until the user explicitly starts the chat (the view shows a
// starter screen with a button, or `pi-agent-chat.openInSidebar` is run),
// so merely opening the container costs nothing.

import * as vscode from "vscode";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { BridgeConfig } from "../../services/bridge/types.ts";
import { resolveChatCwd } from "../../utils/chat-cwd.ts";
import { t } from "../../utils/i18n.ts";
import {
  affectsBakedHtml,
  affectsLiveDisplaySettings,
  buildChatWebviewOptions,
  readChatDisplaySettings,
} from "./display-settings.ts";
import { getChatWebviewHtml } from "./webview-html.ts";
import { createChatSession, type ChatHost, type ChatSession } from "./chat-session.ts";
import { createWorkspaceGate, type WorkspaceGate } from "./workspace-gate.ts";
import type { ChatTracker } from "./chat-tracker.ts";

export const SIDEBAR_VIEW_ID = "pi-agent-chat.chatSidebar";

/** The background sidebar chat session, if one has been started. */
export function getSidebarSession(): ChatSession | undefined {
  return sidebarState?.session;
}

/** A sidebar chat target that can actually receive messages: a started session
 *  bound to a currently-visible view. Returns undefined if the view was closed
 *  (even though the session keeps running in the background). */
export function getSidebarChatTarget():
  | { session: ChatSession; view: vscode.WebviewView }
  | undefined {
  if (sidebarState?.session && sidebarState?.view) {
    return { session: sidebarState.session, view: sidebarState.view };
  }
  return undefined;
}

/** Focus the sidebar chat view (does not start a session). */
export function focusSidebarChat(): void {
  void sidebarState?.view?.show(false);
}

interface SidebarState {
  view?: vscode.WebviewView;
  session?: ChatSession;
}

interface SidebarChatOptions {
  extensionUri: vscode.Uri;
  bridgeConfig?: BridgeConfig;
  sessionFile?: string;
  newSession?: boolean;
  /** Bookkeeping shared with the editor-panel mode (see `chat-tracker.ts`). */
  chatTracker?: ChatTracker;
}

let sidebarState: SidebarState | undefined;
let currentHost: ChatHost | undefined;
let pendingSession: Promise<ChatSession | undefined> | undefined;
let viewWaiters: Array<(view: vscode.WebviewView) => void> = [];

function waitForView(): Promise<vscode.WebviewView | undefined> {
  if (sidebarState?.view) return Promise.resolve(sidebarState.view);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const i = viewWaiters.indexOf(settle);
      if (i >= 0) viewWaiters.splice(i, 1);
      resolve(undefined);
    }, 5000);
    const settle = (view: vscode.WebviewView) => {
      clearTimeout(timer);
      const i = viewWaiters.indexOf(settle);
      if (i >= 0) viewWaiters.splice(i, 1);
      resolve(view);
    };
    viewWaiters.push(settle);
  });
}

function getChatHtml(): string {
  return getChatWebviewHtml(buildChatWebviewOptions());
}

function makeHost(webviewView: vscode.WebviewView): ChatHost {
  let viewDisposed = false;
  const host: ChatHost = {
    postMessage: (msg) => {
      if (viewDisposed) return;
      void webviewView.webview.postMessage(msg);
    },
    onDidReceiveMessage: (listener) => webviewView.webview.onDidReceiveMessage(listener),
    onDidDispose: (listener) => webviewView.onDidDispose(listener),
  };
  webviewView.onDidDispose(() => {
    viewDisposed = true;
  });
  return host;
}

/** Resolve which session file the sidebar chat should bootstrap with.
 * Command-supplied `sessionFile` wins; `newSession` means start clean; otherwise resume the
 * most recently modified session recorded for the workspace so reopening the chat lands where
 * the last conversation left off. */
async function resolveInitialSessionFile(opts: SidebarChatOptions): Promise<string | undefined> {
  if (opts.sessionFile) return opts.sessionFile;
  if (opts.newSession) return undefined;
  const cwd = resolveChatCwd(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  if (!cwd) return undefined;
  try {
    const sessions = await SessionManager.list(cwd);
    let latest: SessionInfo | undefined;
    for (const s of sessions) {
      const t = s.modified instanceof Date ? s.modified.getTime() : 0;
      const best = latest?.modified instanceof Date ? latest.modified.getTime() : 0;
      if (!latest || t > best) latest = s;
    }
    return latest?.path;
  } catch {
    return undefined;
  }
}

function ensureSidebarSession(opts: SidebarChatOptions): Promise<ChatSession | undefined> {
  if (sidebarState?.session) return Promise.resolve(sidebarState.session);
  pendingSession ??= (async () => {
    const host = currentHost;
    if (!host) return undefined;
    try {
      const session = await createChatSession({
        extensionUri: opts.extensionUri,
        bridgeConfig: opts.bridgeConfig,
        sessionFile: opts.sessionFile,
        cwd: resolveChatCwd(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath),
        traceTag: "sidebar",
        host,
      });
      if (session) sidebarState = { ...sidebarState, session };
      return session;
    } finally {
      // Clear on success and failure alike so the loading screen's retry can start over.
      pendingSession = undefined;
    }
  })();
  return pendingSession;
}

async function startSidebarSession(
  webviewView: vscode.WebviewView,
  host: ChatHost,
  opts: SidebarChatOptions,
): Promise<void> {
  // No folder means no project for pi to run against; the gate (see
  // workspace-gate.ts) owns the webview in that window, so nothing starts here.
  if (!resolveChatCwd(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath)) {
    webviewView.webview.postMessage({ type: "workspaceRequired", required: true });
    return;
  }
  let session: ChatSession | undefined;
  try {
    session = await ensureSidebarSession(opts);
  } catch (e) {
    // Fork change: surface the failure on the loading screen; its retry button keeps the
    // manual path alive without resurrecting the always-there "Start Chat" page.
    void webviewView.webview.postMessage({
      type: "sessionFailed",
      message: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  if (!session || sidebarState?.view !== webviewView) return;
  // The view already shows the chat UI — resolveWebviewView hands it over
  // unconditionally — so re-assigning the html here would reload the webview
  // and restart the boot splash in the middle of starting up.
  session.attach(host);
}

/** Start the sidebar session with the initial-file resolution (command arg > most recent). */
async function startSidebarSessionWithInitialFile(
  webviewView: vscode.WebviewView,
  host: ChatHost,
  opts: SidebarChatOptions,
): Promise<void> {
  const sessionFile = await resolveInitialSessionFile(opts);
  await startSidebarSession(webviewView, host, sessionFile ? { ...opts, sessionFile } : opts);
}

export function createChatSidebarViewProvider(
  opts: SidebarChatOptions,
): vscode.WebviewViewProvider {
  return {
    resolveWebviewView(webviewView: vscode.WebviewView) {
      webviewView.webview.options = {
        enableScripts: true,
        retainContextWhenHidden: true,
      } as vscode.WebviewOptions & { retainContextWhenHidden?: boolean };
      // Always hand over the real chat UI immediately: its boot splash covers
      // the whole startup (board G W5), so there is no separate loading page.
      webviewView.webview.html = getChatHtml();

      const host = makeHost(webviewView);
      currentHost = host;
      sidebarState = { ...sidebarState, view: webviewView };

      const startSub = webviewView.webview.onDidReceiveMessage((msg) => {
        if (msg && typeof msg === "object" && (msg as { type?: unknown }).type === "startSession") {
          void startSidebarSessionWithInitialFile(webviewView, host, opts);
        }
      });

      /** Set while this window has no folder to run the chat against. */
      let gate: WorkspaceGate | undefined;

      const langSub = vscode.workspace.onDidChangeConfiguration((e) => {
        // Display preferences are pushed live; re-rendering the webview for them
        // would throw away the draft, the scroll position and the pending queue.
        if (affectsLiveDisplaySettings(e)) {
          webviewView.webview.postMessage({
            type: "displaySettings",
            value: readChatDisplaySettings(),
          });
        }
        // Locale and mermaid theme are consumed once at module scope inside the
        // webview, so these two still need a fresh document plus a re-attach.
        if (affectsBakedHtml(e) && sidebarState?.session) {
          webviewView.webview.html = getChatHtml();
          sidebarState.session.attach(host);
        }
      });

      if (sidebarState.session) {
        sidebarState.session.attach(host);
      } else if (resolveChatCwd(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath)) {
        // Fork change: auto-start on first open — no manual "Start Chat" click needed. The
        // most recent session of the workspace is resumed so the history is right there; the
        // loading screen stays up only for the ~1s the RPC subprocess needs to boot (and as a
        // retry affordance if starting fails).
        void startSidebarSessionWithInitialFile(webviewView, host, opts);
      } else {
        // Nothing to run against until a folder exists (see workspace-gate.ts).
        gate = createWorkspaceGate({
          host,
          onFolder: () => {
            host.postMessage({ type: "workspaceRequired", required: false });
            void startSidebarSessionWithInitialFile(webviewView, host, opts);
          },
          onOpenFolderRequested: () => opts.chatTracker?.markReopenAfterFolder(),
        });
      }

      webviewView.onDidDispose(() => {
        langSub.dispose();
        startSub.dispose();
        gate?.dispose();
        gate = undefined;
        if (currentHost === host) currentHost = undefined;
        if (sidebarState?.view === webviewView) {
          // Keep the session running in the background; it re-attaches on re-resolve.
          sidebarState = { ...sidebarState, view: undefined };
        }
      });

      for (const w of viewWaiters) w(webviewView);
      viewWaiters = [];
    },
  };
}

export async function openSidebarChat(opts: SidebarChatOptions): Promise<void> {
  // NOTE: focus the VIEW, not the container. `workbench.view.extension.pi-agent-chat`
  // is the activity-bar container command and misbehaves when the container is
  // dragged to the secondary sidebar (focus lands on the primary sidebar,
  // e.g. Explorer). `<viewId>.focus` resolves the view's actual location and
  // opens+focuses the hosting part (primary or secondary) itself.
  await vscode.commands.executeCommand(`${SIDEBAR_VIEW_ID}.focus`);
  const view = await waitForView();
  if (!view) return;

  if (!sidebarState?.session) {
    const host = currentHost;
    if (!host) return;
    await startSidebarSession(view, host, opts);
  }

  const session = sidebarState?.session;
  if (!session) return;

  if (opts.newSession) {
    if (session.sessionFile) {
      if (session.streaming) {
        void vscode.window.showWarningMessage(t("Stop the agent before starting a new session."));
        return;
      }
      await session.newSession();
    }
    void view.show(true);
    return;
  }

  if (opts.sessionFile && session.sessionFile !== opts.sessionFile) {
    if (session.streaming) {
      void vscode.window.showWarningMessage(t("Stop the agent before switching sessions."));
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      t(
        "Switch the sidebar chat to the selected session? The current conversation stays open in the background.",
      ),
      { modal: true },
      t("Switch"),
    );
    if (choice !== t("Switch")) return;
    await session.switchTo(opts.sessionFile);
  }
  void view.show(true);
}

export function disposeSidebarChat(): void {
  if (sidebarState?.session) {
    sidebarState.session.dispose();
  }
  sidebarState = undefined;
  currentHost = undefined;
  pendingSession = undefined;
  viewWaiters = [];
}
