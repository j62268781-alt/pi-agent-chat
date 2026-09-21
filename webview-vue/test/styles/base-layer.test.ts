// The base layer: the three resets both entry sheets carry, and the two lines
// they deliberately do not.
//
// The chat build and the settings build ship their own stylesheet, so anything
// in `chat.css`'s base has to exist in `settings.css`'s too — the `#app` comment
// says as much for the layout half. This is the contract that keeps them equal,
// and it is where the panel's stance on normalize.css is written down.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sheets = [
  ["chat", readFileSync("src/styles/chat.css", "utf8")],
  ["settings", readFileSync("src/styles/settings.css", "utf8")],
] as const;

const packageJson = readFileSync("package.json", "utf8");

/** Every `selector { … }` pair, comments dropped, in source order. */
function rules(css: string): Array<{ selectors: string[]; body: string }> {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? "").split(",").map((part) => part.replace(/\s+/g, " ").trim()),
    body: match[2] ?? "",
  }));
}

/** Every block written for exactly this selector list, joined in source order.
 * A selector list can appear more than once here (`*` carries both the
 * scrollbar pass and the box-sizing reset), so these checks are "some block
 * says X", not "the winning block says X". */
function blocksFor(css: string, selectors: string[]): string {
  return rules(css)
    .filter(
      (entry) =>
        entry.selectors.length === selectors.length &&
        selectors.every((selector) => entry.selectors.includes(selector)),
    )
    .map((entry) => entry.body)
    .join("\n");
}

const CONTROLS = ["button", "input", "optgroup", "select", "textarea"];

describe("base layer", () => {
  it("sizes every box the same way in both builds", () => {
    for (const [name, css] of sheets) {
      expect(blocksFor(css, ["*"]), name).toContain("box-sizing: border-box");
    }
  });

  it("takes the page margin off in both builds", () => {
    for (const [name, css] of sheets) {
      const body = blocksFor(css, ["html", "body"]);
      expect(body, name).toContain("margin: 0");
      expect(body, name).toContain("padding: 0");
    }
  });

  it("makes form controls inherit the panel's type in both builds", () => {
    // Chromium gives a bare `button` its own `13.3333px Arial`, so a control the
    // sheet does not font-set renders in another family at another size from the
    // panel around it — measured on 25 of the 28 controls in the chat panel
    // (`.queue-action`'s 引导 among them, carrying CJK) before this rule went in.
    for (const [name, css] of sheets) {
      const body = blocksFor(css, CONTROLS);
      expect(body, name).toContain("font-family: inherit");
      expect(body, name).toContain("font-size: 100%");
    }
  });

  it("takes those two declarations from normalize.css and nothing else", () => {
    // normalize.css is deliberately not a dependency: it exists so one sheet
    // agrees across engines, and a webview only ever runs VS Code's Chromium.
    // Two of its lines are worth having; its `line-height: 1.15` and `margin: 0`
    // are not — those would move baselines this panel pins by hand (the pills'
    // `text-box` cap band, the 26px control row) wherever a line-height is
    // inherited, and its `summary { display: list-item }` would reach the work
    // fold and the compaction divider's `<details>`.
    expect(packageJson).not.toContain("normalize.css");
    for (const [name, css] of sheets) {
      const body = blocksFor(css, CONTROLS);
      expect(body, name).not.toContain("line-height");
      expect(body, name).not.toContain("margin");
    }
  });
});
