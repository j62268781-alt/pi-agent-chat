// `git diff` text decomposition for the edit tool result block.
//
// Ported from the vanilla-TS chat bundle (`messages.ts`: `parseDiffLine`, the
// per-line branch chain inside `renderToolDiff`, and the `+`/`-` counting that
// `endToolExecution` did inline). Pure text processing — rows are returned as
// data so the component decides the markup.

/** One renderable line of a diff. */
export interface DiffRow {
  /** Row style. The original's separate `sign` glyph is implied by `kind`. */
  kind: "added" | "removed" | "context" | "hunk";
  /** Gutter text, possibly `""`. Already trimmed — callers must not trim again. */
  lineNumber: string;
  /** Line body. */
  content: string;
}

/**
 * Parse one `git diff`-style line into prefix / gutter number / content.
 * Returns `null` for lines that are not diff lines (or empty ones).
 */
export function parseDiffLine(
  line: string,
): { prefix: string; lineNum: string; content: string } | null {
  if (typeof line !== "string" || line.length === 0) return null;
  const prefix = line.charAt(0);
  if (prefix !== "+" && prefix !== "-" && prefix !== " ") return null;
  const rest = line.slice(1);
  let i = 0;
  while (i < rest.length) {
    const cc = rest.charCodeAt(i);
    if (cc === 32 || (cc >= 48 && cc <= 57)) i++;
    else break;
  }
  const lineNum = rest.slice(0, i);
  let content = rest.slice(i);
  if (content.charAt(0) === " ") content = content.slice(1);
  return { prefix, lineNum, content };
}

/** Parse a whole diff into rows, keeping the original branch order. */
export function parseDiffRows(diffText: string): DiffRow[] {
  const rows: DiffRow[] = [];
  const lines = diffText.split("\n");
  for (const line of lines) {
    const parsed = parseDiffLine(line);
    if (!parsed) {
      // Unparseable line (e.g. `diff --git`, `@@` hunks): context, no gutter.
      rows.push({ kind: "context", lineNumber: "", content: line });
    } else if (parsed.prefix === "+") {
      rows.push({ kind: "added", lineNumber: parsed.lineNum.trim(), content: parsed.content });
    } else if (parsed.prefix === "-") {
      rows.push({ kind: "removed", lineNumber: parsed.lineNum.trim(), content: parsed.content });
    } else if (parsed.content === "..." && parsed.lineNum.trim() === "") {
      rows.push({ kind: "hunk", lineNumber: "", content: "..." });
    } else {
      rows.push({ kind: "context", lineNumber: parsed.lineNum.trim(), content: parsed.content });
    }
  }
  return rows;
}

/** Added/removed line counts for a tool block's `+N` / `-N` counters. */
export function countDiffChanges(diffText: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diffText.split("\n")) {
    const ch = line.charAt(0);
    if (ch === "+" && line.charAt(1) !== "+") added++;
    else if (ch === "-" && line.charAt(1) !== "-") removed++;
  }
  return { added, removed };
}
