// Formatting helpers shared by the chat transcript: timestamps, token counts and
// durations.
//
// Ported from the vanilla-TS chat bundle (`globals.ts`: `formatTime`,
// `formatTokens`; `messages.ts`: `formatDuration`). `formatWorkTitle` was dropped
// with the fold-header rework: the head is a single phrase now, so the
// turns/duration counters it assembled have no call site left.

import { t } from "./i18n.ts";

const pad2 = (value: number): string => (value < 10 ? `0${value}` : String(value));

/** 24h `HH:mm` — the one clock every timestamp uses (no AM/PM, 彬哥). */
export function formatClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * `HH:mm` for today, `YYYY-MM-DD HH:mm` otherwise — always 24h. Invalid input
 * yields `""`.
 */
export function formatTime(ts: number | null | undefined): string {
  if (ts == null || typeof ts !== "number" || !isFinite(ts)) return "";
  const date = new Date(ts);
  const now = new Date();
  const clock = formatClock(date);
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return clock;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clock}`;
}

/** `1234` -> `"1.2k"`, `1234567` -> `"1.2M"`. */
export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return (count / 1000).toFixed(1) + "k";
  if (count < 1000000) return Math.round(count / 1000) + "k";
  return (count / 1000000).toFixed(1) + "M";
}

/** Milliseconds -> `"1m 5s"` / `"12s"` / `"<1s"`, localized via `t()`. */
export function formatDuration(ms: number): string {
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 1) return ms > 0 ? t("<1s") : t("0s");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return t("{0}h {1}m {2}s", h, m, sec);
  if (m > 0) return t("{0}m {1}s", m, sec);
  return t("{0}s", sec);
}

/** Diff counters, e.g. `"+45 -12"`; `""` when both are zero. */
export function formatCounts(added: number, removed: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push("+" + added);
  if (removed > 0) parts.push("-" + removed);
  return parts.join(" ");
}
