// The rail's place in the transcript's box.
//
// The rail is an overlay, and the one thing it must not do is sit on the text:
// the transcript's own 20px inner padding (`--pi-sp-8`) is exactly the lane the
// rail is allowed to use, plus the 6px the `#messages` scrollbar occupies. Both
// numbers live in this sheet, so they are compared here rather than repeated as
// a literal in the rail's rules.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chat = readFileSync("src/styles/chat.css", "utf8");
const tokens = readFileSync("src/tokens.css", "utf8");

/** Every `selector { … }` pair, comments dropped, in source order. */
function rules(css: string) {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? "").split(",").map((part) => part.replace(/\s+/g, " ").trim()),
    body: match[2] ?? "",
  }));
}

/** `property` as declared in the first rule that matches `selector` exactly. */
function decl(selector: string, property: string): string {
  const rule = rules(chat).find((entry) => entry.selectors.includes(selector));
  const body = rule?.body ?? "";
  return new RegExp(`${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? "";
}

describe("message rail — an overlay in the transcript's gutter", () => {
  it("keeps to the scrollbar lane and the transcript's own padding", () => {
    // The rail's `right` is the lane the scrollbar itself occupies.
    const scrollbar = decl(".messages::-webkit-scrollbar", "width");
    expect(scrollbar, "the transcript's scrollbar width moved").not.toBe("");
    expect(decl(".msg-rail", "right")).toBe(scrollbar);
    // The rail's lane is `.messages`'s own horizontal padding, declared there as
    // the literal 20px that `--pi-sp-8` resolves to.
    expect(/\.messages\s*\{[^}]*padding:\s*16px\s+(\d+px)/.exec(chat)?.[1]).toBe("20px");
    expect(decl(".msg-rail", "width")).toBe("var(--pi-sp-8)");
    expect(tokens).toMatch(/--pi-sp-8:\s*var\(--vscode-spacing-size200,\s*20px\)/);
  });

  it("hides its own scrollbar and leaves the wheel to the transcript", () => {
    expect(decl(".msg-rail", "overflow-y")).toBe("auto");
    expect(decl(".msg-rail", "scrollbar-width")).toBe("none");
    // Deliberately absent: `overscroll-behavior: contain` at the rail's end would
    // eat the wheel instead of handing it back to `#messages`.
    const rail = rules(chat).filter((rule) =>
      rule.selectors.some((selector) => selector.startsWith(".msg-rail")),
    );
    expect(rail.some((rule) => rule.body.includes("overscroll-behavior"))).toBe(false);
  });

  it("draws the mark with the host's corner and the panel's text colours", () => {
    expect(decl(".msg-rail-mark::after", "border-radius")).toBe("var(--pi-r-full)");
    expect(decl(".msg-rail-mark::after", "background")).toBe("var(--pi-text-faint)");
    expect(decl(".msg-rail-mark.is-current::after", "background")).toBe("var(--pi-text-brand)");
    expect(decl(".msg-rail-sep", "background")).toBe("var(--pi-border)");
  });

  it("floats the preview card on the panel's popup surface, out of the pointer's way", () => {
    expect(decl(".msg-rail-card", "pointer-events")).toBe("none");
    expect(decl(".msg-rail-card", "background")).toBe("var(--pi-bg-raised)");
    expect(decl(".msg-rail-card", "border-radius")).toBe("var(--pi-r-lg)");
    expect(decl(".msg-rail-card", "box-shadow")).toBe("var(--pi-shadow-menu)");
  });
});
