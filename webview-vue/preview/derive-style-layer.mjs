// Derive the proposed stylesheets from the ones in `src/`.
//
//   node preview/derive-style-layer.mjs          # write preview/styles/*.proposed.css
//   node preview/derive-style-layer.mjs --src     # rewrite src/styles/*.css in place
//
// Only one thing is rewritten: hard-coded `font-size` declarations, which are
// the reason the type hierarchy collapses — they ignore `chatFontSize` and sit
// outside the scale. Every rewrite is printed, so the run doubles as the change
// list for the real refactor. Colours are left alone; the token layer covers
// them.
//
// Run it again after a `--src` pass: it should report zero rewrites, which is
// the cheapest proof that no hard-coded size is left behind.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const IN_PLACE = process.argv.includes("--src");

/** px value -> semantic step. Nine numeric steps and a pile of one-offs. */
const PX = new Map([
  [8, "micro"],
  [9, "micro"],
  [10, "micro"],
  [11, "meta"],
  [12, "meta"],
  [13, "body"],
  [14, "body"],
  [15, "title"],
  [16, "title"],
  [17, "display"],
  [18, "display"],
  [20, "display"],
]);

/** em value -> semantic step. These sit inside markdown, relative to prose. */
const EM = new Map([
  ["1.4", "display"],
  ["1.25", "title"],
  ["1.1", "body"],
  ["1", "body"],
]);

const SOURCES = [
  { from: "src/styles/chat.css", to: "preview/styles/chat.proposed.css" },
  { from: "src/styles/settings.css", to: "preview/styles/settings.proposed.css" },
];

const report = [];

for (const { from, to } of SOURCES) {
  const source = await readFile(fileURLToPath(new URL(`../${from}`, import.meta.url)), "utf8");
  const lines = source.split("\n");

  const rewritten = lines.map((line, index) => {
    const match = /^(\s*)font-size:\s*([^;]+);(.*)$/.exec(line);
    if (!match) return line;
    const [, indent, rawValue, tail] = match;
    const value = rawValue.trim();
    // A theme override or an existing token is already correct; `0` is a
    // layout trick (hide text, keep the icon), not a size.
    if (value.startsWith("var(") || value === "0") return line;

    let step;
    if (value === "0.92em") {
      step = "code"; // inline code: reads at the editor's size
    } else if (value.endsWith("px")) {
      step = PX.get(Number.parseFloat(value));
    } else if (value.endsWith("em")) {
      step = EM.get(value.slice(0, -2));
    }
    if (!step) {
      report.push({ file: from, line: index + 1, value, status: "UNMAPPED" });
      return line;
    }

    report.push({ file: from, line: index + 1, value, status: `pi-fs-${step}` });
    const replacement = step === "code" ? "var(--pi-fs-code)" : `var(--pi-fs-${step})`;
    return `${indent}font-size: ${replacement};${tail}`;
  });

  const out = IN_PLACE
    ? fileURLToPath(new URL(`../${from}`, import.meta.url))
    : fileURLToPath(new URL(`../${to}`, import.meta.url));
  if (!IN_PLACE) {
    await mkdir(fileURLToPath(new URL("../preview/styles/", import.meta.url)), { recursive: true });
  }
  await writeFile(out, rewritten.join("\n"), "utf8");
}

const byStatus = new Map();
for (const entry of report) {
  const key = entry.status;
  byStatus.set(key, [...(byStatus.get(key) ?? []), entry]);
}

console.log(`${report.length} hard-coded font sizes found\n`);
for (const [status, entries] of [...byStatus].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${status}  (${entries.length})`);
  if (status === "UNMAPPED") {
    for (const entry of entries) console.log(`   ${entry.file}:${entry.line}  ${entry.value}`);
  } else {
    const values = [...new Set(entries.map((entry) => entry.value))].join(", ");
    console.log(`   from: ${values}`);
  }
}
console.log(
  IN_PLACE
    ? "\nrewrote src/styles/chat.css and src/styles/settings.css in place"
    : "\nwrote preview/styles/chat.proposed.css, preview/styles/settings.proposed.css",
);
