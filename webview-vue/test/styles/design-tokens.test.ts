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

describe("the chat input follows VS Code's own input geometry", () => {
  /** The bar's two icon-only controls: the `+` and the send button. */
  const controls = [
    [".composer-controls-bar > .send-btn", chat],
    [".composer-controls-bar > .icon-btn:not(.send-btn)", chat],
  ] as const;

  it("sizes them on the 22px chat-input row", () => {
    expect(tokens).toMatch(/--pi-h-chat-control:\s*22px;/);
    for (const [selector, css] of controls) {
      const body =
        new RegExp(`${selector.replace(/[.()]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      expect(body, selector).toContain("width: var(--pi-h-chat-control)");
      expect(body, selector).toContain("height: var(--pi-h-chat-control)");
      // An icon-only control in VS Code's chat input is a circle.
      expect(body, selector).toContain("border-radius: var(--pi-r-full)");
    }
  });

  it("rounds the input container the way VS Code rounds its own", () => {
    const body = /\.composer-box\s*\{[^}]*padding: 8px 10px 10px;[^}]*\}/.exec(chat)?.[0] ?? "";
    expect(body).toContain("border-radius: var(--pi-r-lg)");
  });

  it("carries the compact glyph inside the bar", () => {
    expect(chat).toMatch(/\.composer-controls-bar \.codicon\s*\{[^}]*var\(--pi-icon-sm\)/);
  });
});
