import { resolve } from "node:path";
import type { RpcClient, RpcState } from "../../protocol/rpc.ts";
import { t } from "../../utils/i18n.ts";

/**
 * How a session replacement behaves — the operations that move pi onto another
 * session: new, switch, fork, delete, reload. pi rebuilds its whole runtime for
 * each of them (seconds once MCP is configured) and, once started, a
 * replacement cannot be cancelled from outside, so two at once would fight over
 * the same runtime and leave the chat on whichever answered last.
 */
export interface SessionMutationGuard {
  /** The client the operation started on. Compare against it — never re-read
   *  the live one, which is exactly what may have moved underneath. */
  client: RpcClient;
  /**
   * Call after every await that follows a round trip to pi: throws when the
   * chat was closed, or moved to a different pi process (a reload, a restart
   * after a crash) while the step was in flight.
   */
  assertCurrent(): void;
  /**
   * Throws the user-facing reason when the session must not be replaced right
   * now. Checked inside the queued operation rather than at the click, because
   * the run can start while the operation waits its turn.
   */
  assertIdle(): void;
}

/** Why the session cannot be replaced right now. */
export type SessionBusy = "streaming" | "compacting";

export interface SessionMutations {
  /** Runs `operation` after every previously queued one has finished. */
  run<T>(operation: (guard: SessionMutationGuard) => Promise<T>): Promise<T>;
}

export function createSessionMutations(deps: {
  client(): RpcClient;
  disposed(): boolean;
  busy(): SessionBusy | undefined;
}): SessionMutations {
  let tail: Promise<unknown> = Promise.resolve();

  return {
    run<T>(operation: (guard: SessionMutationGuard) => Promise<T>): Promise<T> {
      const start = (): Promise<T> => {
        const client = deps.client();
        if (deps.disposed()) {
          return Promise.reject(new Error(t("This chat was closed before the operation finished.")));
        }
        return operation({
          client,
          assertCurrent: () => {
            if (deps.disposed()) {
              throw new Error(t("This chat was closed before the operation finished."));
            }
            if (deps.client() !== client) {
              throw new Error(t("Pi restarted before the operation finished."));
            }
          },
          assertIdle: () => {
            const reason = sessionBusyReason(deps.busy());
            if (reason) throw new Error(reason);
          },
        });
      };
      const next = tail.then(start, start);
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}

/**
 * The user-facing reason a replacement has to wait. Compaction is named apart
 * from a run: the user can stop a run, but nobody can stop a compaction.
 */
export function sessionBusyReason(busy: SessionBusy | undefined): string | undefined {
  if (busy === "compacting") {
    return t("Wait for pi to finish compacting before changing sessions.");
  }
  if (busy === "streaming") return t("Stop the agent before changing sessions.");
  return undefined;
}

/** What identifies the session pi is on, for comparisons across a replacement. */
export interface SessionIdentity {
  sessionId?: string;
  sessionFile?: string;
}

export function sessionIdentity(state: RpcState | undefined): SessionIdentity {
  return { sessionId: state?.sessionId, sessionFile: state?.sessionFile };
}

export const SESSION_REPLACEMENT_POLL_MS = 100;
/**
 * How long to keep asking after pi has already answered the replacement. The
 * answer means the rebuild finished, so this only covers a state that lags it,
 * or a switch an extension cancelled without saying so.
 */
export const SESSION_REPLACEMENT_TIMEOUT_MS = 15_000;

function sameFile(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && resolve(left) === resolve(right));
}

function identityChanged(before: SessionIdentity, after: RpcState): boolean {
  if (before.sessionId && after.sessionId) return before.sessionId !== after.sessionId;
  if (before.sessionFile && after.sessionFile) {
    return !sameFile(before.sessionFile, after.sessionFile);
  }
  return false;
}

/**
 * Confirms the replacement actually landed, and returns the state it landed on
 * so the caller can post it instead of asking twice.
 *
 * `switch_session` is answered with the runtime pi built, but an extension's
 * before-switch hook can cancel it — and then the answer says `cancelled`
 * rather than failing — and the session a fresh replacement lands on is only
 * known afterwards. So the session on the other side is read back rather than
 * assumed: `expected` is the file the switch asked for, and a replacement with
 * no target is done as soon as pi is on any other session than the one being
 * replaced. With no identity to compare against (the very first session of a
 * fresh process) any answer is terminal, so waiting could only end in a false
 * timeout.
 */
export async function waitForSessionReplacement(
  getState: () => Promise<RpcState>,
  before: SessionIdentity,
  expected?: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<RpcState> {
  const timeoutMs = options.timeoutMs ?? SESSION_REPLACEMENT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? SESSION_REPLACEMENT_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  const hadIdentity = Boolean(before.sessionId || before.sessionFile);

  for (;;) {
    const state = await getState();
    if (expected ? sameFile(state.sessionFile, expected) : identityChanged(before, state) || !hadIdentity) {
      return state;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        expected
          ? t("Pi did not switch to the requested session.")
          : t("Pi did not start the new session."),
      );
    }
    await new Promise((done) => setTimeout(done, pollMs));
  }
}
