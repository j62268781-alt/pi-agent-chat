// The transcript: a typed, reactive model of the conversation.
//
// The legacy webview treated the DOM as the source of truth — every block hung
// private state off its own element (`_piTs`, `_piModel`, `_tnode`, …) and
// "work block" grouping was done by moving already-rendered sibling nodes into
// a `<details>`. Here the data is the single source of truth and the grouping
// is derived, so streaming updates only ever touch plain objects.

import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import type { RpcEvent } from "@protocol/rpc";
import { countDiffChanges } from "@/lib/diff";
import { extractImages, extractText, isToolResultMessage } from "@/lib/message-parse";
import { createCacheTracker, type CacheMiss } from "@/lib/usage";
import { useSessionStore } from "./session";

let uid = 0;
const nextId = (prefix: string): string => `${prefix}-${++uid}`;

export type ToolStatus = "running" | "done" | "error";

export interface TextBlock {
  kind: "text";
  id: string;
  markdown: string;
  streaming: boolean;
  /** Long answers start collapsed behind an expand button. */
  collapsed: boolean;
}

export interface ThinkingBlock {
  kind: "thinking";
  id: string;
  text: string;
  running: boolean;
  open: boolean;
}

export interface SubagentInfo {
  title: string;
  failed: boolean;
  body: string;
}

export interface ToolBlock {
  kind: "tool";
  id: string;
  name: string;
  /** Raw JSON accumulated from `toolcall_delta`. */
  argsText: string;
  args: Record<string, unknown> | null;
  status: ToolStatus;
  startedAt: number | null;
  durationMs: number | null;
  /** Plain-text tool output, shown when there is no diff. */
  output: string;
  /** Unified-diff text for `edit`-style tools. */
  diffText: string;
  /** File body for `write`-style tools. */
  writeContent: string;
  added: number;
  removed: number;
  filePath: string | null;
  fileLine: number | null;
  subagent: SubagentInfo | null;
}

export type Block = TextBlock | ThinkingBlock | ToolBlock;

export interface UserMessage {
  kind: "user";
  id: string;
  timestamp: number | null;
  text: string;
  images: Array<{ type: "image"; data: string; mimeType: string }>;
}

export interface AssistantMessage {
  kind: "assistant";
  id: string;
  timestamp: number | null;
  model: string;
  /** Indexed by the RPC `contentIndex`, so deltas address a slot directly. */
  blocks: Block[];
  usage: unknown;
  stopReason: string | null;
  errorMessage: string | null;
}

export interface SystemMessage {
  kind: "system";
  id: string;
  variant: "compaction" | "error" | "retry";
  text: string;
  timestamp: number | null;
}

export type TranscriptMessage = UserMessage | AssistantMessage | SystemMessage;

/** One user request plus everything the agent did in response. */
export interface Turn {
  id: string;
  user: UserMessage | null;
  leading: SystemMessage[];
  /** Blocks folded into the collapsible work section. */
  workBlocks: Array<{ message: AssistantMessage; block: Block }>;
  /** Blocks rendered in the clear (the final answer). */
  finalBlocks: Array<{ message: AssistantMessage; block: Block }>;
  workTurns: number;
  workStartedAt: number | null;
  workEndedAt: number | null;
  added: number;
  removed: number;
  messageTime: number | null;
  stopReason: string | null;
  errorMessage: string | null;
}

function createTextBlock(): TextBlock {
  return { kind: "text", id: nextId("text"), markdown: "", streaming: true, collapsed: false };
}

function createThinkingBlock(): ThinkingBlock {
  return { kind: "thinking", id: nextId("think"), text: "", running: true, open: false };
}

function createToolBlock(): ToolBlock {
  return {
    kind: "tool",
    id: nextId("tool"),
    name: "",
    argsText: "",
    args: null,
    status: "running",
    startedAt: null,
    durationMs: null,
    output: "",
    diffText: "",
    writeContent: "",
    added: 0,
    removed: 0,
    filePath: null,
    fileLine: null,
    subagent: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseArgs(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      return asRecord(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return asRecord(raw);
}

export const useTranscriptStore = defineStore("transcript", () => {
  const session = useSessionStore();

  const messages = ref<TranscriptMessage[]>([]);
  const queue = ref<{ steering: string[]; followUp: string[] }>({ steering: [], followUp: [] });
  const historyAvailable = ref(false);
  const historyMessages = shallowRef<unknown[]>([]);
  const historyLoaded = ref(false);
  const historyLoading = ref(false);
  const retryAttempt = ref(0);
  const cacheMiss = ref<CacheMiss | null>(null);
  const statusText = ref("");

  /** Index into `messages` of the assistant message currently streaming. */
  const activeAssistantIndex = ref(-1);
  /**
   * toolCallId -> where the block lives. Positions rather than block
   * references: reading a block out of the reactive array is what makes
   * subsequent mutations reactive, so the index is the safe thing to cache.
   */
  const toolLocations = new Map<string, { messageIndex: number; blockIndex: number }>();
  const cache = createCacheTracker();

  const activeAssistant = computed<AssistantMessage | null>(() => {
    const index = activeAssistantIndex.value;
    if (index < 0) return null;
    const message = messages.value[index];
    return message && message.kind === "assistant" ? message : null;
  });

  const isEmpty = computed(() => messages.value.length === 0);

  /**
   * Sliding render window (Slack-style): the full history stays in memory while
   * only the tail `visibleCount` turns mount. Scrolling near the top grows the
   * window (`expandOlder`) with a scroll-position compensation, so opening a
   * 1000+ turn session renders ~50 turns instead of ~2362 message rows.
   */
  const INITIAL_VISIBLE_TURNS = 50;
  const visibleCount = ref(INITIAL_VISIBLE_TURNS);

  const hasMoreAbove = computed(() => visibleCount.value < turns.value.length);

  const visibleTurns = computed(() => turns.value.slice(-visibleCount.value));

  /** Unlock one more batch of older turns; capped by what exists. */
  function expandOlder(batch = 50): void {
    visibleCount.value = Math.min(visibleCount.value + batch, turns.value.length);
  }

  /** Group messages into turns and fold tool/thinking work behind a summary. */
  const turns = computed<Turn[]>(() => {
    const result: Turn[] = [];
    let current: Turn | null = null;

    const startTurn = (user: UserMessage | null): Turn => {
      const turn: Turn = {
        id: nextId("turn"),
        user,
        leading: [],
        workBlocks: [],
        finalBlocks: [],
        workTurns: 0,
        workStartedAt: null,
        workEndedAt: null,
        added: 0,
        removed: 0,
        messageTime: null,
        stopReason: null,
        errorMessage: null,
      };
      result.push(turn);
      return turn;
    };

    for (const message of messages.value) {
      if (message.kind === "user") {
        current = startTurn(message);
        continue;
      }
      if (!current) current = startTurn(null);
      if (message.kind === "system") {
        current.leading.push(message);
        continue;
      }

      const assistants = [message];
      for (const assistant of assistants) {
        if (assistant.blocks.length > 0) current.workTurns += 1;
      }
      current.messageTime = message.timestamp ?? current.messageTime;
      if (message.stopReason) current.stopReason = message.stopReason;
      if (message.errorMessage) current.errorMessage = message.errorMessage;
      for (const block of message.blocks) {
        if (block.kind === "tool") {
          current.added += block.added;
          current.removed += block.removed;
        }
      }

      const blocks = message.blocks.filter((block) => block.kind !== null);
      const last = blocks[blocks.length - 1];
      const isStreamingTail = message === activeAssistant.value;
      const foldable = !isStreamingTail && blocks.length > 0 && last?.kind === "text";

      for (const block of blocks) {
        // While streaming, or when the answer does not end in prose, nothing is
        // folded — the user should see the work as it happens.
        if (foldable && block !== last) current.workBlocks.push({ message, block });
        else if (foldable) current.finalBlocks.push({ message, block });
        else current.workBlocks.push({ message, block });
      }
      if (!foldable && blocks.length > 0) {
        current.workTurns = 0;
        current.finalBlocks.push(...current.workBlocks.splice(0));
      }
    }

    // Compute the work window per turn for the "Worked for …" summary.
    for (const turn of result) {
      const assistantTimestamps = turn.finalBlocks
        .concat(turn.workBlocks)
        .map((entry) => entry.message.timestamp)
        .filter((value): value is number => typeof value === "number");
      if (assistantTimestamps.length > 0) {
        turn.workStartedAt = turn.user?.timestamp ?? Math.min(...assistantTimestamps);
        turn.workEndedAt = Math.max(...assistantTimestamps);
      }
    }
    return result;
  });

  const hasWorkToFold = computed(() =>
    turns.value.some((turn) => turn.workBlocks.length > 0 && turn.finalBlocks.length > 0),
  );

  function reset(): void {
    messages.value = [];
    visibleCount.value = INITIAL_VISIBLE_TURNS;
    queue.value = { steering: [], followUp: [] };
    historyAvailable.value = false;
    historyMessages.value = [];
    historyLoaded.value = false;
    historyLoading.value = false;
    retryAttempt.value = 0;
    cacheMiss.value = null;
    activeAssistantIndex.value = -1;
    toolLocations.clear();
    cache.reset();
  }

  // ---------------------------------------------------------------- hydration

  /** Replace the transcript with a full history from the host. */
  /**
   * Put previously rendered messages back verbatim. Unlike `hydrate`, which maps
   * raw host messages, this takes already-internal messages — it is the
   * optimistic-switch rollback path, where the snapshot was taken from this very
   * store.
   */
  function restore(list: unknown[]): void {
    messages.value = list as TranscriptMessage[];
  }

  function hydrate(list: unknown[]): void {
    reset();
    if (!Array.isArray(list) || list.length === 0) {
      session.recomputeTotals([]);
      return;
    }
    for (const entry of list) appendHydrated(entry);
    session.recomputeTotals(list);
    // Seed the miss detector so a restored session does not report a false miss.
    cache.reset();
  }

  function appendHistory(list: unknown[]): void {
    historyMessages.value = Array.isArray(list) ? list : [];
    historyLoaded.value = true;
    historyLoading.value = false;
  }

  function appendHydrated(entry: unknown): void {
    const message = asRecord(entry);
    if (!message) return;
    const role = message.role;

    if (role === "user") {
      messages.value.push({
        kind: "user",
        id: nextId("user"),
        timestamp: typeof message.timestamp === "number" ? message.timestamp : null,
        text: extractText(message.content),
        images: extractImages(message.content),
      });
      return;
    }

    if (role === "assistant") {
      const assistant: AssistantMessage = {
        kind: "assistant",
        id: nextId("asst"),
        timestamp: typeof message.timestamp === "number" ? message.timestamp : null,
        model: typeof message.model === "string" ? message.model : "",
        blocks: [],
        usage: message.usage ?? null,
        stopReason: typeof message.stopReason === "string" ? message.stopReason : null,
        errorMessage: typeof message.errorMessage === "string" ? message.errorMessage : null,
      };
      const content = Array.isArray(message.content) ? message.content : [];
      for (const raw of content) {
        const block = asRecord(raw);
        if (!block) continue;
        if (block.type === "text") {
          assistant.blocks.push({
            kind: "text",
            id: nextId("text"),
            markdown: String(block.text ?? ""),
            streaming: false,
            collapsed: false,
          });
        } else if (block.type === "thinking") {
          assistant.blocks.push({
            kind: "thinking",
            id: nextId("think"),
            text: String(block.thinking ?? ""),
            running: false,
            open: false,
          });
        } else if (block.type === "toolCall") {
          pushHydratedTool(assistant, block);
        }
      }
      messages.value.push(assistant);
      if (assistant.usage)
        cache.record(assistant.usage, assistant.model, assistant.timestamp ?? undefined);
      return;
    }

    if (role === "toolResult") {
      applyToolResult(String(message.toolCallId ?? ""), message);
      return;
    }

    if (role === "compactionSummary") {
      messages.value.push({
        kind: "system",
        id: nextId("sys"),
        variant: "compaction",
        text: String(message.summary ?? ""),
        timestamp: typeof message.timestamp === "number" ? message.timestamp : null,
      });
    }
  }

  function pushHydratedTool(assistant: AssistantMessage, raw: Record<string, unknown>): void {
    const args = asRecord(raw.args) ?? parseArgs(raw.arguments);
    const block = createToolBlock();
    block.id = String(raw.id ?? raw.toolCallId ?? block.id);
    block.name = String(raw.name ?? "");
    block.args = args;
    block.argsText = args ? JSON.stringify(args) : "";
    block.status = "done";
    assistant.blocks.push(block);
    toolLocations.set(block.id, {
      messageIndex: messages.value.length,
      blockIndex: assistant.blocks.length - 1,
    });
  }

  // ------------------------------------------------------------- live updates

  function beginAssistant(timestamp: number | null): AssistantMessage {
    const assistant: AssistantMessage = {
      kind: "assistant",
      id: nextId("asst"),
      timestamp,
      model: "",
      blocks: [],
      usage: null,
      stopReason: null,
      errorMessage: null,
    };
    messages.value.push(assistant);
    activeAssistantIndex.value = messages.value.length - 1;
    return assistant;
  }

  /** Slot-create the block for a `contentIndex`, mirroring the RPC indexing. */
  function ensureBlock<T extends Block["kind"]>(kind: T): Extract<Block, { kind: T }> | null {
    const assistant = activeAssistant.value;
    if (!assistant) return null;
    return ensureBlockIn(assistant, kind, assistant.blocks.length);
  }

  function ensureBlockIn<T extends Block["kind"]>(
    assistant: AssistantMessage,
    kind: T,
    index: number,
  ): Extract<Block, { kind: T }> | null {
    const existing = assistant.blocks[index];
    if (existing && existing.kind === kind) return existing as Extract<Block, { kind: T }>;
    const created: Block =
      kind === "text"
        ? createTextBlock()
        : kind === "thinking"
          ? createThinkingBlock()
          : createToolBlock();
    assistant.blocks[index] = created;
    return created as Extract<Block, { kind: T }>;
  }

  function blockAt(index: number, kind: Block["kind"]): Block | null {
    const assistant = activeAssistant.value;
    if (!assistant) return null;
    const block = assistant.blocks[index];
    return block && block.kind === kind ? block : null;
  }

  function resolveToolLocation(toolCallId: string): ToolBlock | null {
    const location = toolLocations.get(toolCallId);
    if (!location) return null;
    const message = messages.value[location.messageIndex];
    if (!message || message.kind !== "assistant") return null;
    const block = message.blocks[location.blockIndex];
    return block && block.kind === "tool" ? block : null;
  }

  function applyAssistantDelta(event: Record<string, unknown>): void {
    const type = String(event.type ?? "");
    const contentIndex = typeof event.contentIndex === "number" ? event.contentIndex : 0;
    const delta = typeof event.delta === "string" ? event.delta : "";
    const assistant = activeAssistant.value;
    if (!assistant) return;

    switch (type) {
      case "text_start":
        collapseThinking();
        ensureBlockIn(assistant, "text", contentIndex);
        break;
      case "text_delta": {
        const block = ensureBlockIn(assistant, "text", contentIndex);
        if (block) block.markdown += delta;
        break;
      }
      case "thinking_start": {
        const block = ensureBlockIn(assistant, "thinking", contentIndex);
        if (block) block.running = true;
        break;
      }
      case "thinking_delta": {
        const block = ensureBlockIn(assistant, "thinking", contentIndex);
        if (block) {
          block.running = true;
          block.text += delta;
        }
        break;
      }
      case "toolcall_start": {
        collapseThinking();
        ensureBlockIn(assistant, "tool", contentIndex);
        break;
      }
      case "toolcall_delta": {
        const block = ensureBlockIn(assistant, "tool", contentIndex);
        if (block) block.argsText += delta;
        break;
      }
      case "toolcall_end": {
        const block = ensureBlockIn(assistant, "tool", contentIndex);
        if (!block) break;
        const call = asRecord(event.toolCall);
        if (call) {
          block.id = String(call.id ?? block.id);
          block.name = String(call.name ?? block.name);
          block.args = parseArgs(call.arguments) ?? parseArgs(call.args);
          if (block.args) block.argsText = JSON.stringify(block.args);
        }
        toolLocations.set(block.id, {
          messageIndex: activeAssistantIndex.value,
          blockIndex: contentIndex,
        });
        break;
      }
      default:
        break;
    }
  }

  /** Thinking folds itself away as soon as the answer begins. */
  function collapseThinking(): void {
    const assistant = activeAssistant.value;
    if (!assistant) return;
    for (const block of assistant.blocks) {
      if (block.kind === "thinking") block.running = false;
    }
  }

  function markTextFinalized(assistant: AssistantMessage): void {
    for (const block of assistant.blocks) {
      if (block.kind === "text") block.streaming = false;
    }
  }

  function startToolExecution(event: Record<string, unknown>): void {
    const assistant = activeAssistant.value;
    if (!assistant) return;
    const name = String(event.toolName ?? "");
    const args = asRecord(event.args);
    const callId = String(event.toolCallId ?? "");

    // The block normally already exists from `toolcall_start`; the execution
    // event is what fills in the real name/args.
    let block: ToolBlock | null = null;
    for (const candidate of assistant.blocks) {
      if (candidate.kind === "tool" && candidate.status === "running" && !candidate.name) {
        block = candidate;
        break;
      }
    }
    if (!block) {
      block = createToolBlock();
      assistant.blocks.push(block);
    }
    block.id = callId || block.id;
    block.name = name || block.name;
    block.args = args ?? block.args;
    if (args) block.argsText = JSON.stringify(args);
    block.status = "running";
    block.startedAt = Date.now();
    toolLocations.set(block.id, {
      messageIndex: activeAssistantIndex.value,
      blockIndex: assistant.blocks.indexOf(block),
    });
  }

  function updateToolExecution(event: Record<string, unknown>): void {
    const block = resolveToolLocation(String(event.toolCallId ?? ""));
    if (!block) return;
    const partial = extractToolOutput(event.partialResult);
    if (partial) block.output = partial;
  }

  function endToolExecution(event: Record<string, unknown>): void {
    const block = resolveToolLocation(String(event.toolCallId ?? ""));
    if (!block) return;
    block.status = event.isError ? "error" : "done";
    if (block.startedAt) block.durationMs = Date.now() - block.startedAt;
    applyToolResultToBlock(block, event.result);
  }

  /** Shared by live `tool_execution_end` and hydrated `toolResult` messages. */
  function applyToolResult(toolCallId: string, raw: Record<string, unknown>): void {
    const block = resolveToolLocation(toolCallId);
    if (!block) return;
    block.status = raw.isError ? "error" : "done";
    applyToolResultToBlock(block, raw);
  }

  function applyToolResultToBlock(block: ToolBlock, result: unknown): void {
    const record = asRecord(result);
    if (!record) return;
    const details = asRecord(record.details);
    const diff = typeof details?.diff === "string" ? details.diff : "";
    block.diffText = diff;
    if (diff) {
      const counts = countDiffChanges(diff);
      block.added = counts.added;
      block.removed = counts.removed;
    }
    if (typeof details?.content === "string") block.writeContent = details.content;
    if (typeof details?.filePath === "string") block.filePath = details.filePath;
    if (typeof details?.line === "number") block.fileLine = details.line;
    const output = extractToolOutput(record);
    if (output) block.output = output;
  }

  // ------------------------------------------------------------- event router

  function applyEvent(event: RpcEvent): void {
    const payload = event as Record<string, unknown>;
    switch (String(payload.type ?? "")) {
      case "agent_start":
        session.applyState({ isStreaming: true });
        break;
      case "agent_settled":
        session.applyState({ isStreaming: false });
        retryAttempt.value = 0;
        if (activeAssistant.value) markTextFinalized(activeAssistant.value);
        activeAssistantIndex.value = -1;
        break;
      case "message_start": {
        const message = asRecord(payload.message);
        if (!message) break;
        if (message.role === "assistant") {
          beginAssistant(typeof message.timestamp === "number" ? message.timestamp : null);
        } else if (message.role === "user") {
          const last = messages.value[messages.value.length - 1];
          if (last?.kind === "user" && last.timestamp === null) {
            last.timestamp = typeof message.timestamp === "number" ? message.timestamp : null;
          } else if (!isToolResultMessage(message)) {
            messages.value.push({
              kind: "user",
              id: nextId("user"),
              timestamp: typeof message.timestamp === "number" ? message.timestamp : null,
              text: extractText(message.content),
              images: extractImages(message.content),
            });
          }
        }
        break;
      }
      case "message_end": {
        const message = asRecord(payload.message);
        if (!message || message.role !== "assistant") break;
        const assistant = activeAssistant.value;
        if (assistant) {
          assistant.model = String(message.model ?? assistant.model);
          assistant.usage = message.usage ?? assistant.usage;
          assistant.stopReason = typeof message.stopReason === "string" ? message.stopReason : null;
          assistant.errorMessage =
            typeof message.errorMessage === "string" ? message.errorMessage : null;
          markTextFinalized(assistant);
          if (assistant.usage) {
            if (cache.record(assistant.usage, assistant.model, assistant.timestamp ?? undefined)) {
              cacheMiss.value = cache.lastMiss;
            }
          }
        }
        activeAssistantIndex.value = -1;
        session.recomputeTotals(messages.value);
        break;
      }
      case "message_update": {
        const inner = asRecord(payload.assistantMessageEvent);
        if (inner) applyAssistantDelta(inner);
        break;
      }
      case "tool_execution_start":
        startToolExecution(payload);
        break;
      case "tool_execution_update":
        updateToolExecution(payload);
        break;
      case "tool_execution_end":
        endToolExecution(payload);
        break;
      case "compaction_start":
        session.applyState({ isCompacting: true });
        statusText.value = "compacting";
        messages.value.push({
          kind: "system",
          id: nextId("sys"),
          variant: "compaction",
          text: "",
          timestamp: null,
        });
        break;
      case "compaction_end":
        session.applyState({ isCompacting: false });
        statusText.value = "";
        if (payload.aborted || payload.errorMessage) {
          const last = messages.value[messages.value.length - 1];
          if (last?.kind === "system" && last.variant === "compaction" && !last.text) {
            messages.value.pop();
          }
        }
        break;
      case "auto_retry_start":
        retryAttempt.value = typeof payload.attempt === "number" ? payload.attempt : 0;
        break;
      case "auto_retry_end":
        if (payload.success === false) {
          messages.value.push({
            kind: "system",
            id: nextId("sys"),
            variant: "retry",
            text: String(payload.finalError ?? ""),
            timestamp: null,
          });
        }
        retryAttempt.value = 0;
        break;
      case "queue_update":
        queue.value = {
          steering: Array.isArray(payload.steering) ? (payload.steering as string[]) : [],
          followUp: Array.isArray(payload.followUp) ? (payload.followUp as string[]) : [],
        };
        break;
      default:
        break;
    }
  }

  function dismissCacheMiss(): void {
    cacheMiss.value = null;
  }

  return {
    messages,
    restore,
    queue,
    historyAvailable,
    historyMessages,
    historyLoaded,
    historyLoading,
    retryAttempt,
    cacheMiss,
    statusText,
    activeAssistant,
    isEmpty,
    turns,
    visibleTurns,
    hasMoreAbove,
    expandOlder,
    hasWorkToFold,
    reset,
    hydrate,
    appendHistory,
    appendHydrated,
    beginAssistant,
    ensureBlock,
    blockAt,
    resolveToolLocation,
    applyAssistantDelta,
    collapseThinking,
    startToolExecution,
    updateToolExecution,
    endToolExecution,
    applyToolResult,
    applyEvent,
    dismissCacheMiss,
  };
});

/** Tool output as plain text: joined text content blocks. */
function extractToolOutput(result: unknown): string {
  const record = asRecord(result);
  if (!record) return "";
  const content = record.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    const block = asRecord(item);
    if (!block) {
      if (typeof item === "string") parts.push(item);
      continue;
    }
    if (typeof block.text === "string") parts.push(block.text);
    else if (typeof block.content === "string") parts.push(block.content);
  }
  return parts.join("\n");
}
