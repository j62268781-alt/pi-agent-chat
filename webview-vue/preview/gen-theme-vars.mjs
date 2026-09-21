// Materialize the real colour and size values of VS Code as `--vscode-*`
// custom properties, so the design preview runs on the same numbers the webview
// receives from the host instead of hand-picked swatches.
//
//   node preview/gen-theme-vars.mjs
//
// Three sources, all read from the local VS Code install:
//
//   1. `theme-defaults/themes/*.json` — what each built-in theme declares,
//      resolved through its `include` chain.
//   2. the colour registry defaults embedded in the workbench bundle — what
//      VS Code fills in for every colour a theme leaves unsaid. High-contrast
//      themes lean on these almost entirely (hc_black declares 13 colours).
//   3. the size-token registry defaults in the same bundle — VS Code's design
//      tokens (`cornerRadius.*`, `spacing.size*`, `bodyFontSize`, …), which
//      `getWebviewThemeData()` ships to every webview next to the colours. They
//      are theme-independent: the built-ins register one value for all four
//      theme kinds, so they land in `DESIGN_TOKENS` rather than per-theme vars.
//
// A kind bucket resolves as `hcDark -> hcDark ?? dark`, `hcLight -> hcLight ??
// light`, which is how the workbench resolves them.
//
// Known gap: registry entries whose defaults are written with named constants
// (`Qe.white`) rather than hex literals are not extracted; a handful of colours
// are therefore missing here that the real webview does receive. The token
// layer must chain fallbacks regardless, so those cases degrade instead of
// breaking.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = "/Applications/Visual Studio Code.app/Contents/Resources/app";
const THEMES_DIR = process.env.PI_VSCODE_THEMES ?? join(APP, "extensions/theme-defaults/themes");
const WORKBENCH = join(APP, "out/vs/workbench/workbench.desktop.main.js");

/** Themes worth previewing: the two defaults, both high-contrast twins, and the older flat VS themes. */
const THEMES = [
  { id: "dark_modern", label: "Dark Modern", bucket: "dark", classes: ["vscode-dark"] },
  { id: "light_modern", label: "Light Modern", bucket: "light", classes: ["vscode-light"] },
  { id: "dark_vs", label: "Dark (Visual Studio)", bucket: "dark", classes: ["vscode-dark"] },
  {
    id: "light_vs",
    label: "Light (Visual Studio)",
    bucket: "light",
    classes: ["vscode-light"],
  },
  {
    id: "hc_black",
    label: "Dark High Contrast",
    bucket: "hcDark",
    classes: ["vscode-dark", "vscode-high-contrast"],
  },
  {
    id: "hc_light",
    label: "Light High Contrast",
    bucket: "hcLight",
    classes: ["vscode-light", "vscode-high-contrast-light"],
  },
  { id: "2026-dark", label: "Dark 2026", bucket: "dark", classes: ["vscode-dark"] },
  { id: "2026-light", label: "Light 2026", bucket: "light", classes: ["vscode-light"] },
];

/** Named colour constants the registry uses; resolved the way the bundle resolves them. */
const CONSTANTS = { white: "#ffffff", black: "#000000" };

/**
 * Ids whose defaults are computed rather than written as hex, so the scan above
 * cannot see them. Each entry records the bundle expression it comes from, so
 * the value can be re-checked when VS Code is updated.
 *
 *   chat.requestBackground  {dark:hi(rn,.62), light:hi(rn,.62), …}   // rn = editor.background
 *   chat.requestBorder      {dark:new $e(new ri(255,255,255,.1)), light:…(0,0,0,.1), …}
 */
const COMPUTED_IDS = {
  "chat.requestBackground": {
    dark: "color-mix(in srgb, var(--vscode-editor-background) 62%, transparent)",
    light: "color-mix(in srgb, var(--vscode-editor-background) 62%, transparent)",
    hcDark: "var(--vscode-editor-background)",
  },
  "chat.requestBorder": {
    dark: "rgba(255, 255, 255, 0.1)",
    light: "rgba(0, 0, 0, 0.1)",
  },
};

async function loadTheme(file, seen = new Set()) {
  if (seen.has(file)) return {};
  seen.add(file);
  const theme = JSON.parse(await readFile(file, "utf8"));
  const inherited = theme.include ? await loadTheme(join(dirname(file), theme.include), seen) : {};
  // Later files win: the including theme overrides what it inherits.
  return { ...inherited, ...theme.colors };
}

/** Colour id -> per-kind defaults, as embedded in the workbench bundle. */
async function loadRegistryDefaults() {
  const source = await readFile(WORKBENCH, "utf8");
  const pattern = /"([A-Za-z][A-Za-z0-9.]*)",\{([^{}]{0,400}?)\}/g;
  const defaults = new Map();
  for (const match of source.matchAll(pattern)) {
    const [, id, body] = match;
    if (!/dark:"#/.test(body) || !/light:"#/.test(body)) continue;
    const kinds = {};
    for (const entry of body.matchAll(
      /\b(dark|light|hcDark|hcLight):"?(#[0-9A-Fa-f]{3,8}|[A-Za-z]+)"?/g,
    )) {
      const value = CONSTANTS[entry[2]] ?? entry[2];
      if (value.startsWith("#")) kinds[entry[1]] = value;
    }
    if (Object.keys(kinds).length > 0) defaults.set(id, kinds);
  }
  return defaults;
}

/**
 * Size tokens (VS Code's design tokens) -> their CSS value, from the same
 * bundle. They are registered through `zl(id, Ul(value, unit), …)`, whose `Ul`
 * stamps the identical value onto all four theme kinds — hence one flat map.
 */
async function loadSizeTokens() {
  const source = await readFile(WORKBENCH, "utf8");
  const pattern = /\bzl\(\s*"([A-Za-z][\w.-]+)"\s*,\s*Ul\(\s*(\d+(?:\.\d+)?)\s*,\s*"([^"]*)"\s*\)/g;
  const tokens = {};
  for (const [, id, value, unit] of source.matchAll(pattern)) {
    tokens[toVariable(id)] = `${value}${unit}`;
  }
  return tokens;
}

function pickDefault(kinds, bucket) {
  if (bucket === "hcDark") return kinds.hcDark ?? kinds.dark;
  if (bucket === "hcLight") return kinds.hcLight ?? kinds.light;
  return kinds[bucket];
}

function toVariable(id) {
  return `--vscode-${id.replace(/\./g, "-")}`;
}

const defaults = await loadRegistryDefaults();
for (const [id, kinds] of Object.entries(COMPUTED_IDS)) defaults.set(id, kinds);
console.log(`registry defaults: ${defaults.size} colour ids (incl. computed)`);

const designTokens = await loadSizeTokens();
console.log(`design tokens: ${Object.keys(designTokens).length}`);

const themes = [];
for (const theme of THEMES) {
  const declared = await loadTheme(join(THEMES_DIR, `${theme.id}.json`));
  // Registry defaults first, theme overrides second — the workbench order.
  const resolved = {};
  for (const [id, kinds] of defaults) {
    const value = pickDefault(kinds, theme.bucket);
    if (value) resolved[toVariable(id)] = value;
  }
  for (const [id, value] of Object.entries(declared)) resolved[toVariable(id)] = String(value);

  themes.push({
    id: theme.id,
    label: theme.label,
    bucket: theme.bucket,
    classes: theme.classes,
    declaredCount: Object.keys(declared).length,
    vars: resolved,
  });
  console.log(
    `${theme.id}: ${Object.keys(resolved).length} vars (${Object.keys(declared).length} declared by the theme)`,
  );
}

const banner = `// GENERATED by preview/gen-theme-vars.mjs — do not edit by hand.
//
// Colour values of VS Code's built-in themes: registry defaults resolved for
// the theme's kind, then the theme's own declarations on top. The preview
// applies one of these sets as \`--vscode-*\` custom properties on the preview
// root, which is what the real webview receives from the host.
//
// \`DESIGN_TOKENS\` are the size tokens from the same host payload — VS Code's
// own geometry (corner radii, spacing steps, font sizes, stroke width). They do
// not vary by theme, so the preview applies them to every theme alike.

export interface PreviewTheme {
  id: string;
  label: string;
  /** Registry bucket the theme resolves against. */
  bucket: "dark" | "light" | "hcDark" | "hcLight";
  /** Body classes VS Code puts on the webview for this theme. */
  classes: string[];
  /** How many colours the theme declares itself, out of \`vars\`. */
  declaredCount: number;
  vars: Record<string, string>;
}

export const THEMES: PreviewTheme[] = ${JSON.stringify(themes, null, 2)};

/** Size-token defaults (variable name -> CSS value), straight from the host. */
export const DESIGN_TOKENS: Record<string, string> = ${JSON.stringify(
  Object.fromEntries(Object.entries(designTokens).sort(([a], [b]) => a.localeCompare(b))),
  null,
  2,
)};
`;

await writeFile(fileURLToPath(new URL("./themes.generated.ts", import.meta.url)), banner, "utf8");
console.log(`wrote preview/themes.generated.ts (${themes.length} themes)`);
