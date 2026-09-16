// Token usage / cost accounting for the transcript and the context ring.
//
// Ported from the vanilla-TS chat bundle: `messages.ts` (`formatUsage`,
// `computeCacheHitPct`, `promptTokensOf`, `detectCacheMiss`,
// `recordCacheUsage`, `seedCacheBaseline`, `aggregateUsage`) plus the
// `cacheReadPricePerM` helper that read `state.model.cost`.
//
// State-management choice: the original kept the cache baseline in module-level
// mutable globals (`prevTurn` / `latestCacheHitPct` in `globals.ts`) and
// `recordCacheUsage` also toasted and repainted the context ring. Instead of a
// class, a closure factory returns a `CacheTracker` object that owns exactly
// that state, so the module stays side-effect free and several trackers can
// coexist (e.g. main transcript + a replayed history). DOM work (toast, ring
// tooltip) stays in the UI, which drives it from `record()` / `lastMiss`.

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
  /** `usage.cost` when it carries the per-bucket breakdown. */
  costBreakdown: { input: number; cacheRead: number; cacheWrite: number } | null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Normalize an untyped usage record; `null` when there is nothing to read. */
function readUsage(value: unknown): UsageNumbers | null {
  if (!value || typeof value !== "object") return null;
  const u = value as Record<string, unknown>;
  const cost = u.cost;
  let costTotal: number | null = null;
  let costBreakdown: { input: number; cacheRead: number; cacheWrite: number } | null = null;
  if (typeof cost === "number" && Number.isFinite(cost)) {
    costTotal = cost;
  } else if (cost && typeof cost === "object") {
    const breakdown = cost as Record<string, unknown>;
    costBreakdown = {
      input: num(breakdown.input),
      cacheRead: num(breakdown.cacheRead),
      cacheWrite: num(breakdown.cacheWrite),
    };
  }
  return {
    input: num(u.input),
    output: num(u.output),
    cacheRead: num(u.cacheRead),
    cacheWrite: num(u.cacheWrite),
    turns: num(u.turns),
    contextTokens: num(u.contextTokens),
    costTotal,
    costBreakdown,
  };
}

/**
 * Summary text for one assistant message's usage, e.g.
 * `"1 Turn ↑12.3k ↓1.2k R8k W2k $0.0123 ctx:21k"`.
 *
 * The glyph format is kept from the original (`↑`/`↓` in/out, `R`/`W` cache
 * buckets, `ctx:` watermark, 4-decimal cost); only the turn word is localized.
 * The model name is no longer appended here — the caller renders it separately.
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

function hitPctOf(u: UsageNumbers): number | null {
  const cacheRead = u.cacheRead;
  const cacheWrite = u.cacheWrite;
  if (cacheRead <= 0 && cacheWrite <= 0) return null;
  const prompt = u.input + cacheRead + cacheWrite;
  if (prompt <= 0) return null;
  return (cacheRead / prompt) * 100;
}

/** Cache-read share of the prompt in percent; `null` when it cannot be computed. */
export function computeCacheHitPct(usage: unknown): number | null {
  const u = readUsage(usage);
  return u ? hitPctOf(u) : null;
}

function promptTokensOf(u: UsageNumbers): number {
  return u.input + u.cacheRead + u.cacheWrite;
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
 * or of bare usage records. Entries without numbers are skipped, where the
 * original dereferenced `.usage` unconditionally.
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

/** Details of a detected cache miss, enough to build the warning notice. */
export interface CacheMiss {
  /** Localized headline, e.g. `"Cache miss after model switch"`. */
  label: string;
  missedTokens: number;
  missedCost: number;
}

/** Rolling cache-hit tracker; replaces the old `prevTurn`/`latestCacheHitPct` globals. */
export interface CacheTracker {
  /**
   * Feed one assistant usage. Returns `true` when this turn looks like a cache
   * miss (the UI may then surface `lastMiss`).
   */
  record(usage: unknown, model: string, timestamp: number | undefined): boolean;
  /** Miss from the latest `record()`; `null` when the last turn was fine. */
  readonly lastMiss: CacheMiss | null;
  /** Current hit rate in percent; `null` without data. */
  hitPercent(): number | null;
  reset(): void;
}

/** Options for `createCacheTracker`. */
export interface CacheTrackerOptions {
  /**
   * Fallback cache-read price per million tokens, used when a usage carries no
   * cost breakdown. The original took this from the selected model's cost
   * table (`state.model.cost.cacheRead`), which this module cannot reach.
   */
  cacheReadPricePerM?: number | null;
}

interface PrevTurn {
  promptTokens: number;
  modelId: string;
  ts: number;
  reportedCache: boolean;
}

/**
 * The original `detectCacheMiss`: a turn is reported when the prompt shrank the
 * cached prefix by more than 1k tokens and either 20k tokens were re-billed or
 * the surcharge tops $0.10.
 */
function detectCacheMiss(
  usage: UsageNumbers,
  modelId: string,
  ts: number | undefined,
  prev: PrevTurn,
  cacheReadPricePerM: number | null,
): CacheMiss | null {
  if (typeof ts === "number" && ts === prev.ts) return null;
  const promptTokens = promptTokensOf(usage);
  if (promptTokens <= 0) return null;
  if (usage.cacheRead + usage.cacheWrite === 0 && !prev.reportedCache) return null;
  const missedTokens = Math.min(prev.promptTokens, promptTokens) - usage.cacheRead;
  if (missedTokens <= 1024) return null;
  const paidTokens = usage.input + usage.cacheWrite;
  const paidPerToken =
    usage.costBreakdown && paidTokens > 0
      ? (usage.costBreakdown.input + usage.costBreakdown.cacheWrite) / paidTokens
      : 0;
  let readPerToken = 0;
  if (usage.cacheRead > 0 && usage.costBreakdown) {
    readPerToken = usage.costBreakdown.cacheRead / usage.cacheRead;
  } else if (cacheReadPricePerM != null && cacheReadPricePerM > 0) {
    readPerToken = cacheReadPricePerM / 1000000;
  }
  const missedCost = missedTokens * Math.max(0, paidPerToken - readPerToken);
  const showByTokens = missedTokens >= 20000;
  const showByCost = missedCost >= 0.1;
  if (!showByTokens && !showByCost) return null;
  const idleMs = typeof ts === "number" ? ts - prev.ts : 0;
  const modelChanged = !!modelId && !!prev.modelId && modelId !== prev.modelId;
  let label: string;
  if (modelChanged) label = t("Cache miss after model switch");
  else if (idleMs >= 300000) label = t("Cache miss after {0}m idle", Math.round(idleMs / 60000));
  else label = t("Cache miss");
  return { label, missedTokens, missedCost };
}

interface TrackerHandle {
  tracker: CacheTracker;
  /** Adopt a baseline turn without reporting anything (history replay). */
  seed(usage: unknown, modelId: string, timestamp: number | undefined): void;
}

function buildTracker(options: CacheTrackerOptions): TrackerHandle {
  let prev: PrevTurn | null = null;
  let pct: number | null = null;
  let lastMiss: CacheMiss | null = null;
  const cacheReadPricePerM = options.cacheReadPricePerM ?? null;

  function seed(usage: unknown, modelId: string, timestamp: number | undefined): void {
    const u = readUsage(usage);
    pct = u ? hitPctOf(u) : null;
    lastMiss = null;
    prev = u
      ? {
          promptTokens: promptTokensOf(u),
          modelId,
          ts: typeof timestamp === "number" ? timestamp : Date.now(),
          reportedCache: u.cacheRead + u.cacheWrite > 0,
        }
      : null;
  }

  const tracker: CacheTracker = {
    get lastMiss(): CacheMiss | null {
      return lastMiss;
    },
    record(usage, model, timestamp) {
      const u = readUsage(usage);
      pct = u ? hitPctOf(u) : null;
      lastMiss = null;
      if (!u) {
        prev = null;
        return false;
      }
      if (prev && (typeof timestamp !== "number" || timestamp !== prev.ts)) {
        lastMiss = detectCacheMiss(u, model, timestamp, prev, cacheReadPricePerM);
      }
      prev = {
        promptTokens: promptTokensOf(u),
        modelId: model || "",
        ts: typeof timestamp === "number" ? timestamp : Date.now(),
        reportedCache: (prev?.reportedCache ?? false) || u.cacheRead + u.cacheWrite > 0,
      };
      return lastMiss !== null;
    },
    hitPercent() {
      return pct;
    },
    reset() {
      prev = null;
      pct = null;
      lastMiss = null;
    },
  };

  return { tracker, seed };
}

/** Fresh tracker with no baseline (live streaming). */
export function createCacheTracker(options: CacheTrackerOptions = {}): CacheTracker {
  return buildTracker(options).tracker;
}

/**
 * Tracker seeded from a loaded transcript: the last usable assistant message
 * becomes the baseline, so the first live turn is compared against it — the old
 * `seedCacheBaseline`. Its model id comes from the message's own `model` field
 * (the original used the globally selected model, which no longer exists here).
 */
export function createCacheTrackerWithBaseline(messages: readonly unknown[]): CacheTracker {
  const handle = buildTracker({});
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    if (record.role !== "assistant" || record.stopReason === "error") continue;
    const usage = record.usage;
    const u = readUsage(usage);
    if (!u) continue;
    if (!u.input && !u.output && !u.cacheRead && !u.cacheWrite) continue;
    handle.seed(
      usage,
      typeof record.model === "string" ? record.model : "",
      typeof record.timestamp === "number" ? record.timestamp : undefined,
    );
    break;
  }
  return handle.tracker;
}
