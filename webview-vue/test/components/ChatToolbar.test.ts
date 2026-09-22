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
