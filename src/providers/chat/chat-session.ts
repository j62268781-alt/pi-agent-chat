// Shared chat session controller: owns the `pi --mode rpc` subprocess and all
// webview<->extension message handling. The same session logic backs either a
// WebviewPanel (editor tab) or a WebviewView (sidebar).

import { statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import * as vscode from "vscode";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { t } from "../../utils/i18n.ts";
import type { BridgeConfig } from "../../services/bridge/types.ts";
import {
  createRpcEnvironment,
  createRpcShellArgs,
  ensurePiBinary,
} from "../../services/pi/process.ts";
import {
  readEnabledModelKeys,
  toggleFavoriteModel,
} from "../../services/settings/settings-config.ts";
import type {
  ExtensionUiRequest,
  RpcClient,
  RpcEvent,
  RpcImage,
  RpcSessionEntry,
  RpcSessionStats,
} from "../../protocol/rpc.ts";
import type { SessionListItem } from "../../protocol/messages.ts";
import { createRpcClient } from "../../services/rpc/client.ts";
import { mergeBuiltinCommands, parseBuiltin } from "../../services/chat/builtin-commands.ts";
import { readPiChangelog } from "../../utils/changelog.ts";

export interface ChatSessionUpdate {
  rename?: string;
}

/** Abstract webview host so the same session can back a panel or a view. */
export interface ChatHost {
  postMessage(msg: unknown): void;
  onDidReceiveMessage(listener: (message: unknown) => void): vscode.Disposable;
  onDidDispose(listener: () => void): vscode.Disposable;
  updateTitle?(running: boolean, sessionName?: string): void;
}

export interface ChatSessionOptions {
  extensionUri: vscode.Uri;
  bridgeConfig?: BridgeConfig;
  sessionFile?: string;
  cwd?: string;
  traceTag: string;
  host: ChatHost;
  /** Host-side bookkeeping when the session file becomes known (panels persist it). */
  onSessionFile?: (
    sessionFile: string | undefined,
    name: string | undefined,
    previous: string | undefined,
  ) => void;
  /** Streaming status changed (panels update the sidebar status registry). */
  onStreamingChange?: (running: boolean) => void;
  /** The pi subprocess exited. */
  onExit?: (code: number | null) => void;
}

export interface ChatSession {
  rpc: RpcClient;
  host: ChatHost;
  sessionFile?: string;
  streaming: boolean;
  attach(host: ChatHost): void;
  sync(opts: ChatSessionUpdate): void;
  switchTo(sessionFile: string): Promise<void>;
  newSession(): Promise<void>;
  dispose(): void;
}

const MCP_STATUS_MARKER = "__mcp_status__";
const DIFF_PANEL_TITLE = "Pi Diff";

const allSessions = new Set<ChatSession>();

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let t = "";
  for (const block of content) {
    if (typeof block === "string") t += block;
    else if (
      block &&
      typeof block === "object" &&
      block.type === "text" &&
      typeof block.text === "string"
    )
      t += (t ? "\n" : "") + block.text;
  }
  return t;
}

function buildActiveBranch(entries: RpcSessionEntry[], leafId: string | null): RpcSessionEntry[] {
  const byId = new Map<string, RpcSessionEntry>();
  for (const e of entries) byId.set(e.id, e);
  const path: RpcSessionEntry[] = [];
  const seen = new Set<string>();
  let id: string | null = leafId;
  while (id != null) {
    if (seen.has(id)) break;
    seen.add(id);
    const entry = byId.get(id);
    if (!entry) break;
    path.push(entry);
    id = entry.parentId ?? null;
  }
  return path.reverse();
}

function compactedHistoryMessages(
  entries: RpcSessionEntry[],
  leafId: string | null,
): unknown[] | null {
  const branch = buildActiveBranch(entries, leafId);
  let lastCompaction: RpcSessionEntry | null = null;
  let lastCompactionIndex = -1;
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (e && e.type === "compaction") {
      lastCompaction = e;
      lastCompactionIndex = i;
      break;
    }
  }
  if (!lastCompaction) return null;
  // Entries before the latest compaction's firstKeptEntryId were summarized away
  // (kept entries still appear in get_messages and must not be duplicated here).
  const boundaryId = lastCompaction.firstKeptEntryId;
  let historyEnd = lastCompactionIndex;
  if (boundaryId) {
    for (let i = 0; i < lastCompactionIndex; i++) {
      if (branch[i]?.id === boundaryId) {
        historyEnd = i;
        break;
      }
    }
  }
  const out: unknown[] = [];
  for (let i = 0; i < historyEnd; i++) {
    const entry = branch[i];
    if (!entry) continue;
    if (entry.type === "message" && entry.message) {
      out.push(entry.message);
    } else if (entry.type === "compaction") {
      out.push({
        role: "compactionSummary",
        summary: entry.summary ?? "",
        tokensBefore: typeof entry.tokensBefore === "number" ? entry.tokensBefore : undefined,
      });
    }
  }
  return out;
}

function openRewindDiff(msg: {
  absPath: string;
  baselineHash: string | null;
  sessionId: string;
  basename: string;
}): void {
  const left = msg.baselineHash
    ? vscode.Uri.parse(
        `pi-rewind:snapshot/${msg.sessionId}/${msg.baselineHash}/${encodeURIComponent(msg.basename)}`,
      )
    : vscode.Uri.parse(`pi-rewind:empty/${encodeURIComponent(msg.basename)}`);
  let right: vscode.Uri;
  try {
    statSync(msg.absPath);
    right = vscode.Uri.file(msg.absPath);
  } catch {
    right = vscode.Uri.parse(`pi-rewind:empty/${encodeURIComponent(msg.basename)}`);
  }
  void vscode.commands.executeCommand(
    "vscode.diff",
    left,
    right,
    DIFF_PANEL_TITLE + ": " + msg.basename,
  );
}

function escapeGlob(s: string): string {
  let out = "";
  for (const ch of s) {
    const lower = ch.toLowerCase();
    const upper = ch.toUpperCase();
    if (lower !== upper) {
      out += `[${lower}${upper}]`;
    } else if (/[*?[\]{}()!@\\]/.test(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return out;
}

export async function createChatSession(
  opts: ChatSessionOptions,
): Promise<ChatSession | undefined> {
  const piPath = await ensurePiBinary();
  if (!piPath) return undefined;

  let host = opts.host;
  let msgSub: vscode.Disposable | undefined;
  let sessionDisposed = false;
  let needsSessionFile = !opts.sessionFile;
  let sessionName: string | undefined;
  let currentSessionFile = opts.sessionFile;
  let streaming = false;
  /**
   * The "+" guide is up but pi has no session for it yet. The first prompt
   * creates the session (`case "prompt"`); switching or deleting clears it.
   */
  let pendingNewSession = false;
  let switchedSession = false;
  let historyLoaded = false;
  let historyLoading: Promise<void> | null = null;
  let rpc: RpcClient;

  const cwd = opts.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  function updateStreamingState(running: boolean): void {
    streaming = running;
    host.updateTitle?.(running, sessionName);
    opts.onStreamingChange?.(running);
  }

  function applySessionFile(sessionFile: string | undefined, name?: string): void {
    sessionName = name;
    if (!sessionFile) {
      needsSessionFile = true;
      void sendSessionInfo();
      return;
    }
    needsSessionFile = false;
    const previous = currentSessionFile;
    currentSessionFile = sessionFile;
    opts.onSessionFile?.(sessionFile, name, previous);
    void sendSessionInfo();
  }

  function shortenHome(p: string): string {
    const home = homedir();
    if (home && (p === home || p.startsWith(home + sep))) return "~" + p.slice(home.length);
    return p;
  }

  function toDisplayPath(fsPath: string, base: string): string {
    const rel = relative(base, fsPath);
    if (rel === "") return ".";
    if (!rel.startsWith("..") && !isAbsolute(rel)) return rel;
    return shortenHome(fsPath);
  }

  async function sendSessionInfo(): Promise<void> {
    if (sessionDisposed) return;
    // The webview toolbar shows only the session name — cwd and branch are
    // visible in the editor's own UI and read as noise in a chat header.
    host.postMessage({
      type: "sessionInfo",
      label: sessionName || "",
      sessionFile: currentSessionFile ?? null,
    });
  }

  async function sendContextUsage(): Promise<void> {
    if (sessionDisposed) return;
    try {
      const stats = await rpc.getSessionStatsFull();
      if (sessionDisposed) return;
      host.postMessage({
        type: "contextUsage",
        usage: stats.contextUsage ?? null,
        cost: stats.cost,
      });
    } catch {
      // ignore - stats are best-effort
    }
  }

  async function refreshContextAfterCompaction(event: RpcEvent): Promise<void> {
    if (sessionDisposed) return;
    const aborted = event.aborted as boolean | undefined;
    const errorMessage = event.errorMessage as string | undefined;
    if (!aborted && !errorMessage) {
      // rehydrate so the compactionSummary block renders in-stream
      try {
        const msgs = await rpc.getMessages();
        if (!sessionDisposed) postMessages(msgs);
      } catch {
        // fall through to context refresh
      }
    }
    const result = event.result as { estimatedTokensAfter?: number } | undefined;
    const after = result?.estimatedTokensAfter;
    if (typeof after === "number") {
      try {
        const st = await rpc.getState();
        const cw = st.model?.contextWindow ?? null;
        if (!sessionDisposed && cw != null && cw > 0) {
          host.postMessage({
            type: "contextUsage",
            usage: { tokens: after, contextWindow: cw, percent: (after / cw) * 100 },
          });
          return;
        }
      } catch {
        // fall through to best-effort refresh
      }
    }
    void sendContextUsage();
  }

  function toast(text: string, kind?: "info" | "success" | "error" | "warning"): void {
    if (sessionDisposed) return;
    host.postMessage({ type: "toast", text, ...(kind ? { kind } : {}) });
  }

  /**
   * Per-session snapshots of the last full message list we rendered, keyed by
   * session file. Switching sessions costs pi 2.7-3.9s no matter what (measured:
   * it tears down and rebuilds the whole session runtime), so switching BACK to
   * a recently viewed session replays its snapshot instantly and lets the real
   * `switch_session` + `get_messages` catch up behind it.
   *
   * Bounded on purpose — payloads carry base64 images, so this is an LRU with a
   * byte budget: at most 4 sessions / 24MB resident, and a single session over
   * half the budget is not cached at all.
   */
  const MESSAGES_CACHE_MAX_ENTRIES = 4;
  const MESSAGES_CACHE_MAX_BYTES = 24 * 1024 * 1024;
  const messagesCache = new Map<
    string,
    { messages: unknown[]; historyAvailable: boolean; bytes: number }
  >();
  let messagesCacheBytes = 0;

  function cacheMessages(
    file: string | undefined,
    messages: unknown[],
    historyAvailable: boolean,
  ): void {
    if (!file) return;
    const previous = messagesCache.get(file);
    if (previous) {
      messagesCacheBytes -= previous.bytes;
      messagesCache.delete(file);
    }
    let bytes = 0;
    try {
      bytes = JSON.stringify(messages).length;
    } catch {
      return; // not serializable — never going to survive the bridge either
    }
    if (bytes > MESSAGES_CACHE_MAX_BYTES / 2) return;
    messagesCache.set(file, { messages, historyAvailable, bytes });
    messagesCacheBytes += bytes;
    while (
      messagesCache.size > MESSAGES_CACHE_MAX_ENTRIES ||
      messagesCacheBytes > MESSAGES_CACHE_MAX_BYTES
    ) {
      const oldest = messagesCache.keys().next().value;
      if (oldest === undefined) break;
      messagesCacheBytes -= messagesCache.get(oldest)?.bytes ?? 0;
      messagesCache.delete(oldest);
    }
  }

  function postMessages(messages: unknown[]): void {
    if (sessionDisposed) return;
    historyLoaded = false;
    const historyAvailable = messages.some(
      (m) => !!m && typeof m === "object" && (m as { role?: string }).role === "compactionSummary",
    );
    host.postMessage({ type: "messages", messages, historyAvailable });
    cacheMessages(currentSessionFile, messages, historyAvailable);
  }

  /**
   * Post this workspace's recorded sessions, newest first. Also the refresh
   * path after one is deleted.
   */
  async function postSessionsList(): Promise<void> {
    let items: SessionListItem[] = [];
    try {
      const list = cwd ? await SessionManager.list(cwd) : [];
      list.sort(function (a, b) {
        return (b.modified?.getTime() ?? 0) - (a.modified?.getTime() ?? 0);
      });
      // Full history, newest first — the list scrolls, no point truncating:
      // real workspaces hold dozens of sessions, not hundreds (measured 21).
      items = list.map(function (s) {
        return {
          file: s.path,
          name: s.name ?? "",
          firstMessage: s.firstMessage ?? "",
          modified:
            s.modified instanceof Date ? s.modified.toISOString() : String(s.modified ?? ""),
          messageCount: s.messageCount ?? 0,
        };
      });
    } catch {
      // leave items empty; the popup shows its empty state
    }
    if (!sessionDisposed) {
      host.postMessage({
        type: "sessionsList",
        sessions: items,
        currentFile: currentSessionFile ?? null,
      });
    }
  }

  async function requestHistory(): Promise<void> {
    if (sessionDisposed || historyLoaded || historyLoading) return;
    historyLoading = (async () => {
      try {
        const entriesData = await rpc.getEntries();
        const history = compactedHistoryMessages(entriesData.entries, entriesData.leafId) ?? [];
        if (sessionDisposed) return;
        historyLoaded = true;
        host.postMessage({ type: "history", messages: history });
      } catch (e) {
        if (!sessionDisposed) {
          host.postMessage({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      } finally {
        historyLoading = null;
      }
    })();
    await historyLoading;
  }

  function showInfoPanel(title: string, markdown: string): void {
    if (sessionDisposed) return;
    host.postMessage({ type: "infoPanel", title, markdown });
  }

  function formatSessionStats(s: RpcSessionStats): string {
    const lines: string[] = ["| Field | Value |", "|---|---|"];
    if (s.sessionId) lines.push(`| Session ID | \`${s.sessionId}\` |`);
    if (s.sessionFile) lines.push(`| Session file | \`${s.sessionFile}\` |`);
    const um = s.userMessages ?? 0;
    const am = s.assistantMessages ?? 0;
    lines.push(`| Messages | ${s.totalMessages ?? 0} (user ${um}, assistant ${am}) |`);
    if (s.toolCalls != null || s.toolResults != null) {
      lines.push(`| Tool calls | ${s.toolCalls ?? 0} (${s.toolResults ?? 0} results) |`);
    }
    if (s.cost != null) lines.push(`| Cost | $${s.cost.toFixed(4)} |`);
    const t = s.tokens;
    if (t) {
      lines.push(
        `| Tokens | in ${t.input ?? 0}, out ${t.output ?? 0}, cache read ${t.cacheRead ?? 0}, cache write ${t.cacheWrite ?? 0}, **total ${t.total ?? 0}** |`,
      );
    }
    return lines.join("\n");
  }

  async function applySessionName(name: string): Promise<void> {
    try {
      await rpc.setSessionName(name);
    } catch (e) {
      if (String(e instanceof Error ? e.message : e).includes("set_session_name")) {
        toast("Setting the session name requires a newer pi. Please upgrade.", "error");
        return;
      }
      throw e;
    }
    const st = await rpc.getState();
    applySessionFile(st.sessionFile, name);
    host.postMessage({ type: "state", state: st });
    toast(`Session name set: ${name}`, "success");
  }

  async function handleBuiltin(message: string): Promise<boolean> {
    const parsed = parseBuiltin(message);
    if (!parsed) return false;
    const { name, args } = parsed;
    try {
      switch (name) {
        case "compact": {
          try {
            await rpc.compact(args || undefined);
          } catch {
            // error UI is handled via the compaction_end event
          }
          break;
        }
        case "autocompact": {
          const a = (args || "toggle").toLowerCase();
          let enabled: boolean;
          if (a === "on") enabled = true;
          else if (a === "off") enabled = false;
          else {
            const st = await rpc.getState();
            enabled = !st.autoCompactionEnabled;
          }
          await rpc.setAutoCompaction(enabled);
          toast(enabled ? "Auto-compaction enabled." : "Auto-compaction disabled.");
          break;
        }
        case "session": {
          const stats = await rpc.getSessionStatsFull();
          showInfoPanel("Session stats", formatSessionStats(stats));
          break;
        }
        case "name": {
          if (!args) {
            toast("Usage: /name <name>");
            break;
          }
          await applySessionName(args);
          break;
        }
        case "changelog": {
          const md = await readPiChangelog(piPath);
          if (md == null) {
            toast("Changelog not found (couldn't locate pi installation).", "error");
            break;
          }
          showInfoPanel("Pi changelog", md);
          break;
        }
        case "clear":
        case "new": {
          // Route through the guarded wrapper: the "+" button in the header used
          // to bypass it and stack a new empty transcript on every click.
          await newSession();
          break;
        }
        case "reload": {
          void reloadSession();
          break;
        }
      }
    } catch (e) {
      if (!sessionDisposed) {
        host.postMessage({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return true;
  }

  function refreshCommands(): void {
    void rpc
      .getCommands()
      .then((cmds) => {
        if (sessionDisposed) return;
        host.postMessage({ type: "commands", commands: mergeBuiltinCommands(cmds) });
      })
      .catch(() => {});
  }

  async function hydrate(): Promise<void> {
    try {
      if (opts.sessionFile && !switchedSession) {
        const st0 = await rpc.getState();
        if (st0.sessionFile !== opts.sessionFile) {
          await rpc.switchSession(opts.sessionFile);
        }
        switchedSession = true;
      }
      const [st, models, levels, cmds] = await Promise.all([
        rpc.getState(),
        rpc.getAvailableModels(),
        rpc.getAvailableThinkingLevels(),
        rpc.getCommands(),
      ]);
      sessionName = st.sessionName;
      host.postMessage({ type: "state", state: st });
      host.postMessage({
        type: "permissionMode",
        mode:
          vscode.workspace.getConfiguration("pi-agent-chat").get<string>("permission.mode") ??
          "AskForApproval",
      });
      host.postMessage({ type: "models", models });
      host.postMessage({ type: "enabledModels", keys: readEnabledModelKeys() });
      host.postMessage({ type: "thinkingLevels", levels });
      // MCP prompt commands are registered asynchronously after session_start;
      // refresh shortly to pick them up.
      setTimeout(refreshCommands, 3000);
      host.postMessage({ type: "commands", commands: mergeBuiltinCommands(cmds) });
      applySessionFile(st.sessionFile, st.sessionName);
      const messages = await rpc.getMessages();
      postMessages(messages);
      if (st.isStreaming) {
        streaming = true;
        host.updateTitle?.(true, sessionName);
        opts.onStreamingChange?.(true);
        host.postMessage({ type: "event", event: { type: "agent_start" } });
      }
      void sendContextUsage();
    } catch (e) {
      host.postMessage({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function handleExtUiRequest(req: ExtensionUiRequest): void {
    if (
      req.method === "select" ||
      req.method === "confirm" ||
      req.method === "input" ||
      req.method === "editor"
    ) {
      host.postMessage({ type: "dialog", request: req });
    } else if (req.method === "setWidget") {
      if (!sessionDisposed)
        host.postMessage({
          type: "widget",
          widgetKey: req.widgetKey,
          widgetLines: req.widgetLines,
        });
    } else if (req.method === "notify") {
      if (!sessionDisposed) {
        const message = String(req.message ?? "");
        if (message.startsWith(MCP_STATUS_MARKER)) {
          try {
            const servers = JSON.parse(message.slice(MCP_STATUS_MARKER.length));
            host.postMessage({ type: "mcpStatus", servers });
          } catch {
            // ignore malformed status payload
          }
          return;
        }
        const t = req.notifyType as string | undefined;
        const kind: "info" | "success" | "error" =
          t === "error" ? "error" : t === "success" ? "success" : "info";
        host.postMessage({ type: "toast", text: message, kind });
      }
    }
    // Other fire-and-forget methods (setStatus, setTitle, ...) are ignored.
  }

  async function reloadSession(): Promise<void> {
    if (streaming || sessionDisposed) return;
    if (!currentSessionFile) {
      toast("This session has not been saved yet.", "error");
      return;
    }
    try {
      await rpc.dispose();
      rpc = await bootRpc(currentSessionFile);
      await hydrate();
      toast("Session reloaded", "success");
    } catch (e) {
      if (!sessionDisposed) {
        host.postMessage({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  async function onMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case "webviewReady":
        // The webview (re)loaded its document; re-post full state so late
        // attaches never leave a blank UI (idempotent re-hydration).
        void hydrate();
        break;
      case "prompt":
        try {
          // The guide's first send: create the session it belongs to before the
          // builtin/prompt handling runs, so both land in the same place.
          if (pendingNewSession) {
            // The previous session is still generating: `newSession` here would
            // be skipped and the message would silently land in THAT session's
            // context. Refuse instead — pendingNewSession stays set, so a send
            // after the user stops/wait still creates the fresh session.
            if (streaming) {
              host.postMessage({
                type: "error",
                message: t(
                  "The previous session is still generating — stop it or wait before starting a new one.",
                ),
              });
              return;
            }
            pendingNewSession = false;
            await rpc.newSession();
            await refreshAfterSwitch();
          }
          if (await handleBuiltin(String(msg.message ?? ""))) break;
          await rpc.prompt(
            String(msg.message ?? ""),
            msg.streamingBehavior as "steer" | "followUp" | undefined,
            msg.images as RpcImage[] | undefined,
          );
        } catch (e) {
          host.postMessage({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      case "abort":
        try {
          await rpc.abort();
        } catch {
          // ignore
        }
        break;
      case "clearQueue":
        try {
          await rpc.clearQueue();
          host.postMessage({
            type: "event",
            event: { type: "queue_update", steering: [], followUp: [] },
          });
        } catch {
          // ignore
        }
        break;
      case "copy":
        try {
          await vscode.env.clipboard.writeText(String(msg.text ?? ""));
        } catch {
          // ignore
        }
        break;
      case "openFile": {
        try {
          let filePath = String(msg.filePath ?? "");
          if (!filePath) break;
          if (!isAbsolute(filePath)) {
            const base = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (base) filePath = resolve(base, filePath);
          }
          const uri = vscode.Uri.file(filePath);
          const document = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(document, {
            preview: true,
            preserveFocus: false,
          });
          const line = Number(msg.line);
          if (Number.isFinite(line) && line > 0) {
            const pos = new vscode.Position(line - 1, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          }
        } catch (e) {
          toast(e instanceof Error ? e.message : String(e), "error");
        }
        break;
      }
      case "setModel":
        try {
          await rpc.setModel(String(msg.provider ?? ""), String(msg.modelId ?? ""));
          const st = await rpc.getState();
          host.postMessage({ type: "state", state: st });
          const levels = await rpc.getAvailableThinkingLevels();
          host.postMessage({ type: "thinkingLevels", levels });
          void sendContextUsage();
        } catch (e) {
          host.postMessage({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      case "toggleFavorite": {
        try {
          const keys = toggleFavoriteModel(String(msg.provider ?? ""), String(msg.modelId ?? ""));
          for (const s of allSessions) {
            s.host.postMessage({ type: "enabledModels", keys });
          }
        } catch (e) {
          host.postMessage({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      }
      case "setThinking":
        try {
          await rpc.setThinkingLevel(String(msg.level ?? ""));
          const st = await rpc.getState();
          host.postMessage({ type: "state", state: st });
        } catch {
          // ignore
        }
        break;
      case "setSessionName":
        try {
          await applySessionName(String(msg.name ?? ""));
        } catch (e) {
          host.postMessage({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      case "pickResource": {
        try {
          const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: true,
            canSelectMany: true,
            defaultUri: cwd ? vscode.Uri.file(cwd) : undefined,
            openLabel: "Add",
            title: "Add file or folder to prompt",
          });
          const paths: string[] = [];
          if (uris) {
            for (const u of uris) {
              paths.push(cwd ? toDisplayPath(u.fsPath, cwd) : shortenHome(u.fsPath));
            }
          }
          if (!sessionDisposed) host.postMessage({ type: "pickedResources", paths });
        } catch {
          if (!sessionDisposed) host.postMessage({ type: "pickedResources", paths: [] });
        }
        break;
      }
      case "searchFiles": {
        const query: string = typeof msg.query === "string" ? msg.query : "";
        if (!cwd) {
          if (!sessionDisposed) host.postMessage({ type: "files", query, files: [] });
          break;
        }
        const q = query.trim();
        if (!q) {
          if (!sessionDisposed) host.postMessage({ type: "files", query, files: [] });
          break;
        }
        try {
          const excludePatterns = new Set<string>();
          for (const scope of ["files", "search"] as const) {
            const cfg = vscode.workspace
              .getConfiguration(scope)
              .get<Record<string, boolean>>("exclude");
            if (cfg) {
              for (const [glob, on] of Object.entries(cfg)) {
                if (on) excludePatterns.add(glob);
                else excludePatterns.delete(glob);
              }
            }
          }
          const exclude = excludePatterns.size ? `{${[...excludePatterns].join(",")}}` : undefined;
          const include = new vscode.RelativePattern(cwd, `**/*${escapeGlob(q)}*`);
          const uris = await vscode.workspace.findFiles(include, exclude, 80);
          const files = uris.map((u) => toDisplayPath(u.fsPath, cwd));
          if (!sessionDisposed) host.postMessage({ type: "files", query, files });
        } catch {
          if (!sessionDisposed) host.postMessage({ type: "files", query, files: [] });
        }
        break;
      }
      case "fork":
        try {
          if (streaming) {
            toast("Stop the agent before forking.", "error");
            break;
          }
          const entriesData = await rpc.getEntries();
          const entry = entriesData.entries.find(
            (e) =>
              e.type === "message" && e.message?.role === "user" && e.message?.timestamp === msg.ts,
          );
          if (!entry) {
            toast("Could not locate that message to fork from.", "error");
            break;
          }
          const forkResult = await rpc.fork(entry.id);
          if (forkResult.cancelled) {
            toast("Fork cancelled.");
            break;
          }
          const rSt = await rpc.getState();
          applySessionFile(rSt.sessionFile, rSt.sessionName);
          host.postMessage({ type: "state", state: rSt });
          const rMsgs = await rpc.getMessages();
          postMessages(rMsgs);
          void sendContextUsage();
          toast("Forked from selected message.", "success");
        } catch (e) {
          host.postMessage({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      case "revert":
        try {
          if (streaming) {
            toast("Stop the agent before reverting.", "error");
            break;
          }
          const revEntriesData = await rpc.getEntries();
          const revEntry = revEntriesData.entries.find(
            (e) =>
              e.type === "message" && e.message?.role === "user" && e.message?.timestamp === msg.ts,
          );
          if (!revEntry) {
            toast("Could not locate that message to revert to.", "error");
            break;
          }
          const revText = messageText(revEntry.message?.content);
          const beforeLeaf = revEntriesData.leafId;
          await rpc.prompt(`/pi-vscode-tree ${revEntry.id}`);
          const afterEntries = await rpc.getEntries();
          if (afterEntries.leafId === beforeLeaf) break;
          const revSt = await rpc.getState();
          applySessionFile(revSt.sessionFile, revSt.sessionName);
          host.postMessage({ type: "state", state: revSt });
          const revMsgs = await rpc.getMessages();
          postMessages(revMsgs);
          if (revText) host.postMessage({ type: "prefillInput", text: revText });
          void sendContextUsage();
          toast("Reverted to selected message.", "success");
        } catch (e) {
          host.postMessage({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      case "dialogResponse":
        rpc.respondExtensionUi(String(msg.id ?? ""), {
          value: msg.value as string | undefined,
          confirmed: msg.confirmed as boolean | undefined,
          cancelled: msg.cancelled as boolean | undefined,
        });
        break;
      case "requestHistory":
        void requestHistory();
        break;
      case "reload":
        void reloadSession();
        break;
      case "listSessions":
        // Fork change: feed the chat header's session-list popup with the sessions
        // recorded for this workspace, newest first.
        void postSessionsList();
        break;
      case "switchSession": {
        const file = String(msg.file ?? "");
        pendingNewSession = false;
        // Replay the cached snapshot first (if any): the splash comes down and
        // the session is on screen in one bridge hop, while the real switch +
        // get_messages run behind it and re-post the authoritative list.
        const cached = file ? messagesCache.get(file) : undefined;
        if (cached && !sessionDisposed) {
          host.postMessage({
            type: "messages",
            messages: cached.messages,
            historyAvailable: cached.historyAvailable,
          });
        }
        if (file && file !== currentSessionFile) void switchTo(file);
        break;
      }
      /**
       * The "+" button's marker: show the guide, create nothing. pi only gets a
       * session when the guide's first message is sent (`case "prompt"`), so
       * clicking "+" never writes an empty transcript to disk.
       */
      case "newSession":
        pendingNewSession = true;
        break;
      case "deleteSession": {
        // Fork change: delete one recorded session (its JSONL transcript).
        // The path comes from the webview, so the allowed set is re-derived from
        // `SessionManager.list` and only a listed path is deleted — never an `rm`
        // on a caller-supplied path. Deleting the OPEN session is allowed: any
        // run is aborted first and pi is moved onto another session BEFORE the
        // unlink, otherwise its next append would recreate the file.
        const file = String(msg.file ?? "");
        void (async () => {
          try {
            const list = cwd ? await SessionManager.list(cwd) : [];
            const listed = list.some(function (s) {
              return s.path === file;
            });
            if (!file || !listed) return;
            if (file === currentSessionFile) {
              if (streaming) await rpc.abort();
              const others = list
                .filter(function (s) {
                  return s.path !== file;
                })
                .sort(function (a, b) {
                  return (b.modified?.getTime() ?? 0) - (a.modified?.getTime() ?? 0);
                });
              pendingNewSession = false;
              if (others[0]) {
                await rpc.switchSession(others[0].path);
              } else {
                // Nothing left to move onto: pi needs a live session, so this
                // one case does write a fresh (empty) transcript.
                await rpc.newSession();
              }
              await refreshAfterSwitch();
            }
            await rm(file, { force: true });
            messagesCache.delete(file);
            toast(t("Session deleted."), "success");
            await postSessionsList();
          } catch (e) {
            toast(e instanceof Error ? e.message : String(e), "error");
          }
        })();
        break;
      }
      case "openSettings":
        void vscode.commands.executeCommand("pi-agent-chat.openSettings");
        break;
      case "openContextChip": {
        // Reveal the chip's file at its start line: `path` is workspace-
        // relative (addSelectionToChat stored it that way), so resolve against
        // the first workspace folder and fall back to an absolute file uri.
        const folder = vscode.workspace.workspaceFolders?.[0];
        const relPath = String(msg.path ?? "")
          .split("/")
          .join(sep);
        const uri = folder ? vscode.Uri.joinPath(folder.uri, relPath) : vscode.Uri.file(relPath);
        const line = Math.max(0, (Number(msg.line) || 1) - 1);
        void vscode.window
          .showTextDocument(uri, { selection: new vscode.Range(line, 0, line, 0), preview: true })
          .then(undefined, () => {});
        break;
      }
      case "setPermission":
        void rpc
          .prompt(`/permission ${String(msg.mode ?? "")}`, streaming ? "steer" : undefined)
          .catch(() => {});
        break;
      case "rewindAccept":
        if (streaming) {
          toast("Stop the agent before changing files.", "error");
          break;
        }
        void rpc.prompt("/rewind-accept", streaming ? "steer" : undefined).catch(() => {});
        break;
      case "rewindAcceptFile":
        if (streaming) {
          toast("Stop the agent before changing files.", "error");
          break;
        }
        void rpc
          .prompt(`/rewind-accept-file ${msg.id}`, streaming ? "steer" : undefined)
          .catch(() => {});
        break;
      case "rewindRevert":
        if (streaming) {
          toast("Stop the agent before reverting.", "error");
          break;
        }
        void rpc.prompt("/rewind-revert", streaming ? "steer" : undefined).catch(() => {});
        break;
      case "rewindRevertFile":
        if (streaming) {
          toast("Stop the agent before reverting.", "error");
          break;
        }
        void rpc
          .prompt(`/rewind-revert-file ${msg.id}`, streaming ? "steer" : undefined)
          .catch(() => {});
        break;
      case "rewindDiff":
        openRewindDiff(
          msg as unknown as {
            absPath: string;
            baselineHash: string | null;
            sessionId: string;
            basename: string;
          },
        );
        break;
    }
  }

  function attachHost(h: ChatHost): void {
    host = h;
    msgSub?.dispose();
    msgSub = h.onDidReceiveMessage(
      (m) => void onMessage(m as { type: string; [k: string]: unknown }),
    );
    void hydrate();
  }

  function sync(opts: ChatSessionUpdate): void {
    if (opts.rename !== undefined) sessionName = opts.rename;
    host.updateTitle?.(streaming, sessionName);
    void sendSessionInfo();
  }

  async function refreshAfterSwitch(): Promise<void> {
    const st = await rpc.getState();
    if (sessionDisposed) return;
    applySessionFile(st.sessionFile, st.sessionName);
    host.postMessage({ type: "state", state: st });
    const messages = await rpc.getMessages();
    if (sessionDisposed) return;
    postMessages(messages);
    void sendContextUsage();
  }

  async function switchTo(sessionFile: string): Promise<void> {
    pendingNewSession = false;
    if (streaming) {
      toast(t("Stop the agent before switching sessions."), "error");
      return;
    }
    try {
      await rpc.switchSession(sessionFile);
      await refreshAfterSwitch();
    } catch (e) {
      if (!sessionDisposed) {
        host.postMessage({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  /**
   * A session with no messages is already "new": creating another one is a
   * no-op for the user but still writes a fresh empty transcript to disk, so
   * refuse it. `messageCount` from the state is the cheap probe, with
   * `getMessages()` as the fallback for a host that omits it. A failed probe
   * must not block a legitimate reset.
   */
  async function sessionIsEmpty(): Promise<boolean> {
    try {
      const st = await rpc.getState();
      if (typeof st.messageCount === "number") return st.messageCount === 0;
      const messages = await rpc.getMessages();
      return messages.length === 0;
    } catch {
      return false;
    }
  }

  async function newSession(): Promise<void> {
    if (streaming) {
      toast(t("Stop the agent before starting a new session."), "error");
      return;
    }
    if (await sessionIsEmpty()) {
      toast(t("Already in a new session."), "info");
      return;
    }
    try {
      await rpc.newSession();
      await refreshAfterSwitch();
      toast(t("Started new session."), "success");
    } catch (e) {
      if (!sessionDisposed) {
        host.postMessage({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  function dispose(): void {
    if (sessionDisposed) return;
    sessionDisposed = true;
    allSessions.delete(session);
    void rpc.dispose();
  }

  let rpcGeneration = 0;

  async function bootRpc(sessionFileForSpawn: string | undefined): Promise<RpcClient> {
    if (!piPath) throw new Error("pi is not available");
    const gen = ++rpcGeneration;
    return createRpcClient({
      piPath,
      args: createRpcShellArgs({
        extensionUri: opts.extensionUri,
        sessionFile: sessionFileForSpawn,
      }),
      env: createRpcEnvironment(opts.bridgeConfig, opts.extensionUri),
      cwd,
      traceTag: opts.traceTag,
      handlers: {
        onEvent: (event) => {
          if (gen !== rpcGeneration || sessionDisposed) return;
          if (event.type === "agent_start") {
            updateStreamingState(true);
          } else if (event.type === "agent_settled") {
            updateStreamingState(false);
          }
          host.postMessage({ type: "event", event });
          if (event.type === "agent_settled") {
            if (needsSessionFile) {
              void rpc
                .getState()
                .then((s) => applySessionFile(s.sessionFile, s.sessionName))
                .catch(() => {});
            }
            refreshCommands();
            void sendContextUsage();
          } else if (event.type === "message_end") {
            void sendContextUsage();
          } else if (event.type === "compaction_end") {
            void refreshContextAfterCompaction(event);
          }
        },
        onExtensionUiRequest: (req) => {
          if (gen !== rpcGeneration || sessionDisposed) return;
          handleExtUiRequest(req);
        },
        onExit: (code) => {
          if (gen !== rpcGeneration || sessionDisposed) return;
          updateStreamingState(false);
          opts.onExit?.(code);
          sessionDisposed = true;
          allSessions.delete(session);
          host.postMessage({
            type: "error",
            message: "Pi process exited" + (code != null ? ` (code ${code})` : ""),
          });
        },
        onError: (err) => {
          if (gen !== rpcGeneration || sessionDisposed) return;
          host.postMessage({ type: "error", message: err.message });
        },
      },
    });
  }

  rpc = await bootRpc(opts.sessionFile);

  let session: ChatSession = {
    rpc,
    get host() {
      return host;
    },
    get sessionFile() {
      return currentSessionFile;
    },
    get streaming() {
      return streaming;
    },
    attach: attachHost,
    sync,
    switchTo,
    newSession,
    dispose,
  };
  allSessions.add(session);
  attachHost(opts.host);
  return session;
}
