// What a turn changed on disk, read back out of the turn itself.
//
// The panel already holds every piece: the tool call's `args.path` names the
// file and pi's `details.diff` (parsed into `added`/`removed`/`diffText`) has
// the numbers — but only for `edit`. `write` returns `details: undefined`, so a
// file that was created or rewritten has no line counts at all; the row must say
// so rather than invent a number.

import { describe, expect, it } from "vitest";
import { collectTurnFiles } from "@/lib/turn-files.ts";
import type { Block, ToolBlock, Turn } from "@/stores/transcript.ts";

const DIFF_ONE = "@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d";

const tool = (over: Partial<ToolBlock>): ToolBlock => ({
  kind: "tool",
  id: "tool-1",
  name: "edit",
  argsText: "",
  args: { path: "src/a.ts" },
  status: "done",
  startedAt: 1,
  durationMs: 10,
  output: "",
  diffText: "",
  writeContent: "",
  added: 0,
  removed: 0,
  filePath: null,
  fileLine: null,
  subagent: null,
  questionnaire: null,
  ...over,
});

const entry = (block: Block): Turn["workBlocks"][number] => ({
  message: {
    kind: "assistant",
    id: `asst-${block.id}`,
    timestamp: 1,
    model: "m",
    blocks: [block],
    usage: null,
    stopReason: null,
    errorMessage: null,
  },
  block,
});

const turn = (blocks: Block[], final: Block[] = []): Turn => ({
  id: "turn-1",
  user: null,
  leading: [],
  workBlocks: blocks.map(entry),
  finalBlocks: final.map(entry),
  workStartedAt: 1,
  workEndedAt: 2,
  added: 0,
  removed: 0,
  messageTime: null,
  stopReason: null,
  errorMessage: null,
});

describe("collectTurnFiles", () => {
  it("reports nothing for a turn that changed no file", () => {
    expect(collectTurnFiles(turn([]))).toEqual({ files: [], added: 0, removed: 0 });
    expect(collectTurnFiles(turn([tool({ name: "read" })]))).toEqual({
      files: [],
      added: 0,
      removed: 0,
    });
  });

  it("lists an edited file with its counts and its diff", () => {
    const result = collectTurnFiles(turn([tool({ diffText: DIFF_ONE, added: 2, removed: 1 })]));

    expect(result.files).toEqual([
      { path: "src/a.ts", added: 2, removed: 1, written: false, diff: DIFF_ONE },
    ]);
    expect(result.added).toBe(2);
    expect(result.removed).toBe(1);
  });

  it("merges two edits of one file into a single row", () => {
    const result = collectTurnFiles(
      turn([
        tool({ id: "t1", diffText: DIFF_ONE, added: 2, removed: 1 }),
        tool({ id: "t2", diffText: DIFF_ONE, added: 3, removed: 0 }),
      ]),
    );

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.added).toBe(5);
    expect(result.files[0]?.removed).toBe(1);
    expect(result.files[0]?.diff).toBe(`${DIFF_ONE}\n${DIFF_ONE}`);
  });

  it("keeps one row per file, in the order they were first touched", () => {
    const result = collectTurnFiles(
      turn([
        tool({ id: "t1", args: { path: "b.ts" }, diffText: DIFF_ONE, added: 1, removed: 0 }),
        tool({ id: "t2", args: { path: "a.ts" }, diffText: DIFF_ONE, added: 1, removed: 0 }),
        tool({ id: "t3", args: { path: "b.ts" }, diffText: DIFF_ONE, added: 4, removed: 0 }),
      ]),
    );

    expect(result.files.map((file) => file.path)).toEqual(["b.ts", "a.ts"]);
  });

  it("marks a written file as having no line counts", () => {
    const result = collectTurnFiles(turn([tool({ name: "write", diffText: "", added: 0 })]));

    expect(result.files).toEqual([
      { path: "src/a.ts", added: 0, removed: 0, written: true, diff: "" },
    ]);
    expect(result.added).toBe(0);
  });

  it("keeps the edit's numbers when the same file was also written", () => {
    const result = collectTurnFiles(
      turn([
        tool({ id: "t1", name: "write", diffText: "", added: 0, removed: 0 }),
        tool({ id: "t2", diffText: DIFF_ONE, added: 2, removed: 1 }),
      ]),
    );

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ added: 2, removed: 1, written: true });
  });

  it("leaves out a change that failed", () => {
    const result = collectTurnFiles(
      turn([
        tool({ id: "t1", status: "error", diffText: DIFF_ONE, added: 9, removed: 9 }),
        tool({ id: "t2", args: { path: "src/b.ts" }, diffText: DIFF_ONE, added: 1, removed: 0 }),
      ]),
    );

    expect(result.files.map((file) => file.path)).toEqual(["src/b.ts"]);
    expect(result.added).toBe(1);
  });

  it("skips a file tool with no path to name", () => {
    const result = collectTurnFiles(turn([tool({ args: null, diffText: DIFF_ONE, added: 2 })]));

    expect(result.files).toEqual([]);
  });

  it("reads the answer's own blocks too, wherever the fold put them", () => {
    const result = collectTurnFiles(turn([], [tool({ diffText: DIFF_ONE, added: 2, removed: 1 })]));

    expect(result.files.map((file) => file.path)).toEqual(["src/a.ts"]);
  });
});
