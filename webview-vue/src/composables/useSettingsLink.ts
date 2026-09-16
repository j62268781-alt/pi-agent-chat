// The settings panel's inbound router: every `SettingsToWebview` message maps to
// exactly one store action, mirroring the legacy `window.addEventListener`
// switch in `pi-settings/src/main.ts`.
//
// Deliberately separate from the chat panel's `useHostLink.ts`: the two panels
// are different webviews with different contracts, and `init`/`ready` mean
// opposite things on each side.

import type { SettingsToWebview } from "@protocol/settings";
import { isSettingsTabId } from "@protocol/settings";
import { onHostMessage } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import { useSettingsStore } from "@/stores/settings.ts";

export function useSettingsLink() {
  const store = useSettingsStore();

  function handle(message: SettingsToWebview): void {
    switch (message.type) {
      case "init":
        store.applyInit(message);
        break;

      case "setTab":
        // Sent when an already-open panel is re-opened on a specific tab.
        if (isSettingsTabId(message.tab)) store.selectTab(message.tab);
        break;

      case "tabData":
        store.applyTabData(message.tab, message.data);
        break;

      case "saved":
        store.applySaved(message.what);
        break;

      case "oauthProgress":
        store.applyOAuth(message.event);
        break;

      case "error":
        store.fail(message.message || t("Unknown error"));
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
    // `onHostMessage` is typed against the chat contract, so narrow here.
    const detach = onHostMessage((message) => handle(message as unknown as SettingsToWebview));
    // The host answers `ready` with `init`, which loads the first tab.
    store.send({ type: "ready" });
    return detach;
  }

  return { connect };
}
