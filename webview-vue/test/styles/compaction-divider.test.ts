// The compaction divider's pulse and spacing belong to its text, not its label.
//
// The flanking rules are `.compaction-divider-label::before/::after`, so an
// `animation` on the label itself blinks the whole divider instead of the words.
// The row also used to lead with a codicon — the wording comes from Qoder's own
// panel (「正在压缩 / 已完成压缩」), whose glyph is not in `@vscode/codicons`, and
// 彬哥's call is that the label is text: no glyph to copy, none to invent.
//
// jsdom resolves neither the cascade nor the spacing, so these assertions run on
// the stylesheet contract.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chat = readFileSync("src/styles/chat.css", "utf8");
const template = readFileSync("src/components/TurnBlock.vue", "utf8");

/** Every `selector { … }` pair, comments dropped, in source order. */
function rules(css: string) {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? "").split(",").map((part) => part.replace(/\s+/g, " ").trim()),
    body: match[2] ?? "",
  }));
}

/** Every declaration block written for an exact selector, in source order. */
function declarations(selector: string): string {
  return rules(chat)
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.body)
    .join("\n");
}

describe("compaction divider", () => {
  it("animates the label's text while compaction runs", () => {
    const animating = rules(chat).filter((rule) =>
      /animation:\s*session-status-pulse/.test(rule.body),
    );
    const targets = animating.flatMap((rule) => rule.selectors);

    expect(targets).toContain(".compaction-divider-label.is-running > span");
    // Not the label: the rules are its pseudo-elements and would blink with it.
    expect(targets).not.toContain(".compaction-divider-label.is-running");
  });

  it("leaves the divider label text-only", () => {
    const label =
      /<summary[^>]*compaction-divider-label[\s\S]*?<\/summary>/.exec(template)?.[0] ?? "";

    expect(label).not.toBe("");
    expect(label).not.toContain("codicon");
  });

  it("spaces the divider on the transcript's own rhythm", () => {
    // The label is bare text, so neither side may lean on a neighbour's padding
    // — the two margins have to agree — and the value has to be a spacing token
    // rather than a number typed into this one rule.
    const margin = /margin:\s*([^;]+);/.exec(declarations(".compaction-divider"))?.[1]?.trim();

    expect(margin).toMatch(/^var\(--pi-sp-\d+\)\s+0$/);
  });
});
