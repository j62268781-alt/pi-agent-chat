// The ask card is a surface over the composer, not a modal over the panel.
//
// Both halves of that are contracts a later edit can quietly break: the card
// has to stay pinned to the composer's own inset (or it stops covering the input
// box and starts floating over the transcript), and it has to stay above the
// queue that also lives in that dock. The rest of the file is the row recipe
// from the reference card — numbered circle, bold label, grey hint, one ink per
// option tone — which is only legible here: jsdom resolves no cascade.

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

/** Every declaration block written for an exact selector, in source order. */
function declarations(css: string, selector: string): string {
  return rules(css)
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.body)
    .join("\n");
}

const dock = declarations(chat, ".ask-dock");
const card = declarations(chat, ".ask-card");

describe("ask card placement", () => {
  it("sits on the composer's own inset, so it lands on the input box", () => {
    expect(dock).toContain("position: absolute");
    expect(dock).toContain("left: var(--pi-composer-pad)");
    expect(dock).toContain("right: var(--pi-composer-pad)");
    expect(dock).toContain("bottom: var(--pi-composer-pad)");
    // The dock itself is what defines that inset, and it is the positioning
    // context — without `relative` the card would escape to the page.
    expect(declarations(chat, ".composer-dock")).toContain("position: relative");
  });

  it("stays above the queue, which floats in the same dock", () => {
    const zIndex = (body: string): number =>
      Number(/z-index:\s*(-?\d+)/.exec(body)?.[1] ?? Number.NaN);

    expect(zIndex(dock)).toBeGreaterThan(zIndex(declarations(chat, ".queue")));
  });

  it("is an opaque, self-scrolling surface", () => {
    // Painted over the transcript: a translucent card would put two texts on
    // top of each other.
    expect(card).toContain("background: var(--pi-bg-raised)");
    expect(card).toContain("max-height: 60vh");
    expect(card).toContain("overflow-y: auto");
  });
});

describe("ask card rows", () => {
  it("paints the option tone on the numbered marker only", () => {
    expect(declarations(chat, ".ask-row.is-allow .ask-num")).toContain("var(--pi-success)");
    expect(declarations(chat, ".ask-row.is-block .ask-num")).toContain("var(--pi-danger)");
    // The row's own text is never tinted: 允许 must not look like the default.
    expect(declarations(chat, ".ask-row.is-allow")).toBe("");
  });

  it("keeps the reference card's row recipe", () => {
    expect(declarations(chat, ".ask-row")).toContain("min-height: var(--pi-h-row)");
    expect(declarations(chat, ".ask-num")).toContain("border-radius: 50%");
    expect(declarations(chat, ".ask-label")).toContain("font-weight: 600");
    expect(declarations(chat, ".ask-hint")).toContain("var(--pi-text-muted)");
  });

  it("dresses the card's advance button like the composer's send", () => {
    const advance = declarations(chat, ".ask-advance");

    expect(advance).toContain("background: var(--pi-send-bg)");
    expect(advance).toContain("color: var(--pi-send-fg)");
    expect(advance).toContain("width: var(--pi-h-chat-control)");
  });
});

describe("the dialogs the card replaced", () => {
  it("leaves no rules behind for the button group they used", () => {
    expect(chat).not.toContain(".choice-btn");
    expect(chat).not.toContain("choice-group");
  });

  it("keeps the transcript card's own classes and drops the dialog's", () => {
    expect(chat).toContain(".qa-card-option");
    expect(chat).not.toContain(".qa-option");
    expect(chat).not.toContain(".qa-actions");
  });
});
