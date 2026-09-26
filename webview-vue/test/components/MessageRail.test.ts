// The message rail: what it marks, what it shows, and where it takes you.
//
// The rail is the one part of the transcript that is not "what you can see": it
// spans the whole session while only the tail turns are mounted, so the two
// things worth pinning here are its jump (which may have to page older turns in
// first) and its idea of the current prompt. That idea comes from geometry the
// browser owns, and jsdom has no layout — every rect below is stubbed.

import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n.ts";
import MessageRail from "@/components/MessageRail.vue";
import TranscriptView from "@/components/TranscriptView.vue";
import { useTranscriptStore } from "@/stores/transcript.ts";

vi.mock("@/lib/bridge.ts", () => ({
  post: () => {},
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

const T0 = 1_756_000_000_000;

const userMessage = (text: string, at = T0) => ({
  role: "user",
  timestamp: at,
  content: [{ type: "text", text }],
});

const assistantMessage = (text: string, at = T0) => ({
  role: "assistant",
  timestamp: at,
  model: "claude-sonnet-4",
  content: [{ type: "text", text }],
});

const compactionSummary = (summary: string, at = T0) => ({
  role: "compactionSummary",
  timestamp: at,
  summary,
});

/** Only `top` is ever read; the rest keeps the shape of a `DOMRect`. */
const rectAt = (top: number): DOMRect =>
  ({
    top,
    bottom: top,
    height: 0,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

/** Vue updates land in a microtask; the scroll handler goes through one rAF. */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
};

const wrappers: VueWrapper[] = [];

/** Attached to the document: the rail looks its scroller up by id. */
function mountRail(): VueWrapper {
  const wrapper = mount(MessageRail, { attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}

function mountTranscript(): VueWrapper {
  const wrapper = mount(TranscriptView, { attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}

describe("MessageRail", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    for (const wrapper of wrappers) wrapper.unmount();
    wrappers.length = 0;
    document.body.replaceChildren();
  });

  it("marks each prompt and rules off each compaction", () => {
    useTranscriptStore().hydrate([
      userMessage("第一问"),
      assistantMessage("答一"),
      compactionSummary("压缩摘要"),
      userMessage("第二问"),
      assistantMessage("答二"),
    ]);

    const wrapper = mountRail();

    expect(wrapper.findAll(".msg-rail-mark")).toHaveLength(2);
    expect(wrapper.findAll(".msg-rail-sep")).toHaveLength(1);
    expect(wrapper.get(".msg-rail-mark").attributes("aria-label")).toBe(t("Go to prompt {0}", 1));
  });

  it("stays out of the way when there is no prompt to mark", () => {
    expect(mountRail().find(".msg-rail").exists()).toBe(false);
  });

  it("puts the clicked prompt at the top of the transcript", async () => {
    useTranscriptStore().hydrate([
      userMessage("第一问"),
      assistantMessage("答一"),
      userMessage("第二问"),
      assistantMessage("答二"),
    ]);
    const wrapper = mountTranscript();
    const scroller = wrapper.get("#messages").element as HTMLElement;
    const row = wrapper.findAll(".msg.user")[1]?.element as HTMLElement;
    scroller.getBoundingClientRect = () => rectAt(100);
    row.getBoundingClientRect = () => rectAt(380);

    await wrapper.findAll(".msg-rail-mark")[1]?.trigger("click");

    // 380 - 100, less the 8px that keeps the bubble off the very edge.
    expect(scroller.scrollTop).toBe(272);
  });

  it("pages the older turns in before jumping above the render window", async () => {
    const history: unknown[] = [];
    for (let index = 0; index < 60; index += 1) {
      history.push(userMessage(`第 ${index + 1} 问`), assistantMessage(`答 ${index + 1}`));
    }
    const transcript = useTranscriptStore();
    transcript.hydrate(history);
    const wrapper = mountTranscript();
    const firstTurnId = transcript.turns[0]?.id ?? "";
    expect(transcript.visibleTurns).toHaveLength(50);

    await wrapper.findAll(".msg-rail-mark")[0]?.trigger("click");

    expect(transcript.visibleTurns).toHaveLength(60);
    expect(wrapper.find(`.msg.user[data-turn-id="${firstTurnId}"]`).exists()).toBe(true);
  });

  it("moves the current mark with the prompt at the top of the view", async () => {
    useTranscriptStore().hydrate([
      userMessage("一问"),
      assistantMessage("一答"),
      userMessage("二问"),
      assistantMessage("二答"),
      userMessage("三问"),
      assistantMessage("三答"),
    ]);
    const wrapper = mountTranscript();
    const scroller = wrapper.get("#messages").element as HTMLElement;
    scroller.getBoundingClientRect = () => rectAt(100);
    Object.defineProperty(scroller, "clientHeight", { value: 600, configurable: true });
    Object.defineProperty(scroller, "scrollHeight", { value: 6_000, configurable: true });
    const rows = wrapper.findAll(".msg.user").map((row) => row.element as HTMLElement);
    // Only the second prompt is on screen; the first has scrolled past the top.
    const tops = [-400, 104, 700];
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => rectAt(tops[index] ?? 0);
    });

    scroller.dispatchEvent(new Event("scroll"));
    await settle();

    const current = wrapper
      .findAll(".msg-rail-mark")
      .map((mark) => mark.classes().includes("is-current"));
    expect(current).toEqual([false, true, false]);
  });

  it("leaves a jumped-to prompt its own mark", async () => {
    // The preview's second failure: with short turns a few prompts fit in the
    // viewport, so a rule that took "the prompt inside the top third" marked
    // 提问 2 right after a click on 提问 1. The top edge belongs to 提问 1.
    useTranscriptStore().hydrate([
      userMessage("一问"),
      assistantMessage("一答"),
      userMessage("二问"),
      assistantMessage("二答"),
      userMessage("三问"),
      assistantMessage("三答"),
    ]);
    const wrapper = mountTranscript();
    const scroller = wrapper.get("#messages").element as HTMLElement;
    scroller.getBoundingClientRect = () => rectAt(100);
    Object.defineProperty(scroller, "clientHeight", { value: 600, configurable: true });
    Object.defineProperty(scroller, "scrollHeight", { value: 6_000, configurable: true });
    const rows = wrapper.findAll(".msg.user").map((row) => row.element as HTMLElement);
    // 提问 1 has just landed on the top edge and 提问 2's bubble is right below it
    // — inside the band a third-of-the-viewport line would have covered.
    const tops = [8, 138, 400];
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => rectAt(tops[index] ?? 0);
    });

    scroller.dispatchEvent(new Event("scroll"));
    await settle();

    const current = wrapper
      .findAll(".msg-rail-mark")
      .map((mark) => mark.classes().includes("is-current"));
    expect(current).toEqual([true, false, false]);
  });

  it("keeps the newest prompt marked while the view is at the bottom", async () => {
    // The preview's first failure: the newest turn was short, so its bubble sat
    // inside the viewport at the bottom of the session, and the mark fell back
    // to a prompt two answers up — the rail said 提问 1 while the screen showed
    // 提问 3.
    useTranscriptStore().hydrate([
      userMessage("一问"),
      assistantMessage("一答"),
      userMessage("二问"),
      assistantMessage("二答"),
      userMessage("三问"),
      assistantMessage("三答"),
    ]);
    const wrapper = mountTranscript();
    const scroller = wrapper.get("#messages").element as HTMLElement;
    scroller.getBoundingClientRect = () => rectAt(48);
    Object.defineProperty(scroller, "clientHeight", { value: 600, configurable: true });
    Object.defineProperty(scroller, "scrollHeight", { value: 640, configurable: true });
    const rows = wrapper.findAll(".msg.user").map((row) => row.element as HTMLElement);
    const tops = [-2_281, 62, 257];
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => rectAt(tops[index] ?? 0);
    });

    scroller.dispatchEvent(new Event("scroll"));
    await settle();

    const current = wrapper
      .findAll(".msg-rail-mark")
      .map((mark) => mark.classes().includes("is-current"));
    expect(current).toEqual([false, false, true]);
  });

  it("opens a card with the prompt and the answer's opening, after hover intent", async () => {
    useTranscriptStore().hydrate([
      userMessage("字号怎么收？"),
      assistantMessage("先把**硬编码**的 `13px` 找出来。"),
    ]);
    const wrapper = mountRail();
    const mark = wrapper.get(".msg-rail-mark");

    vi.useFakeTimers();
    try {
      await mark.trigger("mouseenter");
      expect(wrapper.find(".msg-rail-card").exists()).toBe(false);

      vi.advanceTimersByTime(150);
      await wrapper.vm.$nextTick();

      const card = wrapper.get(".msg-rail-card");
      expect(card.get(".msg-rail-card-title").text()).toBe("字号怎么收？");
      expect(card.get(".msg-rail-card-reply").text()).toBe("先把硬编码的 13px 找出来。");
    } finally {
      vi.useRealTimers();
    }
  });

  it("quotes the answer's opening, not the prose that closes the turn", async () => {
    // A turn that runs tools is several messages, and the fold splits them: the
    // chatter before the tools is `workBlocks`, the trailing answer is
    // `finalBlocks`. The card's promise is the *opening*, so it takes the first.
    useTranscriptStore().hydrate([
      userMessage("给我看看"),
      {
        role: "assistant",
        timestamp: T0,
        model: "claude-sonnet-4",
        content: [
          { type: "text", text: "先说结论：字号塌了。" },
          { type: "toolCall", id: "call-1", name: "grep", arguments: { pattern: "font-size" } },
          { type: "text", text: "收完了，共 5 档。" },
        ],
      },
    ]);
    const wrapper = mountRail();

    vi.useFakeTimers();
    try {
      await wrapper.get(".msg-rail-mark").trigger("mouseenter");
      vi.advanceTimersByTime(150);
      await wrapper.vm.$nextTick();

      expect(wrapper.get(".msg-rail-card-reply").text()).toBe("先说结论：字号塌了。");
    } finally {
      vi.useRealTimers();
    }
  });
});
