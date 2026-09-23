// Session-level state shared by the toolbar and the composer: which session is
// open, which models/thinking levels are available, the permission gate mode,
// the session switcher list and the context-usage ring.
//
// The host owns all of this; this store only mirrors what it pushes down.

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { RpcCommand, RpcContextUsage, RpcModel, RpcSessionStats } from "@protocol/rpc";
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
  /**
   * Commands this pi build answered "unknown" to. Only ever a downgrade from
   * the host's own probe of the running binary, never a guess from a version
   * number.
   */
  const unsupportedCommands = ref<string[]>([]);
  /** `provider/id` keys the user starred; drives model-picker ordering. */
  const enabledModelKeys = ref<string[]>([]);
  const permissionMode = ref<PermissionMode>("AskForApproval");

  const sessionList = ref<SessionListItem[]>([]);
  const contextUsage = ref<RpcContextUsage | null>(null);
  const sessionCost = ref<number | null>(null);
  /**
   * pi's own session statistics — tokens split, message and tool-call counts,
   * cost and context usage in one answer (`get_session_stats`). The ring's card
   * reads it; it stays on the last reading when a push arrives without one.
   */
  const stats = ref<RpcSessionStats | null>(null);

  /**
   * Set by the "+" button: the guide is showing but pi has no session for it
   * yet — the host creates one when the first message is sent. Cleared when the
   * host pushes real transcript content (a switch or that first send).
   */
  const pendingNew = ref(false);

  /**
   * Optimistic switch bookkeeping: the row highlight and the header move the
   * moment a session is clicked, while pi is still loading it. If the host
   * reports an error instead of content, the snapshot puts everything back.
   */
  const switchSnapshot = ref<{ file: string | null; name: string; messages: unknown[] } | null>(
    null,
  );

  function beginSwitch(file: string, name: string, messages: unknown[]): void {
    switchSnapshot.value = { file: sessionFile.value, name: sessionName.value, messages };
    sessionFile.value = file;
    sessionName.value = name;
    pendingNew.value = false;
  }

  /** The switch landed: drop the snapshot. */
  function endSwitch(): void {
    switchSnapshot.value = null;
  }

  /** The switch failed: put the previous session back on screen. */
  function rollbackSwitch(transcript: { restore: (messages: unknown[]) => void }): void {
    const snapshot = switchSnapshot.value;
    if (!snapshot) return;
    switchSnapshot.value = null;
    sessionFile.value = snapshot.file;
    sessionName.value = snapshot.name;
    transcript.restore(snapshot.messages);
  }

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

  /**
   * Why the session is dead, `""` while it is alive. The model chip needs this:
   * a pi that crashed leaves `models` empty, and "No models configured" sends the
   * user looking at the wrong thing entirely.
   */
  const piFailure = ref("");
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
    unsupportedCommands,
    enabledModelKeys,
    permissionMode,
    piFailure,
    sessionList,
    pendingNew,
    /** Non-null exactly while a switch is in flight (see `beginSwitch`). */
    switchSnapshot,
    beginSwitch,
    endSwitch,
    rollbackSwitch,
    contextUsage,
    sessionCost,
    stats,
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
