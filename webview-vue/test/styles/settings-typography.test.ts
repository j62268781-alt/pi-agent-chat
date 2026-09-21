// The settings panel's type ladder.
//
// It used to be one size: a setting's label rendered at 12px in the secondary
// ink and its description at 10px, so the thing you read was quieter than the
// gap around it. VS Code's own settings editor is the opposite way round — the
// label is the UI size at weight 600 in full foreground, and only the
// description is muted. These tests pin that shape, because every one of those
// numbers is a `font-size` line someone can "tidy" back down again.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settings = readFileSync("src/styles/settings.css", "utf8");

interface Rule {
  selectors: string[];
  body: string;
}

function rules(css: string): Rule[] {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? "").split(",").map((part) => part.replace(/\s+/g, " ").trim()),
    body: match[2] ?? "",
  }));
}

function declarations(selector: string): string {
  return rules(settings)
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.body)
    .join("\n");
}

describe("settings type ladder", () => {
  it("renders a setting label at the UI size, semibold, in full ink", () => {
    const body = declarations(".field-label");
    expect(body).toContain("font-size: var(--pi-fs-body)");
    expect(body).toContain("font-weight: 600");
    expect(body).toContain("color: var(--pi-text);");
  });

  it("puts the group header a step above the labels it contains", () => {
    const body = declarations(".cfg-group-header");
    expect(body).toContain("font-size: var(--pi-fs-title)");
    expect(body).toContain("font-weight: 600");
  });

  it("keeps the checkbox label a label, not a caption", () => {
    const body = declarations(".check-label");
    expect(body).toContain("font-size: var(--pi-fs-body)");
    expect(body).toContain("font-weight: 600");
  });

  it("leaves the reading sizes to the body and meta steps", () => {
    // 10px is a badge size. Descriptions, hints and the OAuth URL are read, so
    // none of them belongs on the micro step.
    for (const selector of [
      ".cfg-desc",
      ".item-desc",
      ".hint",
      ".dim",
      ".compat-hint",
      ".compat-bool-label",
      ".oauth-progress .url",
    ]) {
      expect(declarations(selector), selector).toContain("font-size: var(--pi-fs-meta)");
    }
    for (const selector of [".error", ".msg-warn"]) {
      expect(declarations(selector), selector).toContain("font-size: var(--pi-fs-body)");
    }
  });

  it("lets the group's own padding do the spacing, once", () => {
    // The label used to add 16px on top of the body's 16px, which is what made a
    // group's first row float under its header.
    expect(declarations(".field-label")).toContain("margin: 0 0 var(--pi-sp-2)");
    expect(declarations(".cfg-group-body > .cfg-field:last-child")).toContain("margin-bottom: 0");
  });
});

describe("settings panel ownership", () => {
  it("keeps theme ids out of the component stylesheet", () => {
    // Same rule the chat sheet has: `tokens.css` owns the `--vscode-*` mapping.
    expect(settings).not.toContain("--vscode-");
  });

  it("has no literal radius or hairline left", () => {
    expect([...settings.matchAll(/border-radius:\s*[^;]*\d+px[^;]*/g)].map((m) => m[0])).toEqual(
      [],
    );
    expect(settings).not.toMatch(/1px\s+solid/);
  });
});
