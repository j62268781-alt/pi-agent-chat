// How long a tool call took, as the row's right-hand number.
//
// pi runs a tool *after* the assistant message that asked for it has ended, and
// `message_end` clears `activeAssistant` (`activeAssistantIndex = -1`). The
// timing used to be recorded by looking the block up through `activeAssistant`,
// so in a real session it was never recorded at all: the block was found later
// by `toolCallId` (that is how the result lands), which left `startedAt` null
// and `durationMs` null — the row's `.tool-status` never rendered. Measured in a
// real VS Code window: both tool blocks came back `startedAt: null`.

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useTranscriptStore } from "@/stores/transcript.ts";

const T0 = 1_700_000_000_000;

/** The event order a real run produces: call, message ends, then the tool runs. */
function callThenRun(transcript: ReturnType<typeof useTranscriptStore>, id = "t1"): void {
  transcript.applyEvent({
    type: "message_start",
    message: { role: "assistant", timestamp: T0 },
  });
  transcript.applyEvent({
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { id, name: "bash", arguments: { command: "ls" } },
    },
  });
  transcript.applyEvent({
    type: "message_end",
    message: { role: "assistant", stopReason: "toolUse" },
  });
  transcript.applyEvent({
    type: "tool_execution_start",
    toolCallId: id,
    toolName: "bash",
    args: { command: "ls" },
  });
}

describe("transcript — how long a tool took", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("times a tool that ran after its message ended", () => {
    const transcript = useTranscriptStore();
    callThenRun(transcript);
    transcript.applyEvent({
      type: "tool_execution_end",
      toolCallId: "t1",
      isError: false,
      result: { content: [{ type: "text", text: "ok" }] },
    });

    const block = transcript.resolveToolLocation("t1");
    expect(block?.status).toBe("done");
    expect(block?.durationMs).toBeTypeOf("number");
  });

  it("still times a tool that ran while the message was open", () => {
    const transcript = useTranscriptStore();
    transcript.beginAssistant(T0);
    transcript.applyEvent({
      type: "tool_execution_start",
      toolCallId: "t2",
      toolName: "bash",
      args: { command: "ls" },
    });
    transcript.applyEvent({
      type: "tool_execution_end",
      toolCallId: "t2",
      isError: false,
      result: { content: [{ type: "text", text: "ok" }] },
    });

    expect(transcript.resolveToolLocation("t2")?.durationMs).toBeTypeOf("number");
  });

  it("invents no duration for a history that carries none", () => {
    const transcript = useTranscriptStore();
    transcript.hydrate([
      {
        role: "assistant",
        timestamp: T0,
        content: [{ type: "toolCall", id: "t3", name: "read", args: { path: "a.ts" } }],
      },
      { role: "toolResult", toolCallId: "t3", content: [{ type: "text", text: "body" }] },
    ]);

    const block = transcript.resolveToolLocation("t3");
    expect(block?.status).toBe("done");
    expect(block?.durationMs).toBeNull();
  });
});
