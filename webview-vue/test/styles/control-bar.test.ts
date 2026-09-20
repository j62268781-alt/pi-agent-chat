// The control bar and the meta rows are one family: same fill, same size step.
//
// Both bugs this locks were invisible in the theme the panel was developed
// against. The composer pills took their fill from `badge.background`, which is
// a brand colour in several themes (2026-dark paints it #307E9F) while the `+`
// chip filled from `input.background` — so the row read as two different
// widgets. The send button's resting fill came from `button.secondaryBackground`,
// which Dark Modern and 2026-dark define as *fully transparent*, so an empty
// composer looked like an unpainted square.
//
// jsdom resolves neither `color-mix` nor the cascade, so a mounted component
// cannot see any of this; the assertions run on the stylesheet contract.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Paths relative to this package's root, the way the other source-scanning
 * suite does it — `import.meta.url` is an http URL under the jsdom runner. */
const tokens = readFileSync("src/tokens.css", "utf8");
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

/** Every declaration block written for an exact selector, in source order. A
 * selector appears in several grouped rules and media blocks here, so the
 * contract checks are "some block says X", not "the winning block says X". */
function declarations(css: string, selector: string): string {
  return rules(css)
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.body)
    .join("\n");
}

describe("control-bar fill contract", () => {
  it("derives the control fill from theme text × surface instead of a theme id", () => {
    for (const name of ["--pi-bg-control", "--pi-bg-control-hover"]) {
      const value = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1] ?? "";
      expect(value, name).toContain("color-mix");
    }
    // The two ids that broke the row must not come back as a fill source.
    expect(tokens).not.toContain("--vscode-badge-background");
    expect(tokens).not.toContain("--vscode-button-secondaryBackground");
  });

  it("keeps theme ids out of the component stylesheet", () => {
    // STYLE-SPEC §八.1: `tokens.css` owns the mapping, so a rule here that reads
    // `--vscode-*` is a theme value nobody audited.
    expect(chat).not.toContain("--vscode-");
  });

  it("points every control-bar surface at the shared token", () => {
    /** What the browser composes for each control: the fill rule, plus where its
     * hairline lives (the send chip's comes from the bar's own sizing rule). */
    const controls: Record<string, string[]> = {
      "picker pill": [".model-trigger"],
      "attach chip": [".composer-controls-bar > .icon-btn:not(.send-btn)"],
      "resting send": [".send-btn:disabled", ".composer-controls-bar > .send-btn"],
    };
    for (const [name, selectors] of Object.entries(controls)) {
      const body = selectors.map((selector) => declarations(chat, selector)).join("\n");
      expect(body, name).toContain("var(--pi-bg-control)");
      expect(body, name).toContain("var(--pi-border)");
    }
  });
});

describe("transcript surface contract", () => {
  /** Everything the transcript paints as a block. Each one used to pick its own
   * grey, which is how five surfaces, three ink colours and three paddings
   * ended up on one screen. */
  const SURFACES = [
    ".user-bubble",
    ".text-block blockquote",
    ".text-block pre",
    ".thinking-body",
    ".tool-args",
    ".tool-json",
    ".code-block",
    ".term",
    ".qa-card",
  ];

  it("gives every transcript surface the same fill, ink, padding and radius", () => {
    for (const selector of SURFACES) {
      const body = declarations(chat, selector);
      expect(body, selector).toContain("background: var(--pi-bg-card)");
      expect(body, selector).toContain("color: var(--pi-text)");
      expect(body, selector).toContain("padding: var(--pi-sp-3) var(--pi-sp-5)");
      expect(body, selector).toContain("border-radius: var(--pi-r-lg)");
    }
  });

  it("keeps the shared surface last, so a later card cannot re-pick a grey", () => {
    const all = rules(chat);
    const convergence = all.find(
      (rule) =>
        rule.selectors.includes(".user-bubble") &&
        rule.selectors.includes(".term") &&
        rule.body.includes("--pi-bg-card"),
    );
    expect(convergence, "the convergence block was deleted").toBeDefined();
    const index = all.indexOf(convergence as Rule);
    for (const selector of SURFACES) {
      const painted = all
        .map((rule, position) => ({ rule, position }))
        .filter(
          (entry) => entry.position > index && entry.rule.selectors.includes(selector) && /background/.test(entry.rule.body),
        );
      expect(painted.map((entry) => entry.rule.selectors.join(",")), selector).toEqual([]);
    }
  });

  it("aliases the card onto the bubble instead of picking a sixth grey", () => {
    const value = /--pi-bg-card:\s*([^;]+);/.exec(tokens)?.[1] ?? "";
    expect(value.trim()).toBe("var(--pi-bg-bubble)");
  });
});

describe("turn width contract", () => {
  it("lets both sides of the conversation use the whole column", () => {
    // The board's 640px reading column is gone by decision: width follows the
    // copy now. `100%` keeps the guard the bare `640px` used to break — a flex
    // item may not shrink below its min-content, so anything that cannot wrap
    // would widen the transcript into horizontal scrolling.
    expect(chat).not.toMatch(/max-width:\s*min\(640px/);
    for (const selector of [".bubble", ".msg.assistant"]) {
      expect(declarations(chat, selector), selector).toContain("max-width: 100%");
    }
  });
});

describe("meta-row contract", () => {
  it("keeps the status row and the bubble meta on one centre line", () => {
    expect(declarations(chat, ".msg-meta")).toContain("align-items: center");
    // This pushed the timestamp 3px below the copy icon once `.msg-meta` became
    // a flex row: on the cross axis, `flex-end` is "bottom", not "right".
    expect(chat).not.toMatch(/\.msg\.user \.msg-time\s*\{[^}]*align-self/);
  });

  it("sizes the meta row from the body step, not the micro one", () => {
    for (const selector of [".msg-outcome", ".msg-duration", ".msg-time"]) {
      expect(declarations(chat, selector), selector).toContain("var(--pi-fs-body)");
    }
  });
});
