// Reader for the `pi-agent-chat.rpcTrace` output channel as it lands on disk.
//
// The channel mirrors every direction of the pi RPC conversation
// (src/services/rpc/client.ts:132 writes `out`, :88 writes each stdout line as
// `in`, :114 writes stderr as `[err]`), which makes this log the only
// host-side record of what the extension actually saw. It is also a better
// liveness signal than scanning processes: pi rewrites its own process title,
// so argv-based matching only works for a few hundred milliseconds after spawn
// (FINDINGS §11.4).
//
// Caveat that callers must respect: the channel is flushed asynchronously, so a
// run that exits quickly leaves a truncated file (FINDINGS §11.1).

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface RpcTraceEntry {
  tag: string;
  direction: "out" | "in" | "err";
  raw: string;
  json?: unknown;
}

const CHANNEL_SUFFIX = "Pi Chat RPC.log";
const LINE = /^\[([^\]]*)\]\s+(->|<-|\[err\])\s?(.*)$/;

export function parseRpcTrace(text: string): RpcTraceEntry[] {
  const entries: RpcTraceEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const match = LINE.exec(line);
    if (!match) {
      // Not one of ours (or an older format): keep it as an err-direction
      // entry so nothing is silently dropped.
      entries.push({ tag: "", direction: "err", raw: line });
      continue;
    }
    const [, tag = "", arrow = "", raw = ""] = match;
    const direction: RpcTraceEntry["direction"] =
      arrow === "->" ? "out" : arrow === "<-" ? "in" : "err";
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      // stderr and non-JSON payloads stay as raw text.
    }
    entries.push({ tag, direction, raw, ...(json === undefined ? {} : { json }) });
  }
  return entries;
}

/** Newest channel log under `<userDataDir>/logs`, or undefined before any write. */
export function findRpcLogPath(userDataDir: string): string | undefined {
  const logsRoot = join(userDataDir, "logs");
  if (!existsSync(logsRoot)) return undefined;

  let newest: { path: string; mtimeMs: number } | undefined;
  for (const session of readdirSync(logsRoot)) {
    for (const windowName of readdirSync(join(logsRoot, session))) {
      const exthost = join(logsRoot, session, windowName, "exthost");
      if (!existsSync(exthost)) continue;
      for (const outputDir of readdirSync(exthost)) {
        if (!outputDir.startsWith("output_logging_")) continue;
        const dir = join(exthost, outputDir);
        for (const name of readdirSync(dir)) {
          if (!name.endsWith(CHANNEL_SUFFIX)) continue;
          const path = join(dir, name);
          const mtimeMs = statSync(path).mtimeMs;
          if (!newest || mtimeMs > newest.mtimeMs) newest = { path, mtimeMs };
        }
      }
    }
  }
  return newest?.path;
}

export function readRpcTrace(userDataDir: string): RpcTraceEntry[] {
  const path = findRpcLogPath(userDataDir);
  if (!path) return [];
  return parseRpcTrace(readFileSync(path, "utf8"));
}

interface ResponseShape {
  type?: unknown;
  command?: unknown;
  success?: unknown;
  data?: unknown;
}

export function inboundResponses(
  entries: RpcTraceEntry[],
): Array<{ command: string; success: boolean; data: unknown }> {
  const found: Array<{ command: string; success: boolean; data: unknown }> = [];
  for (const entry of entries) {
    if (entry.direction !== "in") continue;
    const shape = entry.json as ResponseShape | undefined;
    if (!shape || shape.type !== "response") continue;
    found.push({
      command: String(shape.command ?? ""),
      success: shape.success === true,
      data: shape.data,
    });
  }
  return found;
}

/** Inbound lines that are neither a response nor a UI request: pi's agent events. */
export function inboundEvents(entries: RpcTraceEntry[]): string[] {
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.direction !== "in") continue;
    const type = (entry.json as { type?: unknown } | undefined)?.type;
    if (typeof type !== "string") continue;
    if (type === "response" || type === "extension_ui_request") continue;
    found.push(type);
  }
  return found;
}

export function inboundUiRequests(entries: RpcTraceEntry[]): Array<{ method: string }> {
  const found: Array<{ method: string }> = [];
  for (const entry of entries) {
    if (entry.direction !== "in") continue;
    const shape = entry.json as { type?: unknown; method?: unknown } | undefined;
    if (shape?.type !== "extension_ui_request") continue;
    found.push({ method: String(shape.method ?? "") });
  }
  return found;
}
