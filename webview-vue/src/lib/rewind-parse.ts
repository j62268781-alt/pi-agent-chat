// Parsing for the `rewind-files` widget payload.
//
// Ported from the vanilla-TS chat bundle (`rewind.ts`: `applyRewindWidget`).
// The host sends the whole card as JSON in `widgetLines[0]`; this module turns
// that into the structured `RewindFile` rows the store renders. Pure functions
// only — no DOM, no store access — so they can be unit-tested directly.

import type { RewindFile } from "@/stores/overlays.ts";
import { shortenWorkspacePath } from "./paths.ts";

export interface RewindTotals {
  added: number;
  removed: number;
}

export interface ParsedRewindWidget {
  sessionId: string;
  files: RewindFile[];
  totals: RewindTotals;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Finite, non-negative whole number, else `0` (the original rendered `-`). */
function toCount(value: unknown): number {
  if (typeof value !== "number" || !isFinite(value) || value <= 0) return 0;
  return Math.trunc(value);
}

function toHash(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * `["{\"sessionId\":…,\"files\":[…],\"totals\":{…}}"]` -> rows.
 *
 * Returns `null` when the widget must be hidden, mirroring the original: an
 * empty `lines`, malformed JSON, or a payload without files all clear the card.
 */
export function parseRewindWidget(lines: string[]): ParsedRewindWidget | null {
  const first = lines[0];
  if (!first) return null;

  let data: unknown;
  try {
    data = JSON.parse(first);
  } catch {
    return null;
  }
  const payload = asRecord(data);
  if (!payload) return null;

  const rawFiles = Array.isArray(payload.files) ? payload.files : [];
  const files: RewindFile[] = [];
  for (const raw of rawFiles) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const absPath = typeof entry.absPath === "string" ? entry.absPath : "";
    files.push({
      id: toCount(entry.id),
      path: shortenWorkspacePath(absPath),
      absPath,
      baselineHash: toHash(entry.baselineHash),
      added: toCount(entry.added),
      removed: toCount(entry.removed),
    });
  }
  if (files.length === 0) return null;

  const totals = asRecord(payload.totals);
  return {
    sessionId: typeof payload.sessionId === "string" ? payload.sessionId : "",
    files,
    totals: {
      added: toCount(totals?.added),
      removed: toCount(totals?.removed),
    },
  };
}
