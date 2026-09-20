// The turn's running judgement, at the component level.
//
// 024736b fixed this in the store: a turn that uses tools is *several* assistant
// messages, and the first `message_end` already writes a stop reason, so
// "streaming && no stop reason" called a mid-session turn settled (or a settled
// one running). `TurnBlock` decides on `isLast && isStreaming` — and it decides
// twice, for the fold head and for the closing status line — so it is worth
// locking here too: the store test cannot see the template.

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { t } from "@/lib/i18n.ts";
import { useDisplayStore } from "@/stores/display.ts";
import { useSessionStore } from "@/stores/session.ts";
import type { AssistantMessage, Block, Turn } from "@/stores/transcript.ts";
import TurnBlock from "@/components/TurnBlock.vue";

const T0 = 1_700_000_000_000;

const TEXT: Block = {
  kind: "text",
  id: "text-1",
  markdown: "答案",
  streaming: false,
  collapsed: false,
};
const THINKING: Block = {
  kind: "thinking",
  id: "think-1",
  text: "推理",
  running: false,
  open: false,
};

const assistant = (block: Block): AssistantMessage => ({
  kind: "assistant",
  id: "asst-1",
  timestamp: T0 + 1_000,
  model: "m",
  blocks: [block],
  usage: null,
  stopReason: null,
  errorMessage: null,
});

/** A tool-using turn: work behind the fold, the answer in the clear. */
const turn = (over: Partial<Turn> = {}): Turn => ({
  id: "turn-1",
  user: { kind: "user", id: "user-1", timestamp: T0, text: "把标题改短一点", images: [] },
  leading: [],
  workBlocks: [{ message: assistant(THINKING), block: THINKING }],
  finalBlocks: [{ message: assistant(TEXT), block: TEXT }],
  workStartedAt: T0,
  workEndedAt: T0 + 5_000,
  added: 0,
  removed: 0,
  messageTime: T0 + 5_000,
  stopReason: "stop",
  errorMessage: null,
  ...over,
});

const mountTurn = (over: Partial<Turn> = {}, isLast = false) =>
  mount(TurnBlock, { props: { turn: turn(over), isLast } });

describe("TurnBlock — is this turn still running?", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("reads as processed when the session is idle, and carries the closing line", () => {
    const wrapper = mountTurn({}, true);

    expect(wrapper.get(".work-head").text()).toContain(t("Processed"));
    const status = wrapper.get(".msg-status-line");
    expect(status.text()).toContain(t("Processed"));
    expect(status.get(".msg-duration").text().trim()).not.toBe("");
  });

  it("keeps a settled turn in the middle settled while the session streams", () => {
    useSessionStore().applyState({ isStreaming: true });
    const wrapper = mountTurn({}, false); // not the last turn

    expect(wrapper.get(".work-head").text()).toContain(t("Processed"));
    expect(wrapper.find(".msg-status-line").exists()).toBe(true);
  });

  it("reads as running only for the last turn, and hides its closing line", () => {
    useSessionStore().applyState({ isStreaming: true });
    // A tool-using turn in flight: the first `message_end` already wrote a stop
    // reason, which is exactly what made the old judgement call it settled.
    const wrapper = mountTurn({ stopReason: "toolUse" }, true);

    expect(wrapper.get(".work-head").text()).toContain(t("Running for {0}").split("{0}")[0]);
    expect(wrapper.find(".msg-status-line").exists()).toBe(false);
  });

  it("offers the fold and the fork once the turn is done", () => {
    const wrapper = mountTurn({}, true);

    expect(wrapper.get(".work-head").text()).toContain(t("Processed"));
    expect(wrapper.get(".work-block").element).toBeInstanceOf(HTMLDetailsElement);
    expect(wrapper.find(".status-action").exists()).toBe(true);
  });

  it("hides the fold when the user turned folding off", () => {
    useDisplayStore().settings.collapseWork = false;
    const wrapper = mountTurn({}, true);

    expect(wrapper.find(".work-block").exists()).toBe(false);
    // The blocks themselves are still on screen, just not folded.
    expect(wrapper.text()).toContain("推理");
  });
});
