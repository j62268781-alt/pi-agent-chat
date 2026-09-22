// The bridge is two halves written in two languages: the pi extension calls host
// methods by name, and the host answers them in a `switch`. Nothing else compares
// the two lists, so a rename on either side would surface at runtime — inside a
// user's session, as a tool call that fails.
//
// The bootstrap prompt is checked the same way: it names the tools the agent
// should reach for, and a prompt that promises a tool nobody registered is worse
// than no prompt at all.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRIDGE_BOOTSTRAP_PROMPT } from "../../../../src/utils/constants.ts";

const EXTENSION = "pi-extensions/pi-vscode-bridge.js";
const HANDLERS = "src/services/bridge/handlers.ts";

/** Methods the host answers — `case "getHover":` and friends. */
function hostMethods(): Set<string> {
  const source = readFileSync(HANDLERS, "utf8");
  return new Set([...source.matchAll(/case "([A-Za-z]+)":/g)].map((match) => match[1] as string));
}

/** Methods the extension asks for: the method expression of each bridge call. */
function calledMethods(): Set<string> {
  const source = readFileSync(EXTENSION, "utf8");
  const methods = new Set<string>();
  // Only the leading argument is the method; the rest is the params object, whose
  // string literals are not method names.
  for (const call of source.matchAll(/(?:callBridge|jsonResult)\(([^)]*)/g)) {
    const leading = (call[1] ?? "").split(",")[0] ?? "";
    for (const literal of leading.matchAll(/"([A-Za-z]+)"/g)) methods.add(literal[1] as string);
  }
  return methods;
}

/** Tool names the extension registers with pi. */
function registeredTools(): string[] {
  const source = readFileSync(EXTENSION, "utf8");
  return [...source.matchAll(/name: "(vscode_[a-z_]+)"/g)].map((match) => match[1] as string);
}

describe("the vscode bridge contract", () => {
  it("only calls methods the host implements", () => {
    const handled = hostMethods();
    const called = [...calledMethods()];

    expect(called.length).toBeGreaterThan(5); // the extraction found something
    for (const method of called) expect(handled.has(method), method).toBe(true);
  });

  it("registers the diagnostics tool and nothing twice", () => {
    const tools = registeredTools();

    expect(tools).toContain("vscode_get_diagnostics");
    expect(new Set(tools).size).toBe(tools.length);
  });

  it("promises the agent no tool that is not registered", () => {
    const registered = new Set(registeredTools());
    const promised = [...BRIDGE_BOOTSTRAP_PROMPT.matchAll(/\bvscode_[a-z_]+\b/g)].map(
      (match) => match[0],
    );

    expect(promised.length).toBeGreaterThan(5);
    for (const name of promised) expect(registered.has(name), name).toBe(true);
  });

  it("keeps the finished-run toast behind the window-focus gate", () => {
    // Two halves again: the extension asks for the gate on its `agent_settled`
    // toast, the host honours it. Either side losing the flag turns the "finished
    // while you were away" marker back into a toast on every single run (彬哥).
    const extension = readFileSync(EXTENSION, "utf8");
    const settle = extension.slice(extension.indexOf('pi.on("agent_settled"'));
    expect(settle.slice(0, 600)).toContain("onlyWhenUnfocused: true");

    const handler = readFileSync(HANDLERS, "utf8");
    const fn = handler.slice(handler.indexOf("async function showNotification"));
    expect(fn.slice(0, 900)).toMatch(
      /onlyWhenUnfocused[\s\S]{0,400}vscode\.window\.state\.focused/,
    );
  });
});
