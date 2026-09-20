import { describe, expect, it } from "vitest";
import {
  EXTENSION_MODE_PRODUCTION,
  shouldRegisterTestingCommands,
} from "../../../src/commands/testing-gate.ts";

describe("shouldRegisterTestingCommands", () => {
  it("is false in Production so the shipped vsix has no stimulus surface", () => {
    expect(shouldRegisterTestingCommands(EXTENSION_MODE_PRODUCTION)).toBe(false);
  });

  it("is true in Development (2) and Test (3)", () => {
    // vscode.ExtensionMode is a stable numeric enum: Production=1,
    // Development=2, Test=3. The gate is duplicated here as numbers because
    // testing-gate.ts deliberately does not import `vscode` — that keeps this
    // unit test runnable under vitest.
    expect(shouldRegisterTestingCommands(2)).toBe(true);
    expect(shouldRegisterTestingCommands(3)).toBe(true);
  });

  it("is true for unknown modes rather than silently disabling the harness", () => {
    expect(shouldRegisterTestingCommands(99)).toBe(true);
  });
});
