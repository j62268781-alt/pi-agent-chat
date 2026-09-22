// Regression cover for the turn-state judgement reworked in 024736b.
//
// Both bugs came from the same blind spot: a turn that uses tools is *several*
// assistant messages, and the store keeps folding the ones that are still
// arriving. These feed a real-shaped `pi --mode rpc` event stream and stop at
// points where the two answers disagree.

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { RpcEvent } from "@protocol/rpc";
import { useSessionStore } from "@/stores/session.ts";
import { useTranscriptStore, type Turn } from "@/stores/transcript.ts";

const T0 = 1_700_000_000_000;
const USAGE = { input: 120, output: 24 };

/** The running test `TurnBlock` used before 024736b. */
const legacyRunning = (turn: Turn, streaming: boolean): boolean =>
  streaming && turn.stopReason == null;

/** The running test it uses now. */
const currentRunning = (isLast: boolean, streaming: boolean): boolean => isLast && streaming;

describe("transcript — a tool-using turn while it is still running", () => {
  let transcript: ReturnType<typeof useTranscriptStore>;
  let session: ReturnType<typeof useSessionStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    transcript = useTranscriptStore();
    session = useSessionStore();
  });

  const send = (event: RpcEvent) => transcript.applyEvent(event);

  const userTurn = () => {
    send({ type: "agent_start" });
    send({
      type: "message_start",
      message: {
        role: "user",
        timestamp: T0,
        content: [{ type: "text", text: "把标题改短一点" }],
      },
    });
  };

  /** One assistant message that thinks (optionally) and then emits tool calls. */
  const assistantToolMessage = (
    timestamp: number,
    toolCall: { id: string; name: string; arguments: Record<string, unknown> },
    withThinking = false,
  ) => {
    send({ type: "message_start", message: { role: "assistant", timestamp } });
    if (withThinking) {
      send({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
      });
      send({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "先看一眼文件" },
      });
      send({
        type: "message_update",
        assistantMessageEvent: { type: "toolcall_start", contentIndex: 1 },
      });
      send({
        type: "message_update",
        assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall },
      });
    } else {
      send({
        type: "message_update",
        assistantMessageEvent: { type: "toolcall_start", contentIndex: 0 },
      });
      send({
        type: "message_update",
        assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall },
      });
    }
    send({
      type: "message_end",
      message: { role: "assistant", model: "test-model", usage: USAGE, stopReason: "tool_use" },
    });
    send({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });
    send({
      type: "tool_execution_end",
      toolCallId: toolCall.id,
      isError: false,
      result: { content: [{ type: "text", text: "done" }], details: {} },
    });
  };

  /** The last assistant message, streamed up to — but not past — its answer. */
  const startAnswerMessage = (timestamp: number) => {
    send({ type: "message_start", message: { role: "assistant", timestamp } });
    send({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
    });
    send({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "想怎么收口" },
    });
    send({
      type: "message_update",
      assistantMessageEvent: { type: "text_start", contentIndex: 1 },
    });
    send({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "改好了，" },
    });
  };

  const lastTurn = (): Turn => {
    const turn = transcript.turns.at(-1);
    if (!turn) throw new Error("the fixture produced no turn");
    return turn;
  };

  it("stops guessing the running turn from stopReason", () => {
    userTurn();
    assistantToolMessage(
      T0 + 1_000,
      { id: "tc1", name: "edit", arguments: { path: "a.md" } },
      true,
    );

    const turn = lastTurn();
    // The turn is mid-flight — pi is still on it — yet `message_end` has already
    // written a stop reason for the first assistant message of the turn.
    expect(session.isStreaming).toBe(true);
    expect(turn.stopReason).toBe("tool_use");

    expect(legacyRunning(turn, session.isStreaming)).toBe(false); // → 已处理，而它还在跑
    expect(currentRunning(true, session.isStreaming)).toBe(true);
  });

  it("builds the work fold while the trailing message is still streaming", () => {
    userTurn();
    assistantToolMessage(
      T0 + 1_000,
      { id: "tc1", name: "edit", arguments: { path: "a.md" } },
      true,
    );
    assistantToolMessage(T0 + 2_000, {
      id: "tc2",
      name: "bash",
      arguments: { command: "pnpm build" },
    });
    startAnswerMessage(T0 + 3_000);

    expect(transcript.activeAssistant).not.toBeNull(); // 最后一条消息仍在流式中
    const turn = lastTurn();
    // The streaming rule used to relax the fold for the message being generated,
    // which emptied `workBlocks` and left the turn with no head to watch.
    expect(turn.workBlocks.map((entry) => entry.block.kind)).toEqual([
      "thinking",
      "tool",
      "tool",
      "thinking",
    ]);
    expect(turn.finalBlocks.map((entry) => entry.block.kind)).toEqual(["text"]);
  });

  it("keeps consecutive tool calls adjacent so they group into one step", () => {
    userTurn();
    assistantToolMessage(
      T0 + 1_000,
      { id: "tc1", name: "edit", arguments: { path: "a.md" } },
      true,
    );
    assistantToolMessage(T0 + 2_000, {
      id: "tc2",
      name: "bash",
      arguments: { command: "pnpm build" },
    });
    startAnswerMessage(T0 + 3_000);

    const kinds = lastTurn().workBlocks.map((entry) => entry.block.kind);
    // `TurnBlock.segments` only folds a *run* of tool calls into 执行工具 N 次.
    expect(kinds.slice(1, 3)).toEqual(["tool", "tool"]);
  });

  it("settles the turn without dropping the folded work", () => {
    userTurn();
    assistantToolMessage(
      T0 + 1_000,
      { id: "tc1", name: "edit", arguments: { path: "a.md" } },
      true,
    );
    assistantToolMessage(T0 + 2_000, {
      id: "tc2",
      name: "bash",
      arguments: { command: "pnpm build" },
    });
    startAnswerMessage(T0 + 3_000);

    send({
      type: "message_end",
      message: { role: "assistant", model: "test-model", usage: USAGE, stopReason: "stop" },
    });
    send({ type: "agent_settled" });

    const turn = lastTurn();
    expect(session.isStreaming).toBe(false);
    expect(currentRunning(true, session.isStreaming)).toBe(false); // 折叠头收拢为「已处理」
    expect(transcript.activeAssistant).toBeNull();
    expect(turn.workBlocks).toHaveLength(4);
    expect(turn.finalBlocks.map((entry) => entry.block.kind)).toEqual(["text"]);
    const answer = turn.finalBlocks[0]?.block;
    expect(answer && answer.kind === "text" ? answer.markdown : "").toContain("改好了");
  });

  it("does not fold a turn that never streamed anything", () => {
    userTurn();
    send({ type: "message_start", message: { role: "assistant", timestamp: T0 + 1_000 } });
    send({
      type: "message_update",
      assistantMessageEvent: { type: "text_start", contentIndex: 0 },
    });
    send({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "直接回答" },
    });
    send({
      type: "message_end",
      message: { role: "assistant", model: "test-model", usage: USAGE, stopReason: "stop" },
    });
    send({ type: "agent_settled" });

    const turn = lastTurn();
    expect(turn.workBlocks).toHaveLength(0);
    expect(turn.finalBlocks).toHaveLength(1);
  });
});

// pi retries a retryable error with exponential backoff and, when it runs out,
// emits `auto_retry_end{success:false}`. Both numbers the UI shows come off
// those events — the banner's count was hardcoded to 0 and the toolbar's
// ceiling to 3, so both lied whenever `retry.maxRetries` was not the default.
describe("transcript — pi's retry counter", () => {
  let transcript: ReturnType<typeof useTranscriptStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    transcript = useTranscriptStore();
  });

  const send = (event: RpcEvent) => transcript.applyEvent(event);

  it("carries the run's ceiling while it retries, and the count on the banner", () => {
    send({ type: "auto_retry_start", attempt: 2, maxAttempts: 5, delayMs: 4_000 });
    expect(transcript.retryAttempt).toBe(2);
    expect(transcript.retryMax).toBe(5);

    send({ type: "auto_retry_end", success: false, attempt: 2, finalError: "gateway down" });

    const row = transcript.messages.at(-1);
    if (row?.kind !== "system") throw new Error("expected pi's retry row");
    expect(row.variant).toBe("retry");
    expect(row.attempt).toBe(2);
    expect(row.text).toBe("gateway down");
    expect(transcript.retryAttempt).toBe(0);
    expect(transcript.retryMax).toBe(0);
  });

  it("leaves no row behind when the retry succeeds", () => {
    send({ type: "auto_retry_start", attempt: 1, maxAttempts: 5 });
    const before = transcript.messages.length;
    send({ type: "auto_retry_end", success: true, attempt: 1 });

    expect(transcript.messages).toHaveLength(before);
    expect(transcript.retryAttempt).toBe(0);
  });
});
