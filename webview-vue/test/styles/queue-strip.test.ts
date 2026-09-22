// The pending strip's two new rules of behaviour (彬哥 2026-09-22).
//
// 1. It is an overlay resting on the composer's top edge, so it covers the
//    transcript's bottom — and the live status row ("正在回复中") lives exactly
//    there. The transcript therefore reserves the card's height, published as
//    `--pi-queue-h`; without that inset the card is drawn over the row.
// 2. Three rows is the ceiling: a longer queue scrolls inside the card rather
//    than growing up the panel.
//
// jsdom resolves neither the cascade nor `:has()`, so both are checked on the
// stylesheet's text — the same contract style as the neighbouring suites.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chat = readFileSync("src/styles/chat.css", "utf8");

interface Rule {
  selectors: string[];
  body: string;
}

/** Every `selector { … }` pair, comments dropped, in source order. */
function rules(css: string): Rule[] {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? "").split(",").map((part) => part.replace(/\s+/g, " ").trim()),
    body: match[2] ?? "",
  }));
}

function declarations(css: string, selector: string): string {
  return rules(css)
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.body)
    .join("\n");
}

const queue = declarations(chat, ".queue");
const row = declarations(chat, ".queue-item");
const inner = declarations(chat, ".messages-inner:not(:has(.empty))");

describe("the queue strip", () => {
  it("shows three rows and scrolls after that", () => {
    // One named row height drives both: adding a fourth message must not make
    // the card taller, only scrollable.
    expect(row).toContain("min-height: var(--pi-queue-row)");
    expect(queue).toContain("max-height: calc(var(--pi-queue-row) * 3 + var(--pi-stroke))");
    expect(queue).toContain("overflow-y: auto");
    // No viewport-sized ceiling left over: 45vh covered the transcript.
    expect(queue).not.toContain("max-height: 45vh");
  });

  it("is carved out of the transcript, so the live status row stays visible", () => {
    expect(inner).toContain("padding-bottom: var(--pi-queue-h");
    // The empty guide is centred; the inset is scoped away from it.
    expect(chat).not.toMatch(/\.messages-inner\s*\{[^}]*padding-bottom:\s*var\(--pi-queue-h/);
  });
});
