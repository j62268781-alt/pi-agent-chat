// The postMessage contract between the extension host and the Vue webviews.
//
// This file is the single source of truth for that boundary. It is imported by
// `src/**` (extension host) and by `webview-vue/src/**` (via the `@protocol`
// alias), so both sides fail to compile the moment they disagree.
//
// Message flow
//   webview -> host : WebviewToExt   (`vscode.postMessage`)
//   host -> webview : ExtToWebview   (`webview.postMessage`)
//   pi    -> host   : RpcEvent       (JSONL on the `pi --mode rpc` subprocess)
//   host  -> webview: RpcEvent, wrapped as { type: "event", event }

import type {
  ExtensionUiRequest,
  RpcCommand,
  RpcContextUsage,
  RpcEvent,
  RpcModel,
  RpcState,
} from "./rpc.ts";

export type { RpcEvent } from "./rpc.ts";

/** Prompt delivery mode while the agent is already streaming. */
export type StreamingBehavior = "steer" | "followUp";

/** Permission gate mode, mirrored from the `permission.mode` setting. */
export type PermissionMode = "AskForApproval" | "FullAccess";

/** Toast severity. */
export type ToastKind = "info" | "success" | "error";

/** One entry in the chat header's session-switcher popup. */
export interface SessionListItem {
  /** Absolute path to the session JSONL file; also the switch target. */
  file: string;
  name: string;
  firstMessage: string;
  /** ISO-8601 timestamp. */
  modified: string;
  messageCount: number;
}

/** A resource the user picked through the host's file dialog. */
export interface PickedResource {
  paths: string[];
}

/**
 * Live display preferences, mirrored one-to-one from the `pi-agent-chat.chat*`
 * settings plus `language`.
 *
 * Injected into the HTML at creation time and re-pushed as a whole object on
 * every configuration change, so the webview never has to re-derive them and
 * never needs a webview reload to pick them up.
 */
export interface ChatDisplaySettings {
  /** Transcript font size in px (`chatFontSize`). */
  fontSize: number;
  /**
   * Where the chat is docked (`pi-agent-chat.ui`). A side bar and an editor tab
   * are painted a shade apart, so the webview cannot assume either one.
   */
  surface: "sidebar" | "editor";
  /** Resolved background image as a data URL, or `""` (`chatBackgroundImage`). */
  backgroundImage: string;
  /** Background image opacity, 0..1 (`chatBackgroundOpacity`). */
  backgroundOpacity: number;
  /** Send key (`chatSendShortcut`). */
  sendShortcut: "enter" | "ctrlEnter";
  /** What a new message does while the agent is streaming (`chatRunningSendBehavior`). */
  runningSendBehavior: "queue" | "steer";
  /** Fold the reasoning/tool work of a finished turn (`chatCollapseWork`). */
  collapseWork: boolean;
  /** Tool cards start expanded (`chatExpandToolCalls`). */
  expandToolCalls: boolean;
  /** Thinking blocks start expanded (`chatExpandThinking`). */
  expandThinking: boolean;
  /** Pin a new turn to the top of the viewport instead of the bottom (`chatKeepReadingAnchor`). */
  keepReadingAnchor: boolean;
  /** Ring the panel's own chime when a run settles (`chatCompletionSound`). */
  completionSound: boolean;
}

// ---------------------------------------------------------------------------
// webview -> extension
// ---------------------------------------------------------------------------

export type WebviewToExt =
  /** Sent once the Vue app has mounted; triggers the host's hydration burst. */
  | { type: "webviewReady" }
  /** Boot failed in the sidebar: ask the host to spawn the session now. */
  | { type: "startSession" }
  | {
      type: "prompt";
      message: string;
      images?: Array<{ type: "image"; data: string; mimeType: string }>;
      streamingBehavior?: StreamingBehavior;
      /**
       * Set when the prompt came out of the webview's pending queue. pi can
       * refuse a prompt outright; the id is what lets that refusal be routed
       * back to the row it came from so the message is not lost.
       */
      ackId?: string;
    }
  | { type: "abort" }
  | { type: "copy"; text: string }
  | { type: "openFile"; filePath: string; line: number | null }
  | { type: "setModel"; provider: string; modelId: string }
  | { type: "toggleFavorite"; provider: string; modelId: string }
  | { type: "setThinking"; level: string }
  | { type: "setPermission"; mode: PermissionMode }
  /**
   * Flip `chatRunningSendBehavior` from the composer's own control. The write
   * goes to the global config, so the follow-up `displaySettings` push (and any
   * other window) sees the same value.
   */
  | { type: "setRunningSendBehavior"; value: "queue" | "steer" }
  | { type: "setSessionName"; name: string }
  | { type: "pickResource" }
  | { type: "searchFiles"; query: string }
  | { type: "fork"; ts: number }
  | {
      type: "dialogResponse";
      id: string;
      value?: string;
      confirmed?: boolean;
      cancelled?: boolean;
    }
  | { type: "requestHistory" }
  | { type: "reload" }
  | { type: "listSessions" }
  | { type: "switchSession"; file: string }
  /** Remove one recorded session (its JSONL transcript) from disk. */
  | { type: "deleteSession"; file: string }
  | { type: "newSession" }
  | { type: "openSettings" }
  | { type: "openContextChip"; path: string; line: number }
  | { type: "rewindAccept" }
  | { type: "rewindAcceptFile"; id: number }
  | { type: "rewindRevert" }
  | { type: "rewindRevertFile"; id: number }
  | {
      type: "rewindDiff";
      absPath: string;
      baselineHash: string | null;
      sessionId: string;
      basename: string;
    };

/** A code-context chip in the composer: a pointer to `path:L12-45`. The
 * composer renders only the tag (never the code) and clicking it reveals the
 * location in VS Code; the prompt text carries the same `[path:L]` tag line so
 * the model reads that range with its read tool. */
export interface ContextChip {
  id: string;
  /** Workspace-relative path (resolvable by the host for reveal). */
  path: string;
  startLine: number;
  endLine: number;
}

// ---------------------------------------------------------------------------
// extension -> webview
// ---------------------------------------------------------------------------

export type ExtToWebview =
  | { type: "ready" }
  | { type: "state"; state: RpcState }
  | { type: "sessionInfo"; label: string; sessionFile: string | null }
  | { type: "sessionFailed"; message: string }
  | { type: "models"; models: RpcModel[] }
  | { type: "enabledModels"; keys: string[] }
  | { type: "thinkingLevels"; levels: string[] }
  | { type: "permissionMode"; mode: PermissionMode }
  | { type: "sessionsList"; sessions: SessionListItem[]; currentFile: string | null }
  | { type: "commands"; commands: RpcCommand[] }
  | { type: "displaySettings"; value: ChatDisplaySettings }
  | { type: "messages"; messages: unknown[]; historyAvailable?: boolean }
  | { type: "history"; messages: unknown[] }
  | { type: "event"; event: RpcEvent }
  | { type: "dialog"; request: ExtensionUiRequest }
  | { type: "pickedResources"; paths: string[] }
  | { type: "contextUsage"; usage: RpcContextUsage | null; cost?: number }
  | { type: "widget"; widgetKey?: string; widgetLines?: string[] }
  | { type: "toast"; text: string; kind?: ToastKind }
  | { type: "infoPanel"; title: string; markdown: string }
  | { type: "error"; message: string }
  /**
   * A queued prompt pi refused. Carries the `ackId` back so the webview can put
   * the message where it came from; the generic `error` channel cannot do that,
   * and answers with "the session stopped", which it usually has not.
   */
  | { type: "promptRejected"; ackId: string; message: string }
  | { type: "prefillInput"; text: string }
  | { type: "appendInput"; text: string }
  | { type: "addContextChips"; chips: ContextChip[] }
  | { type: "files"; query: string; files: string[] };

/** Narrowing helper so both sides can `switch` on a discriminated union. */
export type MessageOf<T extends { type: string }, K extends T["type"]> = Extract<T, { type: K }>;

// ---------------------------------------------------------------------------
// pi RPC streaming events
//
// `RpcEvent` is an open `{type: string}` record because the pi CLI owns it and
// grows it independently. These are the ones the UI reacts to; keep them in
// sync with `webview-vue/src/stores/messages.ts`.
// ---------------------------------------------------------------------------

export const AGENT_EVENT_TYPES = [
  "agent_start",
  "agent_settled",
  "message_start",
  "message_end",
  "message_update",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "queue_update",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

/** Nested `assistantMessageEvent.type` values carried by `message_update`. */
export const ASSISTANT_DELTA_TYPES = [
  "text_start",
  "text_delta",
  "thinking_start",
  "thinking_delta",
  "toolcall_start",
  "toolcall_delta",
  "toolcall_end",
] as const;

export type AssistantDeltaType = (typeof ASSISTANT_DELTA_TYPES)[number];
