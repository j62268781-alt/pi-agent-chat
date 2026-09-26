// The files a turn changed, derived from the turn's own tool blocks.
//
// The panel already holds both halves: the tool call's `args.path` names the
// file, and pi's `details.diff` — parsed into `added` / `removed` / `diffText` —
// carries the numbers. What it does not hold is a diff for `write`: pi returns
// `details: undefined` for it (verified in `dist/core/tools/write.js`), so a
// created or rewritten file has no line counts and the row has to say so
// instead of inventing a number.
//
// Pure, so the grouping rules are testable without a DOM.

import type { Turn } from "@/stores/transcript.ts";
import { toolPathArg } from "./tool-format.ts";

/** The tools whose result puts a file on disk. */
const FILE_TOOLS = new Set(["edit", "write"]);

export interface TurnFileChange {
  /** As the tool was given it — relative when the model passed a relative path. */
  path: string;
  added: number;
  removed: number;
  /** A `write` touched this file, so the counts (if any) are only part of it. */
  written: boolean;
  /** The turn's unified diffs for this file, in call order. Empty for `write`. */
  diff: string;
}

export interface TurnFiles {
  files: TurnFileChange[];
  added: number;
  removed: number;
}

/**
 * One row per file, in the order the turn first touched it.
 *
 * A change that failed is left out: the file was not written, and the block's
 * `added`/`removed` are 0 anyway (no diff came back). Blocks are read from both
 * halves of the turn because which one holds a tool block depends on where the
 * fold drew its line.
 */
export function collectTurnFiles(turn: Turn): TurnFiles {
  const byPath = new Map<string, TurnFileChange>();

  for (const { block } of [...turn.workBlocks, ...turn.finalBlocks]) {
    if (block.kind !== "tool") continue;
    if (!FILE_TOOLS.has(block.name)) continue;
    if (block.status === "error") continue;

    const path = block.args ? toolPathArg(block.args) : "";
    if (!path) continue;

    let file = byPath.get(path);
    if (!file) {
      file = { path, added: 0, removed: 0, written: false, diff: "" };
      byPath.set(path, file);
    }

    file.added += block.added;
    file.removed += block.removed;
    if (block.name === "write") file.written = true;
    if (block.diffText) file.diff = file.diff ? `${file.diff}\n${block.diffText}` : block.diffText;
  }

  const files = [...byPath.values()];
  return {
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
  };
}
