// Presentation of tool calls: the one-line summary shown next to a tool name,
// the display name of MCP tools, and read-range / path helpers.
//
// Ported verbatim from the vanilla-TS chat bundle (`messages.ts`: `toolStr`,
// `toolPathArg`, `formatReadRange`, `isMcpTool`, `toolDisplayName`,
// `formatToolSummary`, `expandHomePath`). Pure string work — the original mixed
// these into DOM rendering, nothing here touches the DOM.

import { t } from "./i18n.ts";
import { homeDir, pathSep } from "./injected.ts";
import { shortenToolPath } from "./paths.ts";

/** Narrow an unknown call argument to the scalar `t()` accepts. */
function scalar(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

/** Truncate a preview with a trailing ellipsis. */
function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + "\u2026" : value;
}

/** String argument, or `""` for anything else. */
export function toolStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** File argument: `file_path` wins over `path`. */
export function toolPathArg(args: Record<string, unknown>): string {
  const p = args.file_path != null ? args.file_path : args.path;
  return typeof p === "string" ? p : "";
}

/** Read window suffix: `":10-20"` / `":10"` / `""`. */
export function formatReadRange(args: Record<string, unknown>): string {
  const rawOffset = args.offset;
  const rawLimit = args.limit;
  if (rawOffset === undefined && rawLimit === undefined) return "";
  const startLine = typeof rawOffset === "number" ? rawOffset : 1;
  if (typeof rawLimit !== "number") return ":" + startLine;
  return ":" + startLine + "-" + (startLine + rawLimit - 1);
}

/** MCP tools arrive either as `mcp__server__tool` or `mcp_tool_*`. */
export function isMcpTool(name: string): boolean {
  return name.startsWith("mcp__") || name.startsWith("mcp_tool_");
}

/** The display handle of a tool: `server/tool` for MCP, the raw name otherwise. */
export function toolHandle(name: string): string {
  if (name.startsWith("mcp__")) {
    const rest = name.slice(5);
    const idx = rest.indexOf("__");
    if (idx > 0) return `${rest.slice(0, idx)}/${rest.slice(idx + 2)}`;
  }
  return name;
}

/** Split a `server_tool` handle on its first underscore. */
function mcpHandleParts(handle: string): { server: string; tool: string } {
  const idx = handle.indexOf("_");
  if (idx <= 0) return { server: "", tool: handle };
  return { server: handle.slice(0, idx), tool: handle.slice(idx + 1) };
}

/**
 * Arguments of a call we have no wording for (an MCP tool, mostly), as one line.
 *
 * These arrived as raw JSON ("{\"query\":\"x\"}"), which is noise in a row that
 * is 300px wide: the value of the one argument that matters says more. When
 * nothing is scalar, the count does.
 */
const PREVIEW_KEYS = [
  "query",
  "q",
  "path",
  "file",
  "file_path",
  "prompt",
  "text",
  "command",
  "url",
  "name",
  "title",
  "id",
];

export function argsPreview(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const record = args as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) return "";

  for (const key of PREVIEW_KEYS) {
    const value = scalar(record[key]);
    if (value) return truncate(String(value), 80);
  }
  for (const key of keys) {
    const value = scalar(record[key]);
    if (value) return truncate(String(value), 80);
  }
  const first = record[keys[0] as string];
  if (Array.isArray(first)) return t("{0} items", first.length);
  return t("{0} arguments", keys.length);
}

/** One-line summary for a tool call; `""` when there is nothing to show. */
export function formatToolSummary(name: string, args: Record<string, unknown> | null): string {
  if (!args || typeof args !== "object") return "";
  let s = "";
  if (name === "bash") {
    s = truncate(toolStr(args.command), 80) || "...";
    const timeout = scalar(args.timeout);
    if (timeout) s += t(" (timeout {0}s)", timeout);
  } else if (name === "read") {
    s = shortenToolPath(toolPathArg(args)) || "...";
    const rng = formatReadRange(args);
    if (rng) s += rng;
  } else if (name === "write" || name === "edit") {
    s = shortenToolPath(toolPathArg(args)) || "...";
  } else if (name === "ls") {
    s = shortenToolPath(toolStr(args.path) || ".");
    const limit = scalar(args.limit);
    if (limit != null) s += t(" (limit {0})", limit);
  } else if (name === "find") {
    s = toolStr(args.pattern) + " " + t("in") + " " + shortenToolPath(toolStr(args.path) || ".");
    const limit = scalar(args.limit);
    if (limit != null) s += t(" (limit {0})", limit);
  } else if (name === "grep") {
    s =
      "/" +
      toolStr(args.pattern) +
      "/ " +
      t("in") +
      " " +
      shortenToolPath(toolStr(args.path) || ".");
    const glob = toolStr(args.glob);
    if (glob) s += " (" + glob + ")";
    const limit = scalar(args.limit);
    if (limit != null) s += " " + t("limit {0}", limit);
  } else if (name === "subagent") {
    const tasks = Array.isArray(args.tasks) ? args.tasks : null;
    const agent = toolStr(args.agent);
    if (tasks && tasks.length) {
      s =
        t("parallel") +
        " \u00b7 " +
        tasks.length +
        (tasks.length > 1 ? " " + t("tasks") : " " + t("task"));
    } else if (agent) {
      s = agent;
      let title = toolStr(args.title);
      const task = toolStr(args.task);
      if (!title && task) title = truncate(task, 60);
      if (title) s += " \u00b7 " + title;
    } else {
      s = t("subagent");
    }
  } else if (name === "questionnaire") {
    const questions = Array.isArray(args.questions) ? args.questions.length : 0;
    s =
      questions > 0
        ? String(questions) + (questions > 1 ? " " + t("questions") : " " + t("question"))
        : t("questionnaire");
  } else if (name.startsWith("mcp__")) {
    s = argsPreview(args);
  } else if (name === "mcp_tool_call") {
    const handle = toolStr(args.tool);
    if (handle) {
      const parts = mcpHandleParts(handle);
      s = parts.server ? `${parts.server}/${parts.tool}` : handle;
    } else {
      s = "...";
    }
  } else if (name === "mcp_tool_search") {
    const query = toolStr(args.query);
    s = query ? `"${query}"` : "...";
    const opts: string[] = [];
    const limit = scalar(args.limit);
    const offset = scalar(args.offset);
    if (limit != null) opts.push(t("limit {0}", limit));
    if (offset != null) opts.push(t("offset {0}", offset));
    if (opts.length) s += ` (${opts.join(", ")})`;
  }
  return s;
}

/** Expand a leading `~` against the injected home directory. */
export function expandHomePath(path: string): string {
  if (typeof path !== "string" || !path) return "";
  const sep = pathSep();
  if (path.charAt(0) === "~" && (path.length === 1 || path.charAt(1) === sep)) {
    return homeDir() + path.slice(1);
  }
  return path;
}
