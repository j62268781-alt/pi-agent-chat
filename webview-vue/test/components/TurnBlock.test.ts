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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import { useDisplayStore } from "@/stores/display.ts";
import { useSessionStore } from "@/stores/session.ts";
import type { AssistantMessage, Block, Turn } from "@/stores/transcript.ts";
import TurnBlock from "@/components/TurnBlock.vue";

vi.mock("@/lib/bridge.ts", () => ({
  post: vi.fn(),
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

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

  it("spells the duration out on the fold head, and never on the closing line", () => {
    const wrapper = mountTurn({}, true);

    // The head labels the group it folds and is the first line of the turn, so
    // the duration rides along there — spelled out (「耗时 2分25秒」), because a
    // bare `5s` left the reader guessing what the number was (彬哥).
    const head = wrapper.get(".work-head").text();
    expect(head).toContain(t("Processed"));
    expect(head).toContain(t("Worked for {0}").replace("{0}", "").trim());

    // The closing line is the three actions and the time; the duration and the
    // outcome belong to the head.
    const status = wrapper.get(".msg-status-line");
    expect(status.find(".msg-outcome").exists()).toBe(false);
    expect(status.text()).not.toContain(t("Processed"));
    expect(status.find(".msg-duration").exists()).toBe(false);
  });

  it("keeps the closing line to the three actions and the time, head or not", () => {
    // No work to fold (or folding off) means no head and no duration anywhere:
    // the line is 复制 · 明细 · fork · 时间 in every case (彬哥).
    useDisplayStore().settings.collapseWork = false;
    const wrapper = mountTurn({ workBlocks: [] }, true);

    expect(wrapper.find(".work-block").exists()).toBe(false);
    const status = wrapper.get(".msg-status-line");
    expect(status.find(".msg-duration").exists()).toBe(false);
    expect(status.find(".msg-outcome").exists()).toBe(false);
  });

  it("names an outcome on the fold head, and on the line only when there is none", () => {
    const failed = mountTurn({ errorMessage: "boom" }, true);
    expect(failed.get(".work-head").text()).toContain(t("failed"));
    expect(failed.find(".msg-status-line .msg-outcome").exists()).toBe(false);

    // No head (folding off, or nothing folded) means the line has to name it.
    useDisplayStore().settings.collapseWork = false;
    const noHead = mountTurn({ errorMessage: "boom" }, true);
    expect(noHead.get(".msg-status-line .msg-outcome").text()).toBe(t("failed"));

    // A stop never gets the word: the notice above says it in full.
    const stopped = mountTurn({ stopReason: "aborted" }, true);
    expect(stopped.find(".msg-status-line .msg-outcome").exists()).toBe(false);
  });

  it("says where a stopped reply was cut", () => {
    // 「已停止」 is one word in a row of counters, and the reply above it still
    // reads as a whole answer — Qoder prints a sentence under a terminated
    // reply, and pi's own word for the state is "user cancelled".
    const stopped = mountTurn({ stopReason: "aborted" }, true);
    expect(stopped.get(".aborted-notice").text()).toBe(t("pi's reply was stopped by you."));

    for (const over of [{}, { errorMessage: "boom" }] as const) {
      expect(mountTurn(over, true).find(".aborted-notice").exists()).toBe(false);
    }
    // Mid-abort the turn is still running: the notice waits for the settle.
    useSessionStore().applyState({ isStreaming: true });
    expect(mountTurn({ stopReason: "aborted" }, true).find(".aborted-notice").exists()).toBe(false);
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

  it("sums the turn's messages and spells the buckets out on hover", () => {
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

    // The figures live in the card now; the icon still carries them on hover.
    const icon = wrapper.get(".msg-status-line .usage-action");
    expect(icon.find(".codicon-pie-chart").exists()).toBe(true);
    expect(icon.attributes("title")).toBe(
      `\u21911.5k \u2193380 ${t("Cache read")} 24k ${t("Cache write")} 900 $0.0123`,
    );
  });

  it("stays out of the line when no message reported anything at all", () => {
    const wrapper = mountTurn({
      workBlocks: [usageEntry("text-a", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })],
    });

    expect(wrapper.find(".msg-status-line .usage-action").exists()).toBe(false);
  });

  it("counts a message once however many blocks it owns", () => {
    // Usage is reported per *message*, but the fold holds one entry per *block*
    // (the thinking block, each tool call, the prose), so a one-message turn
    // arrives here three times over. Summing the entries straight multiplied the
    // counters by the block count — a 3.8M cache read read as 11.4M.
    const usage = { input: 1200, output: 340, cacheRead: 3_800_000, cacheWrite: 900 };
    const message = { ...assistant(TEXT), usage };
    const wrapper = mountTurn({
      workBlocks: [
        { message, block: THINKING },
        { message, block: { ...TEXT, id: "text-b" } },
      ],
      finalBlocks: [{ message, block: TEXT }],
    });

    // The figures live in the card; the icon that opens it carries the sum on
    // hover. Counting a message once keeps 3.8M from reading as 11.4M.
    const icon = wrapper.get(".msg-status-line .usage-action");
    expect(icon.attributes("title")).toContain(`${t("Cache read")} 3.8M`);
    expect(icon.attributes("title")).not.toContain("11.4M");
  });
});

// The closing line's actions: copy the answer, open the turn's usage card, fork.
// The copy took a chip on the user's message and nothing on the answer — so the
// one thing a reader wants to take away was the one thing they could not.
describe("TurnBlock — the closing line's actions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(post).mockClear();
  });

  const withUsage = (over: Partial<Turn> = {}) =>
    mountTurn({
      finalBlocks: [
        {
          message: {
            ...assistant(TEXT),
            usage: { input: 1_200, output: 340, cacheRead: 3_800_000 },
          },
          block: TEXT,
        },
      ],
      ...over,
    });

  it("keeps the closing line in the order 彬哥 asked for", () => {
    // 复制 · 明细 · fork · 时间 — three icons of one size plus the time.
    const wrapper = withUsage();
    const kind = (el: Element): string => {
      if (el.classList.contains("usage-action")) return "usage";
      if (el.classList.contains("status-action")) return el.getAttribute("title") ?? "action";
      return el.className;
    };

    expect([...wrapper.get(".msg-status-line").element.children].map(kind)).toEqual([
      t("Copy the conclusion"),
      "usage",
      t("Fork"),
      "msg-time",
    ]);
  });

  it("copies the answer, not the work behind it", async () => {
    const wrapper = withUsage();
    await wrapper.get('.status-action[title="' + t("Copy the conclusion") + '"]').trigger("click");

    expect(post).toHaveBeenCalledWith({ type: "copy", text: "答案" });
  });

  it("hides the copy when there is no answer to copy", () => {
    const wrapper = withUsage({ finalBlocks: [] });
    expect(wrapper.find(`.status-action[title="${t("Copy the conclusion")}"]`).exists()).toBe(
      false,
    );
  });

  it("opens the usage card from the chip, and closes it again", async () => {
    const wrapper = withUsage();
    const chip = wrapper.get(".usage-action");
    // jsdom lays nothing out, so `isVisible()` is always false here — `v-show`
    // writes `display` into the element's own style, which is the check.
    const shown = () => !(wrapper.get(".usage-popup").attributes("style") ?? "").includes("none");

    expect(shown()).toBe(false);
    await chip.trigger("click");

    const card = wrapper.get(".usage-popup");
    expect(shown()).toBe(true);
    // One call per assistant message: the work block and the answer are two
    // messages, so pi was called twice.
    expect(
      card.findAll(".usage-row").map((row) => row.findAll("span").map((span) => span.text())),
    ).toEqual([
      [t("Input"), "1.2k"],
      [t("Output"), "340"],
      [t("Cache read"), "3.8M"],
      [t("Cache write"), "0"],
      [t("Model calls"), "2"],
    ]);

    await chip.trigger("click");
    expect(shown()).toBe(false);
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

// The compaction row is a divider whose label is text: no glyph, one span between
// the two rules. The running one says so and has nothing to expand, the finished
// one opens the summary on click.
describe("TurnBlock — the compaction divider", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const withCompaction = (text: string) =>
    mountTurn({
      leading: [{ kind: "system", id: "sys-1", variant: "compaction", text, timestamp: null }],
    });

  it("keeps the running label bare — no glyph, nothing to expand", () => {
    const wrapper = withCompaction("");
    const label = wrapper.get(".compaction-divider-label");

    expect(label.text()).toBe(t("Compacting"));
    expect(label.classes()).toContain("is-running");
    expect(label.find(".codicon").exists()).toBe(false);
    // The span is the whole label; the flanking rules are its pseudo-elements.
    expect(label.element.children).toHaveLength(1);

    const details = wrapper.get(".compaction-divider").element;
    expect(details).toBeInstanceOf(HTMLDetailsElement);
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(wrapper.find(".compaction-summary-body").exists()).toBe(false);
  });

  it("names the finished state and keeps the summary behind the click", () => {
    const wrapper = withCompaction("## 摘要");
    const label = wrapper.get(".compaction-divider-label");

    expect(label.text()).toBe(t("Context compacted"));
    expect(label.classes()).not.toContain("is-running");
    expect(label.attributes("title")).toBe("## 摘要");
    expect(wrapper.get(".compaction-summary-body").text()).toBe("## 摘要");
  });
});

// pi gave up on a retryable error: the row has to say how many retries it made.
// The count is on the message (`auto_retry_end.attempt`) — the banner used to
// print a literal 0, so it read 「重试 0 次仍失败」 for every real failure.
describe("TurnBlock — pi's retry banner", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const withRetry = (attempt: number) =>
    mountTurn({
      leading: [
        {
          kind: "system",
          id: "sys-1",
          variant: "retry",
          text: "gateway down",
          timestamp: null,
          attempt,
        },
      ],
    });

  it("says how many attempts pi made before it gave up", () => {
    const wrapper = withRetry(2);

    expect(wrapper.get(".error-banner").text()).toBe(
      t("Error: Retry failed after {0} attempts: {1}", 2, "gateway down"),
    );
  });
});
