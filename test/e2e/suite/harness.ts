// Helpers that only make sense inside the VS Code extension host. Kept free of
// fixture knowledge so the cases read as assertions, not plumbing.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { readRpcTrace, type RpcTraceEntry } from "../rpc-log.ts";

/**
 * Fixture paths reach the extension host through `extensionTestsEnv`, which
 * @vscode/test-electron applies via `cp.spawn`'s env (out/runTest.js). A missing
 * key therefore means the env did not propagate at all — say so loudly instead
 * of letting a later assertion fail on `undefined`.
 */
export function env(name: string): string {
  const value = process.env[name];
  if (value) return value;
  const known = Object.keys(process.env)
    .filter((key) => key.startsWith("PI_E2E_"))
    .join(", ");
  throw new Error(
    `${name} is missing from the extension host environment; extensionTestsEnv ` +
      `did not propagate. PI_E2E_* keys seen: ${known || "(none)"}`,
  );
}

export const repoRoot = (): string => env("PI_E2E_REPO");
export const workspaceDir = (): string => env("PI_E2E_WORKSPACE");
export const sessionsDir = (): string => env("PI_E2E_SESSIONS");

/**
 * Every file under `dir`, recursively. pi's session layout is not part of our
 * contract, so callers assert on "something landed", never on a filename.
 */
export function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(full));
    else found.push(full);
  }
  return found;
}

/** The `message` payload of one record in a pi session transcript. */
export interface TranscriptMessage {
  role?: string;
  content?: unknown;
  /** pi's own end marker for the message: "stop" when the model finished, "aborted" when the turn was cancelled. */
  stopReason?: string;
}

export interface TranscriptRecord {
  /** pi's record kind: "session", "model_change", "thinking_level_change", "message", ... */
  type?: string;
  message?: TranscriptMessage;
}

export interface SessionTranscript {
  file: string;
  records: TranscriptRecord[];
  /** Lines that did not parse as JSON (1-based line numbers); a real transcript has none. */
  malformed: Array<{ line: number; text: string }>;
}

/**
 * Decode pi's session transcript(s) under `dir`. Observed on pi 0.85.1
 * (2026-09-18, both a standalone reproduction and a `--keep` harness fixture):
 * one `.jsonl` file, one JSON record per line — a `session` header, then
 * `model_change` / `thinking_level_change`, then one `message` record per
 * conversation message wrapping `{role, content, stopReason}`. The assistant
 * record of a mid-stream abort carries `stopReason: "aborted"`; its `content`
 * is a partial fragment (a lone thinking block was measured once) but is not
 * asserted on — only the marker is.
 *
 * No wait is needed around this read: at 5ms granularity the record hit the
 * file BEFORE pi emitted the turn's `message_end`/`agent_settled` on stdout,
 * and the suite only observes those events a process hop later. A malformed
 * line is reported rather than thrown, so "this parses as JSONL" is an
 * assertion the caller can make.
 */
export function readTranscripts(dir: string): SessionTranscript[] {
  return filesUnder(dir)
    .filter((file) => file.endsWith(".jsonl"))
    .map((file) => {
      const records: TranscriptRecord[] = [];
      const malformed: SessionTranscript["malformed"] = [];
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((text, index) => {
          if (!text.trim()) return;
          try {
            records.push(JSON.parse(text) as TranscriptRecord);
          } catch {
            malformed.push({ line: index + 1, text });
          }
        });
      return { file, records, malformed };
    });
}

export const userDataDir = (): string => env("PI_E2E_USER_DATA");

/** Snapshot of the RPC channel log as it currently exists on disk. */
export function rpcEntries(): RpcTraceEntry[] {
  return readRpcTrace(userDataDir());
}

/**
 * Polls the trace log until `predicate` holds, then returns that snapshot.
 *
 * This replaces the old `ps`-based liveness check: pi rewrites its process title
 * and wipes argv, so argv matching only works for a few hundred milliseconds
 * after spawn (FINDINGS §11.4). An inbound line in this log proves both that pi
 * is alive and that it is speaking the protocol.
 *
 * The channel is flushed asynchronously (FINDINGS §11.1), so every wait re-reads
 * rather than reading once. pi needs ~4.5s before its first response
 * (FINDINGS §11.2) — budget accordingly.
 */
export async function waitForRpc(
  predicate: (entries: RpcTraceEntry[]) => boolean,
  opts: { timeoutMs: number; intervalMs?: number; what?: string },
): Promise<RpcTraceEntry[]> {
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + opts.timeoutMs;
  let latest = rpcEntries();
  for (;;) {
    if (predicate(latest)) return latest;
    if (Date.now() > deadline) {
      const tail = latest
        .slice(-20)
        .map((e) => `${e.direction}:${e.raw.slice(0, 80)}`)
        .join("\n  ");
      throw new Error(
        `timed out after ${opts.timeoutMs}ms waiting for ${opts.what ?? "RPC condition"}. ` +
          `Trace had ${latest.length} line(s); last ${Math.min(latest.length, 20)}:\n  ${tail || "(none)"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    latest = rpcEntries();
  }
}

/** Dev-harness stimulus: dispatch a message as if the webview had sent it. */
export async function sendWebviewMessage(msg: unknown): Promise<void> {
  await vscode.commands.executeCommand("pi-agent-chat.__webviewMessage", JSON.stringify(msg));
}
