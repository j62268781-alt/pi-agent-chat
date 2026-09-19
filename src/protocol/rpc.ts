// Wire types for the `pi --mode rpc` subprocess (a subset of pi's rpc.md).
//
// The webview <-> extension postMessage contract lives in `messages.ts` and
// builds on these types.

export interface RpcModel {
  id: string;
  name?: string;
  provider: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: Record<string, unknown>;
}

export interface RpcContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface RpcSessionStats {
  sessionFile?: string;
  sessionId?: string;
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  toolResults?: number;
  totalMessages?: number;
  tokens?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  cost?: number;
  contextUsage?: RpcContextUsage | null;
}

export interface RpcSessionEntry {
  type: string;
  id: string;
  parentId?: string | null;
  timestamp?: string | number;
  message?: { role?: string; timestamp?: number; content?: unknown } & Record<string, unknown>;
  summary?: string;
  tokensBefore?: number;
  firstKeptEntryId?: string;
  fromId?: string;
}

export interface RpcEntriesData {
  entries: RpcSessionEntry[];
  leafId: string | null;
}

export interface RpcCompactionResult {
  summary?: string;
  tokensBefore?: number;
}

export interface RpcState {
  model: RpcModel | null;
  thinkingLevel: string;
  isStreaming: boolean;
  isCompacting?: boolean;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  messageCount?: number;
  pendingMessageCount?: number;
  autoCompactionEnabled?: boolean;
}

export interface RpcCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill" | "builtin";
  location?: string;
  path?: string;
}

export interface RpcResponse {
  id?: string | number;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Image content block for `prompt`/`steer`/`follow_up` commands. */
export interface RpcImage {
  type: "image";
  data: string;
  mimeType: string;
}

/**
 * When a delivery mode's queued entries are released: `"all"` at once,
 * `"one-at-a-time"` — the head only, the rest once the agent comes back.
 */
export type RpcQueueMode = "all" | "one-at-a-time";

/** Typed client over a `pi --mode rpc` subprocess. */
export interface RpcClient {
  send(command: Record<string, unknown>): void;
  request<T = unknown>(command: Record<string, unknown>): Promise<T>;
  prompt(
    message: string,
    streamingBehavior?: "steer" | "followUp",
    images?: RpcImage[],
  ): Promise<void>;
  /**
   * Bare `steer` / `follow_up` commands. The composer deliberately sends
   * through `prompt` + `streamingBehavior` instead — pi rejects its own
   * extension commands (`/…`) on these two, and the input box accepts them.
   */
  steer(message: string, images?: RpcImage[]): Promise<void>;
  followUp(message: string, images?: RpcImage[]): Promise<void>;
  abort(): Promise<void>;
  clearQueue(): Promise<{ steering: string[]; followUp: string[] }>;
  setSteeringMode(mode: RpcQueueMode): Promise<void>;
  setFollowUpMode(mode: RpcQueueMode): Promise<void>;
  setModel(provider: string, modelId: string): Promise<RpcModel>;
  setThinkingLevel(level: string): Promise<void>;
  getAvailableModels(): Promise<RpcModel[]>;
  getAvailableThinkingLevels(): Promise<string[]>;
  getCommands(): Promise<RpcCommand[]>;
  getMessages(): Promise<unknown[]>;
  getState(): Promise<RpcState>;
  getSessionStats(): Promise<RpcContextUsage | null>;
  getSessionStatsFull(): Promise<RpcSessionStats>;
  compact(customInstructions?: string): Promise<RpcCompactionResult>;
  setAutoCompaction(enabled: boolean): Promise<void>;
  setSessionName(name: string): Promise<void>;
  newSession(): Promise<{ cancelled: boolean }>;
  switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
  getEntries(): Promise<RpcEntriesData>;
  fork(entryId: string): Promise<{ text: string; cancelled: boolean }>;
  /**
   * The tail of the subprocess's stderr. pi reports a broken extension there and
   * then exits without answering a single command, so this is the only record of
   * why a session never started.
   */
  lastStderr(): string;
  respondExtensionUi(
    id: string,
    payload: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): void;
  dispose(): Promise<void>;
}

export type RpcEvent = { type: string } & Record<string, unknown>;

export interface ExtensionUiRequest {
  type: "extension_ui_request";
  id: string;
  method:
    | "select"
    | "confirm"
    | "input"
    | "editor"
    | "notify"
    | "setStatus"
    | "setWidget"
    | "setTitle"
    | "set_editor_text";
  [k: string]: unknown;
}
