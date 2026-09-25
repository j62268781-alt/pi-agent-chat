// The bubble goes up with the send, not with pi's echo.
//
// A send can wait a while before pi answers — a fresh session or a replacement
// has to finish initialising first — and the message is the user's own, so it
// belongs on screen straight away. Commands are the exception: the host may
// answer one without pi ever echoing a user message.

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Composer from "@/components/Composer.vue";
import { useComposerStore } from "@/stores/composer.ts";
import { useTranscriptStore } from "@/stores/transcript.ts";

const { posted } = vi.hoisted(() => ({ posted: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/bridge.ts", () => ({
  post: (message: Record<string, unknown>) => {
    posted.push(message);
  },
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

const users = () =>
  useTranscriptStore().messages.filter((message) => message.kind === "user") as Array<{
    text: string;
    timestamp: number | null;
  }>;

describe("Composer — send draws the message", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    posted.length = 0;
  });

  it("puts the bubble up with the send, before pi echoes anything", async () => {
    useComposerStore().setDraft("新会话里立刻可见吗");
    const send = mount(Composer, { shallow: true }).get("#send");

    await send.trigger("click");

    expect(posted.at(-1)).toMatchObject({
      type: "prompt",
      message: "新会话里立刻可见吗",
    });
    expect(users()).toHaveLength(1);
    expect(users()[0]).toMatchObject({ text: "新会话里立刻可见吗", timestamp: null });
  });

  it("leaves a command to the host", async () => {
    useComposerStore().setDraft("/clear");
    const send = mount(Composer, { shallow: true }).get("#send");

    await send.trigger("click");

    expect(posted.at(-1)).toMatchObject({ type: "prompt", message: "/clear" });
    expect(users()).toHaveLength(0);
  });
});
