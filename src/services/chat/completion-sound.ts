import { spawn } from "node:child_process";

/**
 * The "a run settled" chime, played by the host instead of the panel.
 *
 * A webview cannot be relied on for this, measured in VS Code 1.138: VS Code
 * creates the window with `autoplayPolicy: "user-gesture-required"`, so a panel
 * the user has not touched refuses to start audio (`play()` rejects with
 * `NotAllowedError`) and the chime only rang when they next clicked in — and a
 * chat view that is put away is *disposed* outright, so a run that ends while the
 * user is elsewhere rang nothing at all. The host process has no such gate: it
 * hands the wav to the platform's own player and the sound comes out wherever the
 * user is.
 *
 * Nothing here may fail loudly. A machine with no player, or a player that dies
 * on startup, leaves the panel exactly as it was — the run is already reported on
 * screen, and a missing chime is not worth an error.
 */

/** The wav as it ships (`resources/` is in .vscodeignore's whitelist). */
export const COMPLETION_SOUND_FILE = "resources/completion.wav";

interface Player {
  command: string;
  args: (file: string) => string[];
}

/** Candidates in order, per platform; the first one that starts wins. */
const PLAYERS: Partial<Record<NodeJS.Platform, Player[]>> = {
  darwin: [{ command: "afplay", args: (file) => [file] }],
  win32: [
    {
      // PowerShell's SoundPlayer takes the wav directly, so the chime is the
      // same one macOS plays. `PlaySync` keeps the process alive for its 225ms.
      command: "powershell.exe",
      args: (file) => [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`,
      ],
    },
  ],
  linux: [
    { command: "paplay", args: (file) => [file] },
    { command: "aplay", args: (file) => ["-q", file] },
  ],
};

export interface CompletionSoundOptions {
  /** Test seam: the spawner (defaults to `child_process.spawn`). */
  spawn?: typeof spawn;
  platform?: NodeJS.Platform;
}

/**
 * Play the chime, detached from the extension host: the player is a short-lived
 * process nobody waits for.
 */
export function playCompletionSound(file: string, options: CompletionSoundOptions = {}): void {
  const run = options.spawn ?? spawn;
  const players = PLAYERS[options.platform ?? process.platform] ?? [];
  const attempt = (index: number): void => {
    const player = players[index];
    if (!player) return;
    try {
      const child = run(player.command, player.args(file), {
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      });
      child.unref();
      // A player this machine does not have (`ENOENT`) is not a failure: the
      // next candidate gets the file instead.
      child.once("error", () => attempt(index + 1));
    } catch {
      attempt(index + 1);
    }
  };
  attempt(0);
}
