// pi reports failures in English, and most of them are the provider's own words —
// "Request timed out.", a 429 body, an auth complaint — free text that cannot be
// translated word for word. The shapes that actually recur get a localized
// summary; everything else passes through untouched, because a translated guess
// is worse than the provider's own sentence.

import { t } from "./i18n.ts";

/** Matched in order: the specific shapes first, the generic ones last. */
const PATTERNS: Array<[RegExp, string]> = [
  [/timed? ?out|ETIMEDOUT|\btimeout\b/i, "The request timed out."],
  [/\b429\b|too many requests|rate ?limit/i, "The provider is rate-limiting."],
  [
    /\b401\b|\b403\b|unauthori[sz]ed|invalid api key|authentication/i,
    "The provider rejected the credentials.",
  ],
  [/aborted|cancell?ed/i, "The request was aborted."],
  [
    /\b5\d{2}\b|internal server error|bad gateway|service unavailable|overloaded/i,
    "The provider returned a server error.",
  ],
];

/**
 * A localized summary for a failure message, or the message itself when it is
 * not a shape we know. Callers keep the original around: the summary says what
 * happened, the original says which request and which limit.
 */
export function localizeError(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  for (const [pattern, key] of PATTERNS) {
    if (pattern.test(text)) return t(key);
  }
  return text;
}
