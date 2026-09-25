// The single inbound router: maps every `ExtToWebview` message onto store
// actions. The legacy webview spread this across three files and a 1000-line
// `switch`; keeping it in one place is what makes the protocol auditable
// against `src/protocol/messages.ts`.

import type { ExtToWebview } from "@protocol/messages";
import type { RpcCommand, RpcContextUsage, RpcModel, RpcState } from "@protocol/rpc";
import { ref } from "vue";
import { onHostMessage, post } from "@/lib/bridge";
import { t } from "@/lib/i18n";
import { playCompletionChime } from "@/lib/sound";
import { useComposerStore } from "@/stores/composer";
import { useDisplayStore } from "@/stores/display";
import { useOverlaysStore } from "@/stores/overlays";
import { usePendingStore } from "@/stores/pending";
import { useSessionStore } from "@/stores/session";
import { useTranscriptStore } from "@/stores/transcript";

/** Set when the sidebar could not start a session; drives the boot failure card. */
export const bootFailure = ref("");

/** True until the first transcript or error arrives, so the splash stays up. */
export const isBooting = ref(true);

/**
 * How long the splash waits for the host's first content message before it offers
 * a way out.
 *
 * pi answers in ~4.5s when its packages are already in place. It answers much
 * later when it decides a declared `packages` entry is behind the registry: a
 * reconciliation measured 20-40s here, and one cold run went past 90s. (An
 * earlier note here claimed the installs happened on *every* boot — they do not;
 * pinning the versions in `settings.json` removes them entirely.)
 *
 * Without a deadline the splash would just sit there. The card is now dismissed
 * by the first real content, so a too-eager deadline costs a flash rather than
 * burying the session.
 */
const BOOT_TIMEOUT_MS = 60_000;

let bootTimer: number | undefined;

/** The session produced something: stop waiting and drop the deadline. */
function settleBoot(): void {
  isBooting.value = false;
  if (bootTimer !== undefined) {
    clearTimeout(bootTimer);
    bootTimer = undefined;
  }
}

/**
 * Arm the deadline. Called when the link opens and again on every retry, so the
 * failure card and the splash can trade places as often as the user retries.
 */
export function startBootWatchdog(): void {
  if (bootTimer !== undefined) clearTimeout(bootTimer);
  bootTimer = window.setTimeout(() => {
    bootTimer = undefined;
    if (!isBooting.value) return;
    bootFailure.value = t(
      "pi has not answered in {0}s — it may still be installing its packages. Wait a little longer, or retry.",
      Math.round(BOOT_TIMEOUT_MS / 1000),
    );
  }, BOOT_TIMEOUT_MS);
}

export function useHostLink() {
  const session = useSessionStore();
  const transcript = useTranscriptStore();
  const composer = useComposerStore();
  const overlays = useOverlaysStore();
  const display = useDisplayStore();
  const pending = usePendingStore();

  /**
   * A run ended on its own — ring the panel's chime, unless the setting is off
   * or the user is the one who ended it: a stop means they already left that
   * answer behind, and a chime would call them back to it. `stopReason` is
   * written by `message_end`, which lands before `agent_settled`.
   */
  function chime(): void {
    if (!display.completionSound) return;
    if (transcript.turns.at(-1)?.stopReason === "aborted") return;
    playCompletionChime();
  }

  function handle(message: ExtToWebview): void {
    switch (message.type) {
      case "ready":
        break;

      case "state":
        session.applyState(message.state as RpcState);
        break;

      case "sessionInfo":
        session.sessionFile = message.sessionFile;
        session.sessionName = message.label;
        session.sessionModified = message.modified;
        break;

      case "sessionFailed":
        // The session is dead rather than slow: drop the running affordances and
        // undo an optimistic switch, then let the card carry the reason.
        session.awaitingAgent = false;
        session.applyState({ isStreaming: false });
        transcript.statusText = "";
        session.rollbackSwitch(transcript);
        session.piFailure = message.message;
        bootFailure.value = message.message;
        settleBoot();
        break;

      case "models":
        session.models = message.models as RpcModel[];
        break;

      case "enabledModels":
        session.enabledModelKeys = message.keys;
        break;

      case "thinkingLevels":
        session.thinkingLevels = message.levels;
        break;

      case "permissionMode":
        session.permissionMode = message.mode;
        break;

      case "sessionsList":
        session.sessionList = message.sessions;
        break;

      case "commands":
        session.commands = message.commands as RpcCommand[];
        break;

      case "capabilities":
        session.unsupportedCommands = message.unsupported;
        break;

      case "workspaceRequired":
        session.workspaceRequired = message.required;
        // No folder: the boot page becomes the answer, not a wait. A folder that
        // arrives later puts the splash back while the session it starts boots.
        if (message.required) {
          settleBoot();
        } else {
          isBooting.value = true;
          startBootWatchdog();
        }
        break;

      case "displaySettings":
        display.apply(message.value);
        break;

      case "messages":
        // Real content for whatever session is now open: an optimistic switch
        // has landed and the "new chat" guide is over.
        session.endSwitch();
        session.pendingNew = false;
        session.piFailure = "";
        // The watchdog may already have fired while pi was installing its
        // packages; this is the proof it came back, so the card has to go.
        bootFailure.value = "";
        transcript.hydrate(message.messages);
        transcript.historyAvailable = message.historyAvailable === true;
        settleBoot();
        break;

      case "history":
        transcript.appendHistory(message.messages);
        break;

      case "event": {
        // An event is just as much proof of life as a message burst.
        bootFailure.value = "";
        transcript.applyEvent(message.event);
        if ((message.event as { type?: string }).type === "agent_settled") {
          // The turn just settled, so the head of the pending queue is deliverable.
          pending.flushNext();
          chime();
        }
        settleBoot();
        break;
      }

      case "dialog":
        overlays.dialog = message.request;
        break;

      case "pickedResources":
        if (message.paths.length > 0) composer.insert(message.paths.map((p) => `@${p} `).join(""));
        break;

      case "contextUsage":
        session.contextUsage = message.usage as RpcContextUsage | null;
        session.sessionCost = message.cost ?? null;
        // Kept when a push carries none: the compaction path synthesizes a usage
        // reading of its own, and dropping the statistics there would empty half
        // the ring's card until the next turn ends.
        if (message.stats) session.stats = message.stats;
        break;

      case "widget":
        overlays.applyWidget(message.widgetKey, message.widgetLines);
        break;

      case "toast":
        overlays.toast(message.text, message.kind ?? "info");
        break;

      case "infoPanel":
        overlays.infoPanel = { title: message.title, markdown: message.markdown };
        break;

      case "promptRejected":
        // pi would not take it, so the queue does. Nothing about the run changed,
        // which is why this is not the `error` case below.
        session.awaitingAgent = false;
        pending.reject(message.ackId);
        overlays.toast(message.message || t("The queued message was not sent"), "error");
        break;

      case "error":
        session.awaitingAgent = false;
        session.applyState({ isStreaming: false });
        transcript.statusText = "";
        // An optimistic switch that never got its content: put the previous
        // session back on screen (the host has already toasted the reason).
        session.rollbackSwitch(transcript);
        settleBoot();
        overlays.toast(message.message || "Error", "error");
        break;

      case "prefillInput":
        composer.setDraft(message.text);
        break;

      case "appendInput":
        composer.insert(message.text);
        break;

      case "addContextChips":
        composer.addContextChips(message.chips);
        break;

      case "files":
        if (
          composer.autocomplete?.kind === "file" &&
          composer.autocomplete.query === message.query
        ) {
          composer.autocomplete = {
            ...composer.autocomplete,
            items: message.files.map((file) => ({ value: file, label: file })),
          };
        }
        break;

      default:
        break;
    }
  }

  /**
   * Start listening and announce readiness. Call from the page's `onMounted`;
   * the returned function detaches the listener.
   */
  function connect(): () => void {
    const detach = onHostMessage(handle);
    // The host answers `webviewReady` with the hydration burst.
    post({ type: "webviewReady" });
    startBootWatchdog();
    return detach;
  }

  return { connect };
}
