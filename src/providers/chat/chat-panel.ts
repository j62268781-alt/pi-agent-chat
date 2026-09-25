import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { BridgeConfig } from "../../services/bridge/types.ts";
import { ensurePiBinary } from "../../services/pi/process.ts";
import {
  affectsBakedHtml,
  affectsLiveDisplaySettings,
  buildChatWebviewOptions,
  readChatDisplaySettings,
} from "./display-settings.ts";
import { getChatWebviewHtml } from "./webview-html.ts";
import { resolveChatCwd } from "../../utils/chat-cwd.ts";
import { t } from "../../utils/i18n.ts";
import type { ChatTracker } from "./chat-tracker.ts";
import type { RpcClient } from "../../protocol/rpc.ts";
import {
  createChatSession,
  type ChatHost,
  type ChatSession,
  type ChatSessionUpdate,
} from "./chat-session.ts";
import { sessionStatusRegistry } from "../../services/chat/session-status-registry.ts";
import { findPiColumn, findUnusedColumn } from "../../utils/webview-columns.ts";
import { createWorkspaceGate, type WorkspaceGate } from "./workspace-gate.ts";

export { type ChatSessionUpdate } from "./chat-session.ts";

export interface ChatPanelHandle {
  panel: vscode.WebviewPanel;
  rpc: RpcClient;
  panelId: string;
  sessionFile?: string;
  sync?: (opts: ChatSessionUpdate) => void;
}

export interface OpenChatPanelOptions {
  extensionUri: vscode.Uri;
  bridgeConfig?: BridgeConfig;
  tracker: ChatTracker;
  sessionFile?: string;
  panelId?: string;
  cwd?: string;
}

const activePanels = new Map<string, ChatPanelHandle>();
const sessionToPanel = new Map<string, string>();
let lastActivePanelId: string | undefined;

const CHAT_VIEW_TYPE = "pi-agent-chat.chat";
const CHAT_PANEL_TITLE = "Pi Chat";

export async function openChatPanel(
  opts: OpenChatPanelOptions,
): Promise<ChatPanelHandle | undefined> {
  // Reuse an already-open panel for the same session.
  if (opts.sessionFile) {
    const existingId = sessionToPanel.get(opts.sessionFile);
    if (existingId) {
      const handle = activePanels.get(existingId);
      if (handle) {
        handle.panel.reveal(handle.panel.viewColumn ?? vscode.ViewColumn.Active, false);
        return handle;
      }
    }
  }

  const panelId = opts.panelId ?? randomUUID();
  const workspace = resolveChatCwd(opts.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  const panel = vscode.window.createWebviewPanel(
    CHAT_VIEW_TYPE,
    CHAT_PANEL_TITLE,
    findPiColumn() ?? findUnusedColumn() ?? vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
    },
  );
  panel.iconPath = {
    light: vscode.Uri.joinPath(opts.extensionUri, "resources", "logo-light.svg"),
    dark: vscode.Uri.joinPath(opts.extensionUri, "resources", "logo.svg"),
  };
  panel.webview.html = getChatWebviewHtml(buildChatWebviewOptions(workspace));

  let disposed = false;

  const langSub = vscode.workspace.onDidChangeConfiguration((e) => {
    // Display preferences are pushed live: re-rendering the webview for them
    // would throw away the draft, the scroll position and the pending queue.
    if (affectsLiveDisplaySettings(e)) {
      panel.webview.postMessage({ type: "displaySettings", value: readChatDisplaySettings() });
    }
    // Locale and mermaid theme are consumed once at module scope inside the
    // webview, so only these two still need a fresh document.
    if (affectsBakedHtml(e)) {
      panel.webview.html = getChatWebviewHtml(buildChatWebviewOptions(workspace));
    }
  });

  const host: ChatHost = {
    postMessage: (msg) => {
      if (disposed) return;
      panel.webview.postMessage(msg);
    },
    onDidReceiveMessage: (listener) => panel.webview.onDidReceiveMessage(listener),
    onDidDispose: (listener) => panel.onDidDispose(listener),
    updateTitle: (running, sessionName) => {
      if (disposed) return;
      panel.title =
        (running ? "🔵 " : "🟢 ") + t("Pi Chat") + (sessionName ? ` \u2014 ${sessionName}` : "");
    },
  };

  let session: ChatSession | undefined;
  let gate: WorkspaceGate | undefined;
  let handle: ChatPanelHandle | undefined;

  /** Start the session on `folder` and hand the webview over to it. */
  async function startSession(folder: string | undefined): Promise<ChatPanelHandle | undefined> {
    const piPath = await ensurePiBinary();
    if (!piPath) return undefined;
    gate?.dispose();
    gate = undefined;
    const created = await createChatSession({
      extensionUri: opts.extensionUri,
      bridgeConfig: opts.bridgeConfig,
      sessionFile: opts.sessionFile,
      cwd: folder,
      traceTag: panelId.slice(0, 8),
      host,
      // Same bookkeeping as the tracked panels: what the user picked last.
      preferences: opts.tracker,
      onSessionFile: (sessionFile, _name, previous) => {
        if (previous && previous !== sessionFile) {
          sessionToPanel.delete(previous);
          sessionStatusRegistry.remove(previous);
        }
        if (sessionFile) {
          sessionToPanel.set(sessionFile, panelId);
          opts.tracker.update(panelId, sessionFile);
          sessionStatusRegistry.upsert({
            sessionFile,
            status: session?.streaming ? "running" : "idle",
            source: "chat",
            panelId,
          });
        }
      },
      onStreamingChange: (running) => {
        if (session?.sessionFile) {
          sessionStatusRegistry.upsert({
            sessionFile: session.sessionFile,
            status: running ? "running" : "idle",
            source: "chat",
            panelId,
          });
        }
      },
      onExit: () => {
        if (session?.sessionFile) sessionStatusRegistry.remove(session.sessionFile);
      },
    });
    if (!created) return undefined;
    session = created;
    handle = {
      panel,
      rpc: session.rpc,
      panelId,
      get sessionFile() {
        return session?.sessionFile;
      },
      sync: session.sync,
    };
    activePanels.set(panelId, handle);
    lastActivePanelId = panelId;
    panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible) lastActivePanelId = panelId;
    });
    if (opts.sessionFile) {
      sessionToPanel.set(opts.sessionFile, panelId);
      sessionStatusRegistry.upsert({
        sessionFile: opts.sessionFile,
        status: "idle",
        source: "chat",
        panelId,
      });
    }
    // A folder arrived after all (the gate's panel was showing the boot page).
    host.postMessage({ type: "workspaceRequired", required: false });
    return handle;
  }

  if (workspace) {
    await startSession(workspace);
    if (!session) {
      panel.dispose();
      return undefined;
    }
  } else {
    gate = createWorkspaceGate({
      host,
      onFolder: (folder) => {
        void startSession(folder).then((started) => {
          if (!started && !disposed) {
            host.postMessage({
              type: "error",
              message: t("Could not start pi in the folder that was opened."),
            });
          }
        });
      },
      onOpenFolderRequested: () => opts.tracker.markReopenAfterFolder(),
    });
  }

  panel.onDidDispose(() => {
    langSub.dispose();
    disposed = true;
    gate?.dispose();
    activePanels.delete(panelId);
    if (lastActivePanelId === panelId) lastActivePanelId = undefined;
    if (handle?.sessionFile) {
      sessionToPanel.delete(handle.sessionFile);
      sessionStatusRegistry.remove(handle.sessionFile);
    }
    opts.tracker.removePanel(panelId);
    session?.dispose();
  });

  return handle;
}

/** The most recently visible open chat panel, for context-menu targets. */
export function getActivePanelHandle(): ChatPanelHandle | undefined {
  if (lastActivePanelId) {
    const handle = activePanels.get(lastActivePanelId);
    if (handle) return handle;
  }
  for (const h of activePanels.values()) {
    if (h.panel.visible) return h;
  }
  return activePanels.values().next().value;
}

export function disposeAllChatPanels(): void {
  for (const handle of activePanels.values()) {
    void handle.rpc.dispose();
    handle.panel.dispose();
  }
  activePanels.clear();
  sessionToPanel.clear();
  lastActivePanelId = undefined;
}

export function syncOpenChatSession(sessionFile: string, opts: ChatSessionUpdate): boolean {
  const panelId = sessionToPanel.get(sessionFile);
  if (!panelId) return false;
  const handle = activePanels.get(panelId);
  if (!handle?.sync) return false;
  handle.sync(opts);
  return true;
}
