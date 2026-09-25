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
  it("keeps a disabled control's fill, fading only its ink", () => {
    // `.icon-btn:disabled` drops the whole button to 40% opacity, and the `+` is
    // disabled for the whole of a running turn while the pills beside it never
    // disable — measured against the card, its fill washed out to 240 next to
    // their 225, which is 彬哥's "底色应该要和上传图片的那个一致". The send button has
    // carried the same rule since an empty composer looked like an unpainted
    // square; the `+` follows it.
    const body = declarations(chat, ".composer-controls-bar > .icon-btn:not(.send-btn):disabled");
    expect(body).toContain("background: var(--pi-bg-control)");
    expect(body).toContain("opacity: 1");
    expect(body).toContain("var(--pi-text-disabled)");
  });
});

describe("control-bar rhythm contract", () => {
  it("spaces every pair of controls on the bar's own gap", () => {
    // The right-hand pair used to be pushed out by an empty flex item with a 4px
    // floor. On a full bar that measured 20px from the permission pill to the
    // ring — two gaps plus the item's floor — where every other pair measured 8,
    // and at ≤300px the send button bought itself a private 5px on top of the
    // bar's 1px. 彬哥: "间距应该以第一个按钮的右侧间距为准". The free space belongs to
    // the ring's own auto margin, so no pair reads wider than its neighbours.
    expect(readFileSync("src/components/Composer.vue", "utf8")).not.toContain("composer-spacer");
    expect(chat).not.toContain(".composer-spacer");
    expect(declarations(chat, ".ctx-ring")).toContain("margin-left: auto");
    for (const rule of rules(chat)) {
      if (!rule.selectors.includes(".send-btn")) continue;
      expect(rule.body, "the send button bought its own gutter").not.toContain("margin-left");
    }
  });

  it("puts the input's text on the same left edge as the divider and the + chip", () => {
    // Measured before: the text started 21px from the card's edge while the
    // divider and the `+` started at 11 — the input added 10px of its own on top
    // of the card's padding. 11px is also what VS Code's own chat input insets
    // its text by (6px container + 4px editor + the hairline), so the text, the
    // rule under it and the chip now share one left edge.
    const input = declarations(chat, "#input");
    // The vertical padding is the empty-state ceiling/floor pair: 3px above the
    // text and nothing below it, so the text sits ~10px under the card's inner
    // edge and 6.5px above the divider. The height itself comes from the JS floor
    // (`autoGrow`), which is why the two values are asserted together — editing
    // one alone silently does nothing.
    expect(input).toContain("padding: 3px 0 0");
    expect(input).toContain("min-height: 23px");
    expect(readFileSync("src/components/Composer.vue", "utf8")).toContain(
      "Math.max(23, Math.min(el.scrollHeight, 200))",
    );
    expect(input, "the input bought back its own side padding").not.toMatch(
      /padding:\s*[^;]*\b10px/,
    );
  });

  it("sets the readout on VS Code's hover card, not on the micro rung", () => {
    // 13px on a 1.5 line box with `4px 8px` of padding and a 200px floor is
    // VS Code's own hover card (`.monaco-hover.workbench-hover` +
    // `chat-context-usage-details`); the 10px rung read a size too small beside
    // the pills it hangs off.
    const body = declarations(chat, ".ctx-tooltip");
    expect(body).toContain("font-size: var(--pi-fs-body)");
    expect(body).toContain("line-height: 1.5");
    expect(body).toContain("padding: var(--pi-sp-1) var(--pi-sp-3)");
    expect(body).toContain("min-width: 200px");
    // The label/value split is what puts the figures in a column: `space-between`
    // in a shrink-to-fit box right-aligns every value against the widest row.
    expect(declarations(chat, ".ctx-row")).toContain("justify-content: space-between");
  });
});

describe("session list contract", () => {
  it("draws every row's delete button without waiting for a hover", () => {
    // It faded in on hover until 彬哥 asked for it to be there (2026-09-22). On a
    // list of twenty rows that is twenty hidden controls, and the click that
    // lands where the icon had just appeared hits the row instead — which
    // switches the session. Only the ink changes now, from danger to danger-soft.
    const body = declarations(chat, ".session-item-del");
    expect(body).toContain("color: var(--pi-danger)");
    expect(body, "the button hides itself at rest again").not.toContain("opacity: 0");
    expect(body).not.toContain("pointer-events: none");
    expect(chat).not.toContain(".session-item:hover .session-item-del");
  });
});

describe("transcript surface contract", () => {
  /** Everything the transcript paints as a *card*. Each one used to pick its own
   * grey, which is how five surfaces, three ink colours and three paddings ended
   * up on one screen. The sender's block is deliberately absent: it is a request,
   * not a card — see the two tests at the end of this block. */
  const SURFACES = [
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
        rule.selectors.includes(".term") &&
        rule.selectors.includes(".qa-card") &&
        rule.body.includes("--pi-bg-card"),
    );
    expect(convergence, "the convergence block was deleted").toBeDefined();
    const index = all.indexOf(convergence as Rule);
    for (const selector of SURFACES) {
      const painted = all
        .map((rule, position) => ({ rule, position }))
        .filter(
          (entry) =>
            entry.position > index &&
            entry.rule.selectors.includes(selector) &&
            /background/.test(entry.rule.body),
        );
      expect(
        painted.map((entry) => entry.rule.selectors.join(",")),
        selector,
      ).toEqual([]);
    }
  });

  it("takes the card fill from a theme id rather than picking a sixth grey", () => {
    const value = /--pi-bg-card:\s*([^;]+);/.exec(tokens)?.[1] ?? "";
    expect(value).toContain("--vscode-");
  });

  it("paints the sender's block as a chat request, and after the cards so it wins", () => {
    // The card fill means "an unfocused selected list row"; a message the user
    // sent is a request, and VS Code has its own ids for exactly that. This is
    // the one surface allowed to differ — the rule has to come after the
    // convergence block for the cascade to land.
    const value = /--pi-bg-bubble:\s*([^;]+);/.exec(tokens)?.[1] ?? "";
    expect(value).toContain("--vscode-chat-requestBackground");
    expect(/--pi-border-bubble:\s*([^;]+);/.exec(tokens)?.[1] ?? "").toContain(
      "--vscode-chat-requestBorder",
    );

    const bubble = declarations(chat, ".user-bubble");
    expect(bubble).toContain("background: var(--pi-bg-bubble)");
    expect(bubble).toContain("border: var(--pi-stroke) solid var(--pi-border-bubble)");

    const all = rules(chat);
    const convergence = all.findIndex((rule) => rule.body.includes("--pi-bg-card"));
    const override = all.findIndex(
      (rule) => rule.selectors.includes(".user-bubble") && /--pi-bg-bubble/.test(rule.body),
    );
    expect(override, "the bubble override is missing").toBeGreaterThan(-1);
    expect(override, "the bubble override is before the cards").toBeGreaterThan(convergence);
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
    for (const selector of [".msg-outcome", ".msg-time"]) {
      expect(declarations(chat, selector), selector).toContain("var(--pi-fs-body)");
    }
  });
});

describe("the gauge's number in a narrow sidebar", () => {
  it("shrinks a rung instead of disappearing", () => {
    // A ring whose card reads "usage 3%" while its hole shows nothing is the
    // worst of both (彬哥, 2026-09-25). The ≤300px block used to hide the label
    // outright; it now drops one font rung so a three-digit reading still fits.
    expect(chat).not.toMatch(/\.ctx-ring-label\s*\{[^}]*display:\s*none/);
    expect(chat).toMatch(/\.ctx-ring-label\s*\{\s*font-size:\s*9px/);
  });
});
