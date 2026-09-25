// pi and its providers fail in English; the shapes that recur get a Chinese
// summary so the banner speaks the panel's language. Anything else is handed
// back untouched — a translated guess would hide which limit was hit.

import { describe, expect, it } from "vitest";
import { localizeError } from "@/lib/error-text.ts";
import { t } from "@/lib/i18n.ts";

describe("localizeError", () => {
  it("names the shapes that recur", () => {
    expect(localizeError("Request timed out.")).toBe(t("The request timed out."));
    expect(localizeError("429 Too Many Requests (retried 5 times)")).toBe(
      t("The provider is rate-limiting."),
    );
    expect(localizeError("401 Unauthorized")).toBe(t("The provider rejected the credentials."));
    expect(localizeError("Request was aborted")).toBe(t("The request was aborted."));
    expect(localizeError("502 Bad Gateway")).toBe(t("The provider returned a server error."));
  });

  it("keeps words it cannot place", () => {
    expect(localizeError("zsh: command not found: pi")).toBe("zsh: command not found: pi");
    expect(localizeError("   ")).toBe("");
  });
});
