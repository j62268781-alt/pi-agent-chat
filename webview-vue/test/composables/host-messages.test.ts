// The two ways a replacement session lands in the panel, and the one thing that
// separates them: whether the transcript on screen is replaced.
//
// The guide's first send is why this matters. The session pi creates is empty
// until that message reaches it, so re-reading it emptied the panel and put the
// new-session guide back on screen for the moment in between, then the message
// reappeared when pi echoed it (彬哥: 闪到原始新会话页面然后又恢复).

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/stores/session.ts";
import { useTranscriptStore } from "@/stores/transcript.ts";

const handlers: Array<(message: Record<string, unknown>) => void> = [];

vi.mock("@/lib/bridge.ts", () => ({
  post: () => {},
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: (handler: (message: Record<string, unknown>) => void) => {
    handlers.push(handler);
    return () => {};
  },
}));

const { useHostLink } = await import("@/composables/useHostLink.ts");

/** What the panel looks like right after the guide's first send. */
function guideSendOnScreen(): void {
  const session = useSessionStore();
  const transcript = useTranscriptStore();
  session.pendingNew = true;
  transcript.pushPendingUser("pi对于数学家的魅力，是什么", []);
  expect(transcript.isEmpty).toBe(false);
}

describe("a replacement session landing", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    handlers.length = 0;
  });

  /** Wire the router up the way the page does, and hand back its handler. */
  const connect = (): ((message: Record<string, unknown>) => void) => {
    useHostLink().connect();
    const handler = handlers.at(-1);
    if (!handler) throw new Error("the router never subscribed");
    return handler;
  };

  it("keeps the transcript when the panel already has the content", () => {
    const session = useSessionStore();
    const transcript = useTranscriptStore();
    guideSendOnScreen();
    const handle = connect();

    handle({ type: "adoptSession" });

    // The guide is over and the session the host made is the open one...
    expect(session.pendingNew).toBe(false);
    expect(session.switchSnapshot).toBeNull();
    // ...and the message that created it is still on screen.
    expect(transcript.isEmpty).toBe(false);
  });

  it("replaces the transcript when the host sends real content", () => {
    const transcript = useTranscriptStore();
    guideSendOnScreen();
    const handle = connect();

    handle({ type: "messages", messages: [], historyAvailable: false });

    // This is the flash the host no longer sends for a guide's own send: an
    // empty re-read leaves nothing to draw, so the guide comes back.
    expect(transcript.isEmpty).toBe(true);
  });
});
