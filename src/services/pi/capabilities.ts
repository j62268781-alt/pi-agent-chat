/**
 * What the pi build on PATH accepts, learned from its own answers.
 *
 * A version number is a poor guide: pi ships commands faster than this
 * extension moves its floor, and the binary decides what it takes, not the
 * release notes. So a command starts presumed available, and only pi's own
 * "Unknown command" reply marks it missing — never an invalid argument, a
 * refused state, or a dead process, which are failures of a command that does
 * exist and must keep reporting as such.
 */
const UNKNOWN_COMMAND_RE = /\b(?:unknown|unsupported|unrecognized)\s+command\b/iu;

export function isUnknownCommandError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (message.length === 0 || message.length > 16 * 1024) return false;
  return UNKNOWN_COMMAND_RE.test(message);
}

export interface PiCapabilities {
  supports(command: string): boolean;
  /** The commands this build has refused, for surfaces that should not offer
   *  them (the webview hides the fork affordance on `fork`). */
  unsupported(): string[];
  /**
   * Records how a command answered. Returns true when the failure meant "this
   * pi does not have it", so the caller can say so instead of reporting a
   * command failure the user cannot act on.
   */
  recordFailure(command: string, error: unknown): boolean;
  /** A command that answered is available again — the reply is from this same
   *  binary, so nothing about a miss learned earlier survives it. */
  recordSuccess(command: string): void;
  /** Nothing learned from one pi process says anything about the next one. */
  reset(): void;
}

export function createPiCapabilities(): PiCapabilities {
  let missing = new Set<string>();
  return {
    supports: (command) => !missing.has(command),
    unsupported: () => [...missing],
    recordFailure: (command, error) => {
      if (!isUnknownCommandError(error)) return false;
      missing.add(command);
      return true;
    },
    recordSuccess: (command) => {
      missing.delete(command);
    },
    reset: () => {
      missing = new Set<string>();
    },
  };
}
