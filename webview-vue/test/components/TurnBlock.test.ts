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

const toolEntry = (id: string): Turn["workBlocks"][number] => {
  const block: Block = {
    kind: "tool",
    id,
    name: "read",
    argsText: "",
    args: { path: "src/app.ts" },
    status: "done",
    startedAt: T0,
    durationMs: 120,
    output: "file body",
    diffText: "",
    writeContent: "",
    added: 0,
    removed: 0,
    filePath: "src/app.ts",
    fileLine: null,
    subagent: null,
    questionnaire: null,
  };
  return { message: assistant(block), block };
};

const thinkingEntry = (): Turn["workBlocks"][number] => ({
  message: assistant(THINKING),
  block: THINKING,
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

// The closing status line carries the turn's cache counters. A turn that uses
// tools is *several* assistant messages, so the numbers have to be the turn's
// sum — reading only the last message would under-report every tool-using turn.
describe("TurnBlock — the turn's cache counters", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const usageEntry = (id: string, usage: unknown): Turn["workBlocks"][number] => {
    const block: Block = { ...TEXT, id };
    return { message: { ...assistant(block), usage }, block };
  };

  it("sums the turn's messages, stays compact and keeps the full string on hover", () => {
    const wrapper = mountTurn({
      workBlocks: [
        usageEntry("text-a", {
          input: 1200,
          output: 340,
          cacheRead: 18600,
          cacheWrite: 900,
          cost: 0.0123,
        }),
      ],
      finalBlocks: [usageEntry("text-b", { input: 300, output: 40, cacheRead: 5000 })],
    });

    const span = wrapper.get(".msg-status-line span[title]");
    expect(span.text()).toBe("R24k W900");
    expect(span.attributes("title")).toBe(`\u21911.5k \u2193380 R24k W900 $0.0123`);
  });

  it("stays out of the line when the provider reported no cache activity", () => {
    const wrapper = mountTurn({
      workBlocks: [usageEntry("text-a", { input: 5000, output: 100, cacheRead: 0, cacheWrite: 0 })],
    });

    expect(wrapper.find(".msg-status-line span[title]").exists()).toBe(false);
  });
});

// Work rows are one flat list: 已思考, then each tool call, every one of them a direct
// child of `.work-body`. A run of consecutive calls used to get its own counter row
// ("执行工具 N 次") — first as a fold, then as a label — but with the calls laid out
// flat the count says nothing the rows do not (彬哥).
describe("TurnBlock — the work rows", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("lays a run of tool calls out flat beside 已思考, with no counter row", () => {
    const wrapper = mountTurn({
      workBlocks: [thinkingEntry(), toolEntry("tool-1"), toolEntry("tool-2")],
    });
    const body = wrapper.get(".work-body");

    // 3 rows, all siblings: 已思考 and the two calls. A counter row would be a 4th
    // child (and not a `.msg`).
    expect(body.element.children).toHaveLength(3);
    for (const child of body.element.children) {
      expect(child.classList.contains("msg")).toBe(true);
    }
    expect(wrapper.findAll(".tool-block")).toHaveLength(2);
  });
});
