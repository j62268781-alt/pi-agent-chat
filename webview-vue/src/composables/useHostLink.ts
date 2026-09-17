// The single inbound router: maps every `ExtToWebview` message onto store
// actions. The legacy webview spread this across three files and a 1000-line
// `switch`; keeping it in one place is what makes the protocol auditable
// against `src/protocol/messages.ts`.

import type { ExtToWebview } from "@protocol/messages";
import type { RpcCommand, RpcContextUsage, RpcModel, RpcState } from "@protocol/rpc";
import { ref } from "vue";
import { onHostMessage, post } from "@/lib/bridge";
import { useComposerStore } from "@/stores/composer";
import { useDisplayStore } from "@/stores/display";
import { useOverlaysStore } from "@/stores/overlays";
import { useSessionStore } from "@/stores/session";
import { useTranscriptStore } from "@/stores/transcript";

/** Set when the sidebar could not start a session; drives the boot failure card. */
export const bootFailure = ref("");

/** True until the first transcript or error arrives, so the splash stays up. */
export const isBooting = ref(true);

export function useHostLink() {
  const session = useSessionStore();
  const transcript = useTranscriptStore();
  const composer = useComposerStore();
  const overlays = useOverlaysStore();
  const display = useDisplayStore();

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
        break;

      case "sessionFailed":
        bootFailure.value = message.message;
        isBooting.value = false;
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

      case "displaySettings":
        display.apply(message.value);
        break;

      case "messages":
        // Real content for whatever session is now open: an optimistic switch
        // has landed and the "new chat" guide is over.
        session.endSwitch();
        session.pendingNew = false;
        transcript.hydrate(message.messages);
        transcript.historyAvailable = message.historyAvailable === true;
        isBooting.value = false;
        break;

      case "history":
        transcript.appendHistory(message.messages);
        break;

      case "event":
        transcript.applyEvent(message.event);
        isBooting.value = false;
        break;

      case "dialog":
        overlays.dialog = message.request;
        break;

      case "pickedResources":
        if (message.paths.length > 0) composer.insert(message.paths.map((p) => `@${p} `).join(""));
        break;

      case "contextUsage":
        session.contextUsage = message.usage as RpcContextUsage | null;
        session.sessionCost = message.cost ?? null;
        break;

      case "widget":
        if (message.widgetKey === "btw") {
          overlays.btwActive = (message.widgetLines?.length ?? 0) > 0;
          overlays.applyWidget(message.widgetKey, message.widgetLines);
        } else {
          overlays.applyWidget(message.widgetKey, message.widgetLines);
        }
        break;

      case "toast":
        overlays.toast(message.text, message.kind ?? "info");
        break;

      case "infoPanel":
        overlays.infoPanel = { title: message.title, markdown: message.markdown };
        break;

      case "btwAbortReady":
        overlays.btwAbortId = message.id;
        overlays.btwActive = true;
        break;

      case "error":
        session.applyState({ isStreaming: false });
        transcript.statusText = "";
        // An optimistic switch that never got its content: put the previous
        // session back on screen (the host has already toasted the reason).
        session.rollbackSwitch(transcript);
        isBooting.value = false;
        overlays.toast(message.message || "Error", "error");
        break;

      case "prefillInput":
        composer.setDraft(message.text);
        break;

      case "appendInput":
        composer.insert(message.text);
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
    return detach;
  }

  return { connect };
}
