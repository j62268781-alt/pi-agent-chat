// "Waiting for the agent": the row the transcript shows between handing pi a
// prompt and the run actually starting.
//
// pi rebuilds its runtime before a session's first turn — seconds, once MCP is
// configured — and until `agent_start` lands there is no block to narrate, so
// the row would otherwise be empty for the whole wait (彬哥: 发了消息那几秒像没
// 反应). The state is optimistic, so every way the wait can end has to clear it:
// a run that starts, a settle, a rejection, a dead session, a switch away.

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/stores/session.ts";
import { useTranscriptStore } from "@/stores/transcript.ts";

vi.mock("@/lib/bridge.ts", () => ({
  post: () => {},
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

describe("awaiting the agent", () => {
  let session: ReturnType<typeof useSessionStore>;
  let transcript: ReturnType<typeof useTranscriptStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    session = useSessionStore();
    transcript = useTranscriptStore();
  });

  it("is off until something is sent", () => {
    expect(session.awaitingAgent).toBe(false);
  });

  it("ends the moment the run starts", () => {
    session.awaitingAgent = true;

    session.applyState({ isStreaming: true });

    expect(session.awaitingAgent).toBe(false);
  });

  it("ends on a settle, including a run that never started", () => {
    session.awaitingAgent = true;

    transcript.applyEvent({ type: "agent_settled" });

    expect(session.awaitingAgent).toBe(false);
  });

  it("does not survive a switch to another session", () => {
    session.awaitingAgent = true;

    session.beginSwitch("/tmp/other.jsonl", "别的会话", []);

    expect(session.awaitingAgent).toBe(false);
  });

  it("stays put while the wait is still a wait", () => {
    session.awaitingAgent = true;

    // A state push that says nothing about a run must not end the wait.
    session.applyState({ messageCount: 2 });

    expect(session.awaitingAgent).toBe(true);
  });
});
