// Session-level state shared by the toolbar and the composer: which session is
// open, which models/thinking levels are available, the permission gate mode,
// the session switcher list and the context-usage ring.
//
// The host owns all of this; this store only mirrors what it pushes down.

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { RpcCommand, RpcContextUsage, RpcModel } from "@protocol/rpc";
import type { PermissionMode, SessionListItem } from "@protocol/messages";
import { aggregateUsage, type UsageTotals } from "@/lib/usage";

/** `provider/modelId` — the key the host uses for the favourites list. */
function modelKey(provider: string, id: string): string {
  return `${provider}/${id}`;
}

export const useSessionStore = defineStore("session", () => {
  const sessionFile = ref<string | null>(null);
  const sessionName = ref("");
  const model = ref<RpcModel | null>(null);
  const thinkingLevel = ref("");
  const isStreaming = ref(false);
  const isCompacting = ref(false);
  const isBtwLoading = ref(false);
  const messageCount = ref(0);

  const models = ref<RpcModel[]>([]);
  const thinkingLevels = ref<string[]>([]);
  const commands = ref<RpcCommand[]>([]);
  /** `provider/id` keys the user starred; drives model-picker ordering. */
  const enabledModelKeys = ref<string[]>([]);
  const permissionMode = ref<PermissionMode>("AskForApproval");
  const sendShortcut = ref<"enter" | "ctrlEnter">("enter");

  const sessionList = ref<SessionListItem[]>([]);
  const contextUsage = ref<RpcContextUsage | null>(null);
  const sessionCost = ref<number | null>(null);

  /** Local usage totals, recomputed as the transcript grows. */
  const totals = ref<UsageTotals>({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });

  const currentModelLabel = computed(() => {
    const selected = model.value;
    if (!selected) return "";
    return selected.name || selected.id;
  });

  /** 0-100 for the context ring; `0` when the host has not reported usage yet. */
  const contextPercent = computed(() => {
    const percent = contextUsage.value?.percent;
    if (typeof percent !== "number" || !Number.isFinite(percent)) return 0;
    return Math.min(100, Math.max(0, percent));
  });

  const isFavorite = (candidate: RpcModel): boolean =>
    enabledModelKeys.value.includes(modelKey(candidate.provider, candidate.id));

  function applyState(state: {
    model?: RpcModel | null;
    thinkingLevel?: string;
    isStreaming?: boolean;
    isCompacting?: boolean;
    sessionFile?: string;
    sessionName?: string;
    messageCount?: number;
  }): void {
    if (state.model !== undefined) model.value = state.model;
    if (state.thinkingLevel !== undefined) thinkingLevel.value = state.thinkingLevel;
    if (state.isStreaming !== undefined) isStreaming.value = state.isStreaming;
    if (state.isCompacting !== undefined) isCompacting.value = state.isCompacting;
    if (state.sessionFile !== undefined) sessionFile.value = state.sessionFile;
    if (state.sessionName !== undefined) sessionName.value = state.sessionName;
    if (state.messageCount !== undefined) messageCount.value = state.messageCount;
  }

  /** Recompute the local usage totals from the hydrated transcript. */
  function recomputeTotals(messages: readonly unknown[]): void {
    totals.value = aggregateUsage(messages);
  }

  function toggleFavoriteLocally(provider: string, id: string): void {
    const key = modelKey(provider, id);
    enabledModelKeys.value = enabledModelKeys.value.includes(key)
      ? enabledModelKeys.value.filter((entry) => entry !== key)
      : [...enabledModelKeys.value, key];
  }

  return {
    sessionFile,
    sessionName,
    model,
    thinkingLevel,
    isStreaming,
    isCompacting,
    isBtwLoading,
    messageCount,
    models,
    thinkingLevels,
    commands,
    enabledModelKeys,
    permissionMode,
    sendShortcut,
    sessionList,
    contextUsage,
    sessionCost,
    totals,
    currentModelLabel,
    contextPercent,
    isFavorite,
    applyState,
    recomputeTotals,
    toggleFavoriteLocally,
    modelKey,
  };
});
