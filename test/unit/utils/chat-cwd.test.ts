import { describe, expect, it } from "vitest";
import { configureDevHostRoot, resolveChatCwd } from "../../../src/utils/chat-cwd.ts";

describe("resolveChatCwd", () => {
  it("prefers the workspace folder over the dev-host fallback", () => {
    configureDevHostRoot("/repo", false);
    expect(resolveChatCwd("/project")).toBe("/project");
  });

  it("falls back to the extension's own folder in a dev host with no folder", () => {
    configureDevHostRoot("/repo", false);
    expect(resolveChatCwd(undefined)).toBe("/repo");
  });

  it("has no fallback in a production install, where a folderless window means no project", () => {
    configureDevHostRoot("/extensions/pi-agent-chat-1.0.0", true);
    expect(resolveChatCwd(undefined)).toBeUndefined();
  });
});
