// The link between a `questionnaire` tool result and the card that renders it.
//
// `applyToolResultToBlock` used to read only `diff` / `content` / `filePath` /
// `line`, so `details.questions` and `details.answers` were dropped on the way
// in and there was nothing left for the card to show.

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useTranscriptStore } from "./transcript.ts";

const T0 = 1_700_000_000_000;

const DETAILS = {
  questions: [
    {
      id: "scope",
      label: "Scope",
      prompt: "改动范围？",
      options: [{ label: "只改这一处" }, { label: "整个模块" }],
      allowOther: true,
    },
  ],
  answers: [{ id: "scope", value: "整个模块", label: "整个模块", wasCustom: false, index: 2 }],
  cancelled: false,
};

describe("transcript — a questionnaire tool result", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("keeps the questions and answers on the tool block", () => {
    const transcript = useTranscriptStore();
    transcript.beginAssistant(T0);
    transcript.applyEvent({
      type: "tool_execution_start",
      toolCallId: "q1",
      toolName: "questionnaire",
      args: { questions: DETAILS.questions },
    });
    transcript.applyEvent({
      type: "tool_execution_end",
      toolCallId: "q1",
      isError: false,
      result: { content: [{ type: "text", text: "Scope: user selected: 2. 整个模块" }], details: DETAILS },
    });

    const block = transcript.resolveToolLocation("q1");
    const questions = block?.questionnaire?.questions ?? [];
    const answers = block?.questionnaire?.answers ?? [];
    expect(questions[0]?.prompt).toBe("改动范围？");
    expect(answers[0]?.index).toBe(2);
  });

  it("keeps them when the session is hydrated from disk", () => {
    const transcript = useTranscriptStore();
    transcript.hydrate([
      {
        role: "assistant",
        timestamp: T0,
        content: [{ type: "toolCall", id: "q1", name: "questionnaire", args: { questions: DETAILS.questions } }],
      },
      {
        role: "toolResult",
        toolCallId: "q1",
        content: [{ type: "text", text: "Scope: user selected: 2. 整个模块" }],
        details: DETAILS,
      },
    ]);

    const block = transcript.resolveToolLocation("q1");
    expect(block?.questionnaire?.answers[0]?.index).toBe(2);
  });

  it("leaves the field empty for a tool that is not a questionnaire", () => {
    const transcript = useTranscriptStore();
    transcript.beginAssistant(T0);
    transcript.applyEvent({
      type: "tool_execution_start",
      toolCallId: "b1",
      toolName: "bash",
      args: { command: "ls" },
    });
    transcript.applyEvent({
      type: "tool_execution_end",
      toolCallId: "b1",
      isError: false,
      result: { content: [{ type: "text", text: "ok" }], details: {} },
    });

    expect(transcript.resolveToolLocation("b1")?.questionnaire).toBeNull();
  });
});
