// The 常规 tab talks to a host table that lives in the other package, so the
// two sides can drift silently: a field the host will not write saves nothing,
// and a fallback that disagrees with the field's default shows a checkbox one
// way and stores the other. There is no type that spans them, so this reads the
// host file and checks the contract by name.
//
// It runs in the webview package because that is where the field schema (and a
// runner) already are; the path walks out to the extension source on purpose.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHAT_SETTING_GROUPS } from "@/components/settings/general-fields.ts";

const host = readFileSync("../src/providers/settings/settings-panel.ts", "utf8");

/** `{ key: "chatX", fallback: true }` -> true, from the host's table. */
function hostFallback(key: string): string | null {
  const match = new RegExp(`key: "${key}", fallback: ([^,}]+)`).exec(host);
  return match?.[1]?.trim() ?? null;
}

describe("the 常规 tab's settings contract", () => {
  const fields = CHAT_SETTING_GROUPS.flatMap((group) => group.fields);

  it("only shows fields the host is willing to write", () => {
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      // The whitelist is built from the same table, so the key has to appear.
      expect(hostFallback(field.key), field.key).not.toBeNull();
      expect(host, field.key).toContain(`key: "${field.key}"`);
    }
  });

  it("agrees with the host about what an unset value looks like", () => {
    for (const field of fields) {
      if (field.def === undefined) continue;
      const expected =
        typeof field.def === "boolean"
          ? String(field.def)
          : JSON.stringify(String(field.def)).replace(/'/g, '"');
      expect(hostFallback(field.key), field.key).toBe(expected);
    }
  });
});
