// Settings-panel state. One store for the whole panel: the tab catalogue, the
// per-tab `tabData` cache, the toast queue and the in-flight state that drives
// the "Loading…" placeholder.
//
// The host owns every byte of the data; this store only mirrors what it pushes
// down and posts the messages the editors build. See
// `src/protocol/settings.ts` for the wire contract.

import { defineStore } from "pinia";
import { ref } from "vue";
import type { WebviewToExt } from "@protocol/messages";
import type {
  OAuthProgressEvent,
  SavedWhat,
  SettingsMessageOf,
  SettingsTabDataMap,
  SettingsTabId,
  SettingsToWebview,
  WebviewToSettings,
} from "@protocol/settings";
import { isSettingsTabId } from "@protocol/settings";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";

/** One entry of the sidebar. Labels/icons are webview-owned: `init.tabs` only
 * carries ids, so the presentation lives here. */
export interface TabDescriptor {
  id: SettingsTabId;
  label: string;
  icon: string;
}

export interface SettingsToast {
  id: number;
  text: string;
  kind: "info" | "success" | "error";
  /** Flipped on the frame after insertion so the CSS transition runs. */
  show: boolean;
}

/** Icon ids must already have a `::before` rule in `styles/settings.css`. */
function tabDescriptors(): TabDescriptor[] {
  return [
    { id: "models", label: t("Models"), icon: "codicon-versions" },
    { id: "agents", label: t("Agents"), icon: "codicon-hubot" },
    { id: "prompts", label: t("Prompt Templates"), icon: "codicon-quote" },
    { id: "skills", label: t("Skills"), icon: "codicon-rocket" },
    { id: "mcp", label: t("MCP Servers"), icon: "codicon-server" },
    { id: "commit", label: t("Commit Message"), icon: "codicon-git-commit" },
    { id: "sysprompt", label: t("System Prompt"), icon: "codicon-file-text" },
    { id: "settings", label: t("Settings"), icon: "codicon-settings-gear" },
  ];
}

export const useSettingsStore = defineStore("settings", () => {
  const tabs = ref<TabDescriptor[]>(tabDescriptors());
  const activeTab = ref<SettingsTabId>("models");
  /** Per-tab `tabData` cache, keyed by tab id. */
  const data = ref<Record<string, unknown>>({});
  const loading = ref(true);
  const error = ref("");
  const saving = ref(false);
  const ready = ref(false);
  const lang = ref("");
  const hasWorkspace = ref(false);
  const oauth = ref<OAuthProgressEvent | null>(null);
  const toast = ref<SettingsToast | null>(null);

  let toastSeq = 0;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * `lib/bridge.ts` is typed against the chat contract; the settings panel
   * speaks its own. One cast here keeps every call site type-checked.
   */
  function send(message: WebviewToSettings): void {
    post(message as unknown as WebviewToExt);
  }

  /** Typed read of the cache; `undefined` until the host answered. */
  function tabData<K extends SettingsTabId>(id: K): SettingsTabDataMap[K] | undefined {
    return data.value[id] as SettingsTabDataMap[K] | undefined;
  }

  function showToast(text: string, kind: SettingsToast["kind"] = "info"): void {
    const id = ++toastSeq;
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toast.value = { id, text, kind, show: false };
    requestAnimationFrame(() => {
      if (toast.value?.id === id) toast.value.show = true;
    });
    toastTimer = setTimeout(() => {
      if (toast.value?.id !== id) return;
      toast.value.show = false;
      toastTimer = setTimeout(() => {
        if (toast.value?.id === id) toast.value = null;
      }, 200);
    }, 3000);
  }

  function loadTab(id: SettingsTabId): void {
    if (!data.value[id]) loading.value = true;
    send({ type: "tabLoad", tab: id });
  }

  function selectTab(id: SettingsTabId): void {
    activeTab.value = id;
    error.value = "";
    // Only a cold tab raises the placeholder; a cached one renders while its
    // refresh is in flight.
    loading.value = data.value[id] === undefined;
    send({ type: "tabLoad", tab: id });
  }

  function refresh(): void {
    error.value = "";
    if (data.value[activeTab.value] === undefined) loading.value = true;
    send({ type: "refresh", tab: activeTab.value });
  }

  /** Local merge into the cache — avoids a full `tabLoad` round trip. */
  function patch(tabId: SettingsTabId, value: Record<string, unknown>): void {
    const current = data.value[tabId];
    const base =
      current !== null && typeof current === "object" ? (current as Record<string, unknown>) : {};
    data.value[tabId] = { ...base, ...value };
  }

  function applyInit(message: SettingsMessageOf<SettingsToWebview, "init">): void {
    lang.value = message.lang;
    hasWorkspace.value = message.hasWorkspace;
    const advertised = message.tabs;
    if (advertised.length > 0) {
      tabs.value = tabs.value.filter((descriptor) => advertised.includes(descriptor.id));
    }
    const initial =
      message.initialTab && isSettingsTabId(message.initialTab) ? message.initialTab : null;
    ready.value = true;
    selectTab(initial ?? tabs.value[0]?.id ?? "models");
  }

  function applyTabData(tab: string, payload: Record<string, unknown>): void {
    if (!isSettingsTabId(tab)) return;
    data.value[tab] = payload;
    if (tab === activeTab.value) {
      loading.value = false;
      error.value = "";
    }
  }

  function applySaved(what: SavedWhat): void {
    saving.value = false;
    switch (what) {
      case "settings":
        showToast(t("Settings saved — restart pi to apply"), "success");
        break;
      case "system":
        showToast(t("System prompt saved"), "success");
        break;
      case "append":
        showToast(t("Append prompt saved"), "success");
        break;
      case "commit":
        showToast(t("Commit message settings saved"), "success");
        break;
      default:
        break;
    }
  }

  function fail(message: string): void {
    saving.value = false;
    loading.value = false;
    error.value = message;
    showToast(message || t("Unknown error"), "error");
  }

  function applyOAuth(event: OAuthProgressEvent): void {
    oauth.value = event;
  }

  function dismissOAuth(): void {
    oauth.value = null;
  }

  function markSaving(): void {
    saving.value = true;
  }

  return {
    tabs,
    activeTab,
    data,
    loading,
    error,
    saving,
    ready,
    lang,
    hasWorkspace,
    oauth,
    toast,
    send,
    tabData,
    showToast,
    loadTab,
    selectTab,
    refresh,
    patch,
    applyInit,
    applyTabData,
    applySaved,
    fail,
    applyOAuth,
    dismissOAuth,
    markSaving,
  };
});
