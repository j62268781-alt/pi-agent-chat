// A run that is stopped while the model is still reasoning.
//
// The reasoning row is the one block that stays live until something else
// happens: its `running` flag is what drives both the 「思考中」 label and the
// ring. Text and tool starts clear it mid-turn, so a turn that never gets past
// thinking has only the turn's own end to fall back on.

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { RpcEvent } from "@protocol/rpc";
import { useTranscriptStore } from "@/stores/transcript.ts";

const T0 = 1_700_000_000_000;

type Block = { kind: string; running?: boolean; text?: string };

describe("transcript — a turn stopped mid-thought", () => {
  let transcript: ReturnType<typeof useTranscriptStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    transcript = useTranscriptStore();
  });

  const send = (event: RpcEvent) => transcript.applyEvent(event);

  /** Reaches the reasoning phase and stops there — no text, no tool call. */
  function thinkWithoutAnswering(): void {
    send({ type: "agent_start" });
    send({
      type: "message_start",
      message: { role: "user", timestamp: T0, content: [{ type: "text", text: "哈哈" }] },
    });
    send({ type: "message_start", message: { role: "assistant", timestamp: T0, content: [] } });
    send({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
    });
    send({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        contentIndex: 0,
        delta: "a casual reaction",
      },
    });
  }

  const thinkingBlock = (): Block | undefined => {
    const last = transcript.messages.at(-1) as unknown as { blocks?: Block[] };
    return last?.blocks?.find((block) => block.kind === "thinking");
  };

  it("keeps the row live while the model is still reasoning", () => {
    thinkWithoutAnswering();

    expect(thinkingBlock()?.running).toBe(true);
  });

  it("drops it on the aborted message_end", () => {
    thinkWithoutAnswering();
    send({
      type: "message_end",
      message: { role: "assistant", timestamp: T0, stopReason: "aborted", content: [] },
    });

    expect(thinkingBlock()?.running).toBe(false);
  });

  it("drops it when the turn settles without a message_end", () => {
    thinkWithoutAnswering();
    send({ type: "agent_settled" });

    expect(thinkingBlock()?.running).toBe(false);
  });
});
