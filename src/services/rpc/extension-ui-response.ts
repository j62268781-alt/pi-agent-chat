// The answer sent back for one pi dialog (`extension_ui_request`).
//
// Kept out of `client.ts` so it can be unit-tested: that module pulls in
// `vscode` through its spawn helpers, this one only needs the protocol type.

import type { ExtensionUiResponse } from "../../protocol/rpc.ts";

/**
 * Map the webview's dialog answer onto pi's response union.
 *
 * The dialog buttons set `value` *and* `confirmed` on the same answer, while pi
 * reads exactly one of them depending on the request method — `value` for
 * `select` / `input` / `editor` (`"value" in response ? response.value :
 * undefined` in its RPC adapter), `confirmed` for `confirm`. So `value` has to
 * win: sending only `confirmed` for a select makes pi resolve the choice to
 * `undefined`, which is how clicking Allow on the permission gate came back as
 * a block — and how editor answers (the questionnaire form) were dropped.
 */
export function toExtensionUiResponse(
  id: string,
  payload: { value?: string; confirmed?: boolean; cancelled?: boolean },
): ExtensionUiResponse {
  const type = "extension_ui_response" as const;
  if (payload.cancelled) return { type, id, cancelled: true };
  if (payload.value !== undefined) return { type, id, value: payload.value };
  if (payload.confirmed !== undefined) return { type, id, confirmed: !!payload.confirmed };
  return { type, id, cancelled: true };
}
