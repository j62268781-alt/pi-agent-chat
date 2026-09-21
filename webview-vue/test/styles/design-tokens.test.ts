// The panel's geometry is the host's geometry.
//
// VS Code ships its *size tokens* to every webview next to the colours —
// `getWebviewThemeData()` merges the colour registry with the size-token
// registry, so `--vscode-cornerRadius-*`, `--vscode-spacing-size*`,
// `--vscode-codiconFontSize*` and `--vscode-strokeThickness` are readable from
// any rule we write. These tests hold the same line for geometry that the
// colour contract holds for colour: `tokens.css` owns the host ids, component
// sheets use our names, and no literal pixel value creeps back in.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = readFileSync("src/tokens.css", "utf8");
const chat = readFileSync("src/styles/chat.css", "utf8");
const settings = readFileSync("src/styles/settings.css", "utf8");

describe("geometry token layer", () => {
  it("sources every radius from the host's corner scale", () => {
    const scale: Record<string, string> = {
      "--pi-r-xs": "--vscode-cornerRadius-xSmall",
      "--pi-r-sm": "--vscode-cornerRadius-small",
      "--pi-r-md": "--vscode-cornerRadius-medium",
      "--pi-r-lg": "--vscode-cornerRadius-large",
      "--pi-r-xl": "--vscode-cornerRadius-xLarge",
      "--pi-r-full": "--vscode-cornerRadius-circle",
    };
    for (const [ours, theirs] of Object.entries(scale)) {
      const value = new RegExp(`${ours}:\\s*([^;]+);`).exec(tokens)?.[1] ?? "";
      expect(value, ours).toContain(theirs);
      // The fallback matters: a host older than the size-token registry injects
      // nothing, and the panel still has to round its corners.
      expect(value, `${ours} needs a fallback`).toMatch(/,\s*[^,)]+\)/);
    }
  });

  it("takes the spacing ladder rung for rung", () => {
    for (const rung of [40, 60, 80, 100, 120, 160, 200, 240, 320]) {
      expect(tokens, `spacing-size${rung}`).toContain(`var(--vscode-spacing-size${rung},`);
    }
    // 14px is not on VS Code's ladder, so that rung is retired rather than kept
    // as a near-miss.
    expect(tokens).not.toMatch(/--pi-sp-6:/);
  });

  it("takes the icon rungs and the hairline from the host too", () => {
    expect(tokens).toMatch(/--pi-icon-lg:\s*var\(--vscode-codiconFontSize,/);
    expect(tokens).toMatch(/--pi-icon-sm:\s*var\(--vscode-codiconFontSize-compact,/);
    expect(tokens).toMatch(/--pi-stroke:\s*var\(--vscode-strokeThickness,/);
  });
});

describe("component sheets", () => {
  const sheets = [
    ["chat", chat],
    ["settings", settings],
  ] as const;

  it("leaves no literal radius behind", () => {
    for (const [name, css] of sheets) {
      const literal = [...css.matchAll(/border-radius:\s*[^;]*\d+px[^;]*/g)].map((m) => m[0]);
      // `50%` (a circle) and `0` (a square) are shapes, not rounds on the scale.
      expect(literal, name).toEqual([]);
    }
  });

  it("leaves no literal hairline behind", () => {
    for (const [name, css] of sheets) {
      expect(css, name).not.toMatch(/1px\s+(solid|dashed|dotted)/);
    }
  });
});

describe("the chat input's control row", () => {
  /** The bar's two icon-only controls: the `+` and the send button. */
  const controls = [
    [".composer-controls-bar > .send-btn", chat],
    [".composer-controls-bar > .icon-btn:not(.send-btn)", chat],
  ] as const;

  it("sizes them on the bar's own 26px row", () => {
    // The row started as VS Code's own `--chat-input-control-height` (22px).
    // 22 next to a 13px label made every control in the bar read as small print,
    // so the bar's row is deliberately one notch above the host's now — the
    // token is what the two circles, the pills' height and the permission
    // pill's floor all read, so this one value moves the whole row.
    expect(tokens).toMatch(/--pi-h-chat-control:\s*26px;/);
    for (const [selector, css] of controls) {
      const body =
        new RegExp(`${selector.replace(/[.()]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      expect(body, selector).toContain("width: var(--pi-h-chat-control)");
      expect(body, selector).toContain("height: var(--pi-h-chat-control)");
      // A rounded square on the pills' own corner, not VS Code's circle: the
      // bar had squares before the token pass and 彬哥 picked them back.
      expect(body, selector).toContain("border-radius: var(--pi-r-md)");
    }
  });

  it("rounds the input container the way VS Code rounds its own", () => {
    const body = /\.composer-box\s*\{[^}]*padding: 8px 10px 10px;[^}]*\}/.exec(chat)?.[0] ?? "";
    expect(body).toContain("border-radius: var(--pi-r-lg)");
  });

  it("keeps the glyph-to-control ratio the host's row has", () => {
    // 12 in 22 is the host's ratio; the bar's own rung carries it to 14 in 26.
    // Which controls read it is the next test's business.
    expect(tokens).toMatch(/--pi-icon-md:\s*14px;/);
  });

  it("keeps the bar's glyph size out of the pickers' own popups", () => {
    // Both pickers render *inside* the bar's DOM — `#model-popup` in
    // `.model-wrap`, `#permission-popup` in `.permission-wrap` — so an unscoped
    // descendant selector reached every glyph in them: the permission list's
    // shield/unlock and the model rows fell from their own 16px to the bar's,
    // which is 彬哥's "弹窗出来的 icon 都小了很多". The bar's rule names its four
    // controls instead.
    expect(chat).not.toMatch(/\.composer-controls-bar \.codicon\s*\{/);
    expect(chat).toMatch(
      /\.composer-controls-bar > \.select-wrap > button \.codicon\s*\{[^}]*var\(--pi-icon-md\)/,
    );
  });

  it("gives the bar's glyph boxes the bar's glyph size", () => {
    // `.icon-btn .codicon` sets the box to the toolbar's `--pi-icon-lg`, so
    // overriding only the font left a 14px line box at the top of a 16px box:
    // the `+` and the send arrow measured 1.5-2px above the row's centre while
    // the permission pill's lock, whose box is never restated, sat on it.
    const body =
      /\.composer-controls-bar > \.select-wrap > button \.codicon\s*\{([^}]*)\}/.exec(chat)?.[1] ??
      "";
    expect(body).toContain("width: var(--pi-icon-md)");
    expect(body).toContain("height: var(--pi-icon-md)");
  });

  it("centres the bar's labels on their cap band, not on their line box", () => {
    // A flex-centred line box leaves the visible ink ~2px low — Segoe UI
    // reserves 1.079em above the baseline and 0.251em below it — so the caps sat
    // under the centre of the icon beside them. Trimming to cap → baseline
    // centres the band; the padding is what the g/p descenders need, because the
    // trimmed box ends on the baseline and the labels clip at their own box.
    const flat = chat.replace(/\/\*[\s\S]*?\*\//g, "");
    const trimmed = [...flat.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((match) =>
      match[2]?.includes("text-box: trim-both cap alphabetic"),
    );
    expect(trimmed).toHaveLength(1);
    const [selectors, body] = [trimmed[0]?.[1] ?? "", trimmed[0]?.[2] ?? ""];
    expect(selectors.split(",").map((part) => part.trim())).toEqual([
      ".model-trigger-label",
      ".permission-trigger-label",
      ".thinking-row-label",
      ".thinking-trigger-label",
    ]);
    expect(body).toContain("padding-bottom: var(--pi-sp-1)");
  });

  it("draws the context ring's outer edge on that same control size", () => {
    // The ring's box is taller than the row so a 10px reading fits in its
    // hole, but the stroke lands on 26px — `2 × (r + stroke/2)` in the viewBox —
    // which is what lines its edge up with the circles beside it.
    const ring = /\.ctx-ring\s*\{([^}]*)\}/.exec(chat)?.[1] ?? "";
    expect(ring).toContain("width: 28px");
    expect(ring).toContain("height: 28px");
    const viewBox = /<svg viewBox="0 0 28 28">/.exec(
      readFileSync("src/components/Composer.vue", "utf8"),
    );
    expect(viewBox, "the ring's viewBox moved").not.toBeNull();
  });

  it("caps the ring's reading at what the gauge can hold", () => {
    // `--pi-fs-micro` is derived from the chat font size setting, the gauge is a
    // fixed 28px box, and the hole is 21px. At `chatFontSize: 18` the rung is
    // 13.8px, where "100" measures 22.4px — the digits crossed the stroke.
    const label = /\.ctx-ring-label\s*\{([^}]*)\}/.exec(chat)?.[1] ?? "";
    expect(label).toContain("font-size: min(var(--pi-fs-micro), 10px)");
  });
});
