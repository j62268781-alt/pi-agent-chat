// Form <-> models.json conversions shared by the models editors.

/**
 * Render a header record as the `KEY: VALUE` text the editable field shows.
 */
export function headersToText(headers: Record<string, string> | undefined): string {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

/**
 * Parse the header editor's text back into a record; `null` when empty, which
 * is how the host's `sanitizeUpdates` clears the field on save.
 */
export function readHeadersField(text: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf(":");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key) result[key] = value;
  }
  return Object.keys(result).length === 0 ? null : result;
}

/** `null`/`""` collapses to `null` so an empty box clears the number field. */
export function numberOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Positive integers only — contexts and token budgets reject 0 and negatives. */
export function positiveIntOrNull(text: string): number | null {
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Parse an optional JSON box; `undefined` means "invalid" (caller reports it). */
export function parseOptionalJson(text: string): { value: unknown; ok: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, ok: true };
  try {
    return { value: JSON.parse(trimmed), ok: true };
  } catch {
    return { value: null, ok: false };
  }
}
