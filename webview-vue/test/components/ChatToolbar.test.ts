// The header's status word — the one line that says what the agent is doing.
//
// Every number in it belongs to pi: the retry counter is `auto_retry_start`
// (`attempt` / `maxAttempts`), and `maxAttempts` is a *setting*
// (`retry.maxRetries`, 3 by default). The label used to hardcode `/3`, so a run
// with a raised ceiling reported "重试 2/3" right up to its fifth retry.

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n.ts";
import ChatToolbar from "@/components/ChatToolbar.vue";
import { useSessionStore } from "@/stores/session.ts";
import { useTranscriptStore } from "@/stores/transcript.ts";

vi.mock("@/lib/bridge.ts", () => ({
  post: () => {},
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

const mountToolbar = () => mount(ChatToolbar, { shallow: true });
const status = (wrapper: ReturnType<typeof mountToolbar>) => wrapper.get("#status").text();

describe("ChatToolbar — the status word", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("counts retries against the run's own ceiling", () => {
    const transcript = useTranscriptStore();
    transcript.applyEvent({ type: "auto_retry_start", attempt: 2, maxAttempts: 5 });

    expect(status(mountToolbar())).toBe(t("Retrying {0}/{1}…", 2, 5));
  });

  it("names the other two states and says nothing when the agent is idle", () => {
    expect(status(mountToolbar())).toBe("");

    useTranscriptStore().applyEvent({ type: "compaction_start" });
    expect(status(mountToolbar())).toBe(t("Compacting…"));

    useTranscriptStore().applyEvent({ type: "compaction_end", aborted: false });
    useSessionStore().applyState({ isStreaming: true });
    expect(status(mountToolbar())).toBe(t("Working…"));
  });
});

// The `+` is gated on the host's own count — the same field the host's guard
// reads — so the two can never disagree about whether a session is "already
// new". The button therefore waits for the host to say the session has grown;
// it does not infer that from the transcript (the two were 彬哥's "点不了没反应"
// when the host's settle push was missing).
describe("ChatToolbar — the new-chat button", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("comes back when the host reports messages, not when the screen fills up", async () => {
    useTranscriptStore().hydrate([
      { role: "user", content: "你好" },
      { role: "assistant", content: "收到" },
    ]);
    const wrapper = mountToolbar();
    expect(wrapper.get("#new-chat-btn").attributes("disabled")).toBeDefined();

    useSessionStore().applyState({ messageCount: 2 });
    await wrapper.vm.$nextTick();
    expect(wrapper.get("#new-chat-btn").attributes("disabled")).toBeUndefined();
  });

  it("is out of reach while a run is in flight", async () => {
    useSessionStore().applyState({ messageCount: 2 });
    const wrapper = mountToolbar();
    expect(wrapper.get("#new-chat-btn").attributes("disabled")).toBeUndefined();

    useSessionStore().applyState({ isStreaming: true });
    await wrapper.vm.$nextTick();
    expect(wrapper.get("#new-chat-btn").attributes("disabled")).toBeDefined();
  });
});
