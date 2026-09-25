import { access } from "node:fs/promises";
import * as vscode from "vscode";

const SESSIONS_KEY = "pi-agent-chat.chatSessions";
const REOPEN_KEY = "pi-agent-chat.reopenAfterFolder";
const LAST_MODEL_KEY = "pi-agent-chat.lastPickedModel";

/** How long an unclaimed "come back" request stays good. A folder pick either
 *  reloads the window within seconds or was cancelled, so a marker from an
 *  earlier session must not open a chat out of nowhere. */
const REOPEN_TTL_MS = 2 * 60_000;

type ChatSessionMap = Record<string, string>;

/** A model the user picked by hand, with the thinking level that was in force. */
export interface LastModel {
  provider: string;
  modelId: string;
  thinkingLevel?: string;
}

/**
 * What the panel remembers about the user's own choices.
 *
 * pi hands every replacement session its configured default model, so a new
 * session would otherwise drop a model the user picked for the one before it
 * (彬哥: 我在 turing 上，点 + 发第一条就变回 solar 了). The choice is the user's,
 * not the workspace's project data — but it belongs to *this* workspace's habit,
 * which is why it lives in `workspaceState` next to the tracked panels.
 */
export interface ChatPreferences {
  readLastModel(): LastModel | undefined;
  writeLastModel(value: LastModel): void;
}

export interface ChatTracker extends ChatPreferences {
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
    readLastModel() {
      const value = context.workspaceState.get<LastModel>(LAST_MODEL_KEY);
      // Written by an older build, or half-written: the model has to be
      // complete for pi to accept it, and anything else is the same as "none".
      if (!value || typeof value.provider !== "string" || typeof value.modelId !== "string") {
        return undefined;
      }
      return value;
    },
    writeLastModel(value) {
      void context.workspaceState.update(LAST_MODEL_KEY, value);
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
