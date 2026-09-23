import { describe, expect, it } from "vitest";
import {
  createPiCapabilities,
  isUnknownCommandError,
} from "../../../../src/services/pi/capabilities.ts";

describe("isUnknownCommandError", () => {
  it("recognizes the reply pi gives for a command it does not have", () => {
    expect(isUnknownCommandError(new Error("Unknown command: clone"))).toBe(true);
    expect(isUnknownCommandError("Unknown command: clone")).toBe(true);
    expect(isUnknownCommandError(new Error("unsupported command fork"))).toBe(true);
    expect(isUnknownCommandError(new Error("Unrecognized Command: x"))).toBe(true);
  });

  it("does not mistake a real failure of a supported command for a missing one", () => {
    expect(isUnknownCommandError(new Error("Invalid argument: entryId"))).toBe(false);
    expect(isUnknownCommandError(new Error("Cannot switch: an extension cancelled it"))).toBe(
      false,
    );
    expect(isUnknownCommandError(new Error("Pi RPC process exited"))).toBe(false);
    expect(isUnknownCommandError(new Error(""))).toBe(false);
    expect(isUnknownCommandError(undefined)).toBe(false);
    expect(isUnknownCommandError({ message: "Unknown command: x" })).toBe(false);
  });

  it("ignores a message too large to be pi's own reply", () => {
    expect(isUnknownCommandError(new Error("Unknown command: x" + "y".repeat(16 * 1024)))).toBe(
      false,
    );
  });
});

describe("createPiCapabilities", () => {
  it("presumes a command is available until pi says otherwise", () => {
    const capabilities = createPiCapabilities();
    expect(capabilities.supports("fork")).toBe(true);
    expect(capabilities.unsupported()).toEqual([]);
  });

  it("marks only the command pi refused, and reports that it did", () => {
    const capabilities = createPiCapabilities();
    expect(capabilities.recordFailure("fork", new Error("Unknown command: fork"))).toBe(true);
    expect(capabilities.supports("fork")).toBe(false);
    expect(capabilities.unsupported()).toEqual(["fork"]);
    // Another command's own failure says nothing about it.
    expect(capabilities.recordFailure("switch_session", new Error("Invalid argument"))).toBe(false);
    expect(capabilities.supports("switch_session")).toBe(true);
  });

  it("re-enables a command that answered", () => {
    const capabilities = createPiCapabilities();
    capabilities.recordFailure("fork", new Error("Unknown command: fork"));
    capabilities.recordSuccess("fork");
    expect(capabilities.supports("fork")).toBe(true);
    expect(capabilities.unsupported()).toEqual([]);
  });

  it("forgets everything about the previous binary on reset", () => {
    const capabilities = createPiCapabilities();
    capabilities.recordFailure("fork", new Error("Unknown command: fork"));
    capabilities.reset();
    expect(capabilities.supports("fork")).toBe(true);
    expect(capabilities.unsupported()).toEqual([]);
  });
});
