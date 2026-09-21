// A settings write must never be able to eat the rest of the file.
//
// `saveSettingsPatch` merges into what is on disk, so the merge itself is safe —
// but it used to read through a parser that returned `{}` when `JSON.parse`
// threw. A settings.json with a comment, a trailing comma, or half a write
// therefore parsed as empty, and the very next merge wrote back a file holding
// only the one key being saved: every other setting silently deleted. pi accepts
// comments in this file, so the input is not exotic.
//
// `PI_CODING_AGENT_DIR` is pi's own override for the config directory
// (docs/environment-variables.md:81), which keeps these tests off the real
// ~/.pi/agent.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getSettingsJsonPath,
  saveSettingsPatch,
  toggleFavoriteModel,
} from "../../../../src/services/settings/settings-config.ts";

let dir: string;
const savedEnv = process.env.PI_CODING_AGENT_DIR;

function seed(contents: string): void {
  writeFileSync(getSettingsJsonPath(), contents, "utf8");
}

function readBack(): string {
  return existsSync(getSettingsJsonPath()) ? readFileSync(getSettingsJsonPath(), "utf8") : "";
}

describe("settings.json writes", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-settings-"));
    process.env.PI_CODING_AGENT_DIR = dir;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = savedEnv;
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps sibling keys when merging a patch", () => {
    seed('{"theme":"dark","enabledModels":["a/b"],"nested":{"keep":1}}\n');

    saveSettingsPatch({ nested: { added: 2 }, transport: "sse" });

    expect(JSON.parse(readBack())).toEqual({
      theme: "dark",
      enabledModels: ["a/b"],
      nested: { keep: 1, added: 2 },
      transport: "sse",
    });
  });

  it("refuses to rewrite a file it cannot parse, leaving it untouched", () => {
    const original = '{\n  // pi accepts comments here\n  "theme": "dark"\n}\n';
    seed(original);

    expect(() => saveSettingsPatch({ transport: "sse" })).toThrowError(/settings\.json/);
    expect(readBack()).toBe(original);
  });

  it("refuses a file whose root is not an object", () => {
    seed("[1,2,3]\n");

    expect(() => saveSettingsPatch({ transport: "sse" })).toThrowError(/settings\.json/);
    expect(readBack()).toBe("[1,2,3]\n");
  });

  it("refuses to rewrite a broken file when toggling a favourite model", () => {
    const original = "{ this is not json\n";
    seed(original);

    expect(() => toggleFavoriteModel("qoder", "some/model")).toThrowError(/settings\.json/);
    expect(readBack()).toBe(original);
  });

  it("creates the file when it is missing, which is not a parse failure", () => {
    saveSettingsPatch({ transport: "websocket" });

    expect(JSON.parse(readBack())).toEqual({ transport: "websocket" });
  });
});
