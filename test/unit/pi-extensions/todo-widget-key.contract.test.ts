// The widget key is a literal in two places that cannot import each other: the
// pi extension (`pi-extensions/todo-model.ts`) publishes under it, and the Vue
// component (`webview-vue/src/components/TodoPill.vue`) reads it out of the
// overlays store. Both used to be unchecked copies, so a rename on one side
// would have left the other silently subscribing to nothing.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WIDGET_KEY } from "../../../pi-extensions/todo-model.ts";

describe("todo widget key", () => {
  it("is the key the panel has always listened on", () => {
    expect(WIDGET_KEY).toBe("pi-todo");
  });

  it("is the key TodoPill.vue subscribes to", () => {
    // Read from disk rather than imported: the webview bundle cannot be pulled
    // into the host-side runner, and the string is the whole contract.
    const source = readFileSync("webview-vue/src/components/TodoPill.vue", "utf8");
    expect(source).toContain(WIDGET_KEY);
    // Quoted as well: `"pi-todoX"` contains `pi-todo` as a substring, so the
    // bare check above would let a typo through — the closing quote is what
    // makes this the literal the component actually compares against.
    expect(source).toContain(`"${WIDGET_KEY}"`);
  });
});
