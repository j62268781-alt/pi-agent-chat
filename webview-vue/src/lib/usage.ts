// Token usage / cost accounting for the transcript and the context ring.
//
// Everything below reads the `usage` record pi reports on an assistant message
// (`input` / `output` / `cacheRead` / `cacheWrite` / `cost` / `turns` /
// `contextTokens`). It arrives untyped, so every field goes through `readUsage`
// rather than being trusted.
//
// Cache *misses* are not handled here: pi owns that (its `cache-stats` module,
// surfaced through `showCacheMissNotices`). This module only reports what the
// provider said it used, and derives the cache-read share of a prompt from it.

import { t } from "./i18n.ts";
import { formatTokens } from "./format.ts";

interface UsageNumbers {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  turns: number;
  contextTokens: number;
  /** `usage.cost` when it is a plain number. */
  costTotal: number | null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Normalize an untyped usage record; `null` when there is nothing to read. */
function readUsage(value: unknown): UsageNumbers | null {
  if (!value || typeof value !== "object") return null;
  const u = value as Record<string, unknown>;
  const cost = u.cost;
  return {
    input: num(u.input),
    output: num(u.output),
    cacheRead: num(u.cacheRead),
    cacheWrite: num(u.cacheWrite),
    turns: num(u.turns),
    contextTokens: num(u.contextTokens),
    costTotal: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
  };
}

/**
 * Summary text for one assistant message's usage, e.g.
 * `"1 Turn ↑12.3k ↓1.2k R8k W2k $0.0123 ctx:21k"`.
 *
 * The glyph format is kept from the original (`↑`/`↓` in/out, `R`/`W` cache
 * buckets, `ctx:` watermark, 4-decimal cost); only the turn word is localized.
 * The model name is not appended here — the caller renders it separately.
 */
export function formatUsage(usage: unknown): string {
  const u = readUsage(usage);
  if (!u) return "";
  const parts: string[] = [];
  if (u.turns) parts.push(u.turns + " " + (u.turns > 1 ? t("Turns") : t("Turn")));
  if (u.input) parts.push("\u2191" + formatTokens(u.input));
  if (u.output) parts.push("\u2193" + formatTokens(u.output));
  if (u.cacheRead) parts.push("R" + formatTokens(u.cacheRead));
  if (u.cacheWrite) parts.push("W" + formatTokens(u.cacheWrite));
  if (u.costTotal) parts.push("$" + u.costTotal.toFixed(4));
  if (u.contextTokens) parts.push("ctx:" + formatTokens(u.contextTokens));
  return parts.join(" ");
}

function promptTokensOf(u: UsageNumbers): number {
  return u.input + u.cacheRead + u.cacheWrite;
}

function hitPctOf(u: UsageNumbers): number | null {
  if (u.cacheRead <= 0 && u.cacheWrite <= 0) return null;
  const prompt = promptTokensOf(u);
  if (prompt <= 0) return null;
  return (u.cacheRead / prompt) * 100;
}

/** Cache-read share of the prompt in percent; `null` when it cannot be computed. */
export function computeCacheHitPct(usage: unknown): number | null {
  const u = readUsage(usage);
  return u ? hitPctOf(u) : null;
}

/** Entry shape: a message carrying `usage`, or a bare usage record. */
function usageOf(item: unknown): unknown {
  if (!item || typeof item !== "object") return null;
  return (item as Record<string, unknown>).usage ?? item;
}

/** Cumulative token/cost counters, e.g. for the context ring tooltip. */
export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

/**
 * Sum the usage of message-like entries (each contributing its `usage` field)
 * or of bare usage records. Entries without numbers are skipped.
 */
export function aggregateUsage(messages: readonly unknown[]): UsageTotals {
  const total: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const message of messages) {
    const u = readUsage(usageOf(message));
    if (!u) continue;
    total.input += u.input;
    total.output += u.output;
    total.cacheRead += u.cacheRead;
    total.cacheWrite += u.cacheWrite;
    if (u.costTotal != null) total.cost += u.costTotal;
  }
  return total;
}
