// Dialog option labels arrive as English sentences from whichever pi extension
// raised the prompt — the permission gate's four choices are the common case.
// They are translated for display only: the string sent back over the wire has
// to stay the one that extension matches on, so this never rewrites the value.

import { t } from "./i18n.ts";

/**
 * The permission gate's session-grant family — `Yes, allow tool "web_search"
 * for this session`, and the bash / path / mcp / skill variants of the same
 * sentence (`@gotgenes/pi-permission-system`'s `pattern-suggest`).
 */
const ALLOW_SESSION = /^Yes, allow (.+) for this session$/;

/**
 * Localized label for one `ui.select` option.
 *
 * Unknown options pass through untouched, which is what makes this safe for
 * prompts this webview has never seen: `t()` falls back to its key, so an
 * unrecognised option renders exactly as the plugin wrote it.
 */
export function dialogOptionLabel(option: string): string {
  const allow = ALLOW_SESSION.exec(option);
  if (allow?.[1]) return t("Yes, allow {0} for this session", allow[1]);
  return t(option);
}
