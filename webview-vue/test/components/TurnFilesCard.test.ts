// The end-of-turn card: which files this turn touched, and a way in.
//
// Read-only by design — the numbers come from the turn's own tool blocks (see
// `lib/turn-files.ts`), clicking a row opens the file, and the expandable body
// shows the turn's own unified diff. Nothing here reverts anything.

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import { collectTurnFiles } from "@/lib/turn-files.ts";
import type { ToolBlock, Turn } from "@/stores/transcript.ts";
import TurnFilesCard from "@/components/TurnFilesCard.vue";

vi.mock("@/lib/bridge.ts", () => ({
  post: vi.fn(),
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

const DIFF_A = "@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;";

/** One `edit` block, in the shape the store hands the turn. */
const editedEntry = (): Turn["workBlocks"][number] => {
  const block: ToolBlock = {
    kind: "tool",
    id: "t1",
    name: "edit",
    argsText: "",
    args: { path: "src/a.ts" },
    status: "done",
    startedAt: 1,
    durationMs: 10,
    output: "",
    diffText: DIFF_A,
    writeContent: "",
    added: 2,
    removed: 1,
    filePath: null,
    fileLine: null,
    subagent: null,
    questionnaire: null,
  };
  return {
    message: {
      kind: "assistant",
      id: "asst-1",
      timestamp: 1,
      model: "m",
      blocks: [block],
      usage: null,
      stopReason: null,
      errorMessage: null,
    },
    block,
  };
};

const EDITED = collectTurnFiles({
  id: "turn-1",
  user: null,
  leading: [],
  workBlocks: [editedEntry()],
  finalBlocks: [],
  workStartedAt: 1,
  workEndedAt: 2,
  added: 0,
  removed: 0,
  messageTime: null,
  stopReason: null,
  errorMessage: null,
});

describe("TurnFilesCard", () => {
  it("stays out of the way when the turn changed nothing", () => {
    const wrapper = mount(TurnFilesCard, {
      props: { changes: { files: [], added: 0, removed: 0 } },
    });

    expect(wrapper.find(".turn-files").exists()).toBe(false);
  });

  it("counts the files and the lines it knows about", () => {
    const wrapper = mount(TurnFilesCard, { props: { changes: EDITED } });

    expect(wrapper.get(".turn-files-title").text()).toBe(t("Edited {0} file{1}", 1, ""));
    expect(wrapper.get(".turn-files-totals").text()).toContain("+2");
    expect(wrapper.get(".turn-files-totals").text()).toContain("-1");
  });

  it("names each file once, relative to the workspace", () => {
    const wrapper = mount(TurnFilesCard, { props: { changes: EDITED } });

    expect(wrapper.get(".turn-files-row").text()).toContain("src/a.ts");
  });

  it("opens the file when its row is clicked", async () => {
    const wrapper = mount(TurnFilesCard, { props: { changes: EDITED } });

    await wrapper.get(".turn-files-open").trigger("click");

    expect(post).toHaveBeenCalledWith({ type: "openFile", filePath: "src/a.ts", line: null });
  });

  it("keeps the diff folded until it is asked for", async () => {
    const wrapper = mount(TurnFilesCard, { props: { changes: EDITED } });
    expect(wrapper.find(".diff-block").exists()).toBe(false);

    await wrapper.get(".turn-files-diff-toggle").trigger("click");

    expect(wrapper.get(".diff-block").text()).toContain("const b = 3;");
    expect(wrapper.findAll(".diff-line.added")).toHaveLength(1);
    expect(wrapper.findAll(".diff-line.removed")).toHaveLength(1);
  });

  it("folds the whole list away and back", async () => {
    const wrapper = mount(TurnFilesCard, { props: { changes: EDITED } });

    await wrapper.get(".turn-files-head-toggle").trigger("click");
    expect(wrapper.find(".turn-files-row").exists()).toBe(false);
    expect(wrapper.get(".turn-files-head-toggle").attributes("title")).toBe(t("Expand"));

    await wrapper.get(".turn-files-head-toggle").trigger("click");
    expect(wrapper.find(".turn-files-row").exists()).toBe(true);
  });

  it("says a written file has no line counts instead of showing a zero", () => {
    const wrapper = mount(TurnFilesCard, {
      props: {
        changes: {
          files: [{ path: "docs/new.md", added: 0, removed: 0, written: true, diff: "" }],
          added: 0,
          removed: 0,
        },
      },
    });

    expect(wrapper.get(".turn-files-tag").text()).toBe(t("Whole-file write"));
    expect(wrapper.find(".turn-files-diff-toggle").exists()).toBe(false);
    expect(wrapper.find(".turn-files-totals").exists()).toBe(false);
  });
});
