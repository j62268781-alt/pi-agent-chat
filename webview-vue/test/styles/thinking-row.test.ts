// One ring per running row.
//
// The reasoning row draws its state in `.row-state` (✓ / ✕ / ring), the same
// slot the tool rows use. It used to *also* carry its own `::after` ring pushed
// to the right edge by `margin-left: auto`; when the slot arrived the two were
// left side by side, so a single 「思考中」 row span two spinners. The stylesheet
// contract is what catches a duplicate reappearing — jsdom does not lay it out.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chat = readFileSync("src/styles/chat.css", "utf8");

/** Every `selector { … }` pair, comments dropped, in source order. */
function rules(css: string) {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? "").split(",").map((part) => part.replace(/\s+/g, " ").trim()),
    body: match[2] ?? "",
  }));
}

describe("thinking row — one ring", () => {
  it("draws it in the shared row-state slot", () => {
    const slot = rules(chat).find((rule) => rule.selectors.includes(".row-state.is-running"));

    expect(slot?.body).toContain("animation: tool-spin");
  });

  it("keeps a second ring off the row's right edge", () => {
    expect(chat).not.toContain(".thinking-block.is-running > summary::after");
    const stray = rules(chat).filter(
      (rule) =>
        rule.body.includes("animation: tool-spin") &&
        rule.selectors.some((selector) => selector.startsWith(".thinking-block")),
    );

    expect(stray).toEqual([]);
  });
});
