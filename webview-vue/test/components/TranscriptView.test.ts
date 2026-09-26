// What the transcript shows while a session switch is in flight.
//
// The switch is slow — pi rebuilds its runtime, measured at 2.2–6.6s — and when
// the target session has no cached transcript (a session created in another pi
// process, say) there is nothing to paint in the meantime. Two things must not
// be painted: the empty guide (that is the *new session* pitch, `isEmpty` is
// true here only because the transcript was just reset) and the boot page
// (`BootSplash` is the cold start, and covering a switch with it made the panel
// look like it restarted — 彬哥).

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n.ts";
import TranscriptView from "@/components/TranscriptView.vue";
import TodoPill from "@/components/TodoPill.vue";
import { useSessionStore } from "@/stores/session.ts";
import { useTranscriptStore } from "@/stores/transcript.ts";

vi.mock("@/lib/bridge.ts", () => ({
  post: () => {},
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

const beginSwitch = (name: string) => {
  useSessionStore().beginSwitch("/tmp/sessions/b.jsonl", name, []);
  useTranscriptStore().reset();
};

describe("TranscriptView while a switch is in flight", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("draws its own loading state instead of the new-session guide", async () => {
    const wrapper = mount(TranscriptView);
    expect(wrapper.find(".empty").exists()).toBe(true);

    beginSwitch("另外一个会话");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".empty").exists()).toBe(false);
    expect(wrapper.get(".switch-loading").text()).toContain("另外一个会话");
  });

  it("takes the loading state down when the switch lands", async () => {
    const wrapper = mount(TranscriptView);
    beginSwitch("另外一个会话");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".switch-loading").exists()).toBe(true);

    useSessionStore().endSwitch();
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".switch-loading").exists()).toBe(false);
  });
});

describe("TranscriptView's live status row", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("names a retry there, not only on the toolbar", async () => {
    // 彬哥: a run sitting in its retries looked like it was still answering, and
    // the toolbar's own counter went unnoticed. The row the reader watches says
    // it instead.
    const wrapper = mount(TranscriptView);
    useSessionStore().applyState({ isStreaming: true });
    useTranscriptStore().applyEvent({ type: "auto_retry_start", attempt: 2, maxAttempts: 5 });
    await wrapper.vm.$nextTick();

    expect(wrapper.get(".status-text").text()).toBe(t("Retrying {0}/{1}…", 2, 5));
  });

  it("goes back to the answering phrase when the retry lands", async () => {
    const wrapper = mount(TranscriptView);
    useSessionStore().applyState({ isStreaming: true });
    const transcript = useTranscriptStore();
    transcript.applyEvent({ type: "auto_retry_start", attempt: 2, maxAttempts: 5 });
    transcript.applyEvent({ type: "auto_retry_end", success: true });
    await wrapper.vm.$nextTick();

    expect(wrapper.get(".status-text").text()).toBe(t("Replying…"));
  });
});

describe("TranscriptView floating row", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("pairs the todo capsule with the scroll-to-bottom button", () => {
    const wrapper = mount(TranscriptView, { shallow: true });

    const row = wrapper.get(".float-row");
    expect(row.find("#scroll-bottom-btn").exists()).toBe(true);
    expect(row.findComponent(TodoPill).exists()).toBe(true);
  });
});
