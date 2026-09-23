import { access } from "node:fs/promises";
import * as vscode from "vscode";

const SESSIONS_KEY = "pi-agent-chat.chatSessions";
const REOPEN_KEY = "pi-agent-chat.reopenAfterFolder";

/** How long an unclaimed "come back" request stays good. A folder pick either
 *  reloads the window within seconds or was cancelled, so a marker from an
 *  earlier session must not open a chat out of nowhere. */
const REOPEN_TTL_MS = 2 * 60_000;

type ChatSessionMap = Record<string, string>;

export interface ChatTracker {
  update(panelId: string, sessionFile: string): void;
  removePanel(panelId: string): void;
  restore(openFn: (sessionFile: string, panelId: string) => Promise<void>): Promise<void>;
  /**
   * Record that the chat is expected back once the window has a folder.
   *
   * "Open Folder…" reloads the window onto another workspace, and the tracked
   * panels live in `workspaceState` — which belongs to the workspace, so the one
   * the chat was asked from is exactly the one that no longer applies. This goes
   * to `globalState` for that reason.
   */
  markReopenAfterFolder(): void;
  /** True at most once, and only right after a folder pick. */
  consumeReopenAfterFolder(): boolean;
}

export function createChatTracker(context: vscode.ExtensionContext): ChatTracker {
  const read = () => context.workspaceState.get<ChatSessionMap>(SESSIONS_KEY) ?? {};
  const write = (map: ChatSessionMap) => context.workspaceState.update(SESSIONS_KEY, map);

  return {
    update(panelId, sessionFile) {
      const map = read();
      if (map[panelId] === sessionFile) return;
      map[panelId] = sessionFile;
      void write(map);
    },
    removePanel(panelId) {
      const map = read();
      if (!(panelId in map)) return;
      delete map[panelId];
      void write(map);
    },
    markReopenAfterFolder() {
      void context.globalState.update(REOPEN_KEY, Date.now());
    },
    consumeReopenAfterFolder() {
      const markedAt = context.globalState.get<number>(REOPEN_KEY);
      if (typeof markedAt !== "number") return false;
      void context.globalState.update(REOPEN_KEY, undefined);
      return Date.now() - markedAt < REOPEN_TTL_MS;
    },
    async restore(openFn) {
      const map = read();
      const entries = Object.entries(map);
      const checks = await Promise.all(
        entries.map(async ([panelId, sessionFile]) => {
          try {
            await access(sessionFile);
            return [panelId, sessionFile] as const;
          } catch {
            return null;
          }
        }),
      );
      const valid = Object.fromEntries(
        checks.filter((e): e is readonly [string, string] => e !== null),
      );
      if (Object.keys(valid).length !== Object.keys(map).length) {
        await write(valid);
      }
      await Promise.all(
        Object.entries(valid).map(async ([panelId, sessionFile]) => {
          try {
            await openFn(sessionFile, panelId);
          } catch (err) {
            console.error("[pi-agent-chat] Failed to restore chat session", sessionFile, err);
          }
        }),
      );
    },
  };
}
