// The host plays the chime now: the panel could not be trusted for it (no audio
// rights until it is touched, and disposed outright when the view is put away).
// What matters here is that the right player is asked per platform, that a player
// this machine does not have is not an error, and that nothing ever throws.

import type { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { playCompletionSound } from "../../../../src/services/chat/completion-sound.ts";

const FILE = "/ext/resources/completion.wav";

/** A spawner that records the calls and lets the test fire `error` on any of them. */
function fakeSpawn() {
  const calls: Array<{ command: string; args: string[] }> = [];
  const children: Array<{ fail(): void }> = [];
  const spawner = ((command: string, args: string[]) => {
    calls.push({ command, args });
    const listeners: Array<() => void> = [];
    const child = {
      unref: () => {},
      once: (event: string, listener: () => void) => {
        if (event === "error") listeners.push(listener);
        return child;
      },
      fail: () => listeners.forEach((listener) => listener()),
    };
    children.push(child);
    return child;
  }) as unknown as typeof spawn;
  return { spawner, calls, children };
}

describe("playCompletionSound", () => {
  it("hands the wav to afplay on macOS", () => {
    const { spawner, calls } = fakeSpawn();

    playCompletionSound(FILE, { spawn: spawner, platform: "darwin" });

    expect(calls).toEqual([{ command: "afplay", args: [FILE] }]);
  });

  it("plays it through SoundPlayer on Windows, quoting the path", () => {
    const { spawner, calls } = fakeSpawn();

    playCompletionSound("/ext/it's here/completion.wav", { spawn: spawner, platform: "win32" });

    expect(calls[0]?.command).toBe("powershell.exe");
    expect(calls[0]?.args.join(" ")).toContain(
      "(New-Object Media.SoundPlayer '/ext/it''s here/completion.wav').PlaySync()",
    );
  });

  it("falls through to the next player when one is not installed", () => {
    const { spawner, calls, children } = fakeSpawn();

    playCompletionSound(FILE, { spawn: spawner, platform: "linux" });
    expect(calls.map((c) => c.command)).toEqual(["paplay"]);

    // What a machine without PulseAudio does: `spawn` emits ENOENT.
    children[0]?.fail();
    expect(calls.map((c) => c.command)).toEqual(["paplay", "aplay"]);
  });

  it("stays silent on a platform it has no player for", () => {
    const { spawner, calls } = fakeSpawn();

    playCompletionSound(FILE, { spawn: spawner, platform: "aix" });

    expect(calls).toEqual([]);
  });

  it("does not throw when even starting the player fails", () => {
    const spawner = (() => {
      throw new Error("EPERM");
    }) as unknown as typeof spawn;

    expect(() => playCompletionSound(FILE, { spawn: spawner, platform: "darwin" })).not.toThrow();
  });
});
