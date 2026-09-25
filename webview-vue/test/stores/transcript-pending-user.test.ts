// The user's own message, drawn before pi answers.
//
// A send does not always reach pi at once: a fresh session or a replacement
// finishes initialising first, and pi's echo only comes after that. The bubble
// is the user's, so it goes up on send — `timestamp: null` is the join that lets
// pi's `message_start` fill in the time instead of appending a second copy.

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { RpcEvent } from "@protocol/rpc";
import { useTranscriptStore } from "@/stores/transcript.ts";

const T0 = 1_700_000_000_000;

describe("transcript — a message drawn before pi echoes it", () => {
  let transcript: ReturnType<typeof useTranscriptStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    transcript = useTranscriptStore();
  });

  const echo = (text: string) =>
    transcript.applyEvent({
      type: "message_start",
      message: { role: "user", timestamp: T0, content: [{ type: "text", text }] },
    } as RpcEvent);

  const userMessages = () =>
    transcript.messages.filter((message) => message.kind === "user") as Array<{
      text: string;
      timestamp: number | null;
    }>;

  it("shows it immediately, with no timestamp yet, and turns it into a turn", () => {
    transcript.pushPendingUser("新会话里立刻可见吗", []);

    expect(userMessages()).toHaveLength(1);
    expect(userMessages()[0]).toMatchObject({ text: "新会话里立刻可见吗", timestamp: null });
    expect(transcript.turns).toHaveLength(1);
    expect(transcript.turns[0]?.user?.text).toBe("新会话里立刻可见吗");
  });

  it("lets pi's echo fill in the time instead of adding a second bubble", () => {
    transcript.pushPendingUser("合并测试", []);
    echo("合并测试");

    const users = userMessages();
    expect(users).toHaveLength(1);
    expect(users[0]?.timestamp).toBe(T0);
  });

  it("still appends when the echo is a different message", () => {
    transcript.pushPendingUser("第一条", []);
    echo("第二条");

    expect(userMessages().map((message) => message.text)).toEqual(["第一条", "第二条"]);
  });
});
