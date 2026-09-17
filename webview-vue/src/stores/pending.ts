// The composer's own pending queue.
//
// Why this is not pi's queue: pi exposes `clear_queue` but no per-item
// remove or promote, and `queue_update` reports plain strings with no ids — so
// a message handed to pi can no longer be deleted or steered individually.
// Holding "queue" messages here instead means every entry has an id we own, and
//:
//   delete  = drop it from the list, it was never sent
//   steer   = drop it from the list and send it right now as a steering prompt
//
// pi still owns delivery of a *steer*: it lands after the current assistant turn
// finishes its tool calls and before the next model call, which is the earliest
// meaningful interception point (it does not interrupt the text being written —
// that is what `abort` is for).
//
// The list is persisted through the webview's own `setState`, so it survives the
// one reload path we still have (a locale or mermaid-theme change reassigns
// `webview.html`). It is intentionally not mirrored into the extension host: the
// queue is short-lived, and anything that survives a host restart would have to
// live in pi, which is the trade-off this design rejects.

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { persisted, post } from "@/lib/bridge.ts";
import type { PendingImage } from "./composer.ts";
import { useComposerStore } from "./composer.ts";
import { useSessionStore } from "./session.ts";

export interface PendingMessage {
  /** Locally generated — the handle every per-item action works on. */
  id: string;
  text: string;
  images: PendingImage[];
  /** Delivery method once it leaves the queue. */
  mode: "queue" | "steer";
  createdAt: number;
}

const STATE_KEY = "pendingMessages";

let seq = 0;

export const usePendingStore = defineStore("pending", () => {
  const items = ref<PendingMessage[]>([]);
  /** True while a flush request is in flight, so re-entry cannot double-send. */
  const flushing = ref(false);

  const count = computed(() => items.value.length);
  const isEmpty = computed(() => items.value.length === 0);

  function persist(): void {
    persisted.set({ [STATE_KEY]: items.value });
  }

  /** Reload the queue after a webview reload. */
  function restore(): void {
    const stored = persisted.get<Record<string, unknown>>();
    const list = stored?.[STATE_KEY];
    if (!Array.isArray(list)) return;
    const restored: PendingMessage[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as Partial<PendingMessage>;
      if (typeof entry.id !== "string" || typeof entry.text !== "string") continue;
      restored.push({
        id: entry.id,
        text: entry.text,
        images: Array.isArray(entry.images) ? entry.images : [],
        mode: entry.mode === "steer" ? "steer" : "queue",
        createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
      });
      // Keep our own ids ahead of anything restored.
      const numeric = Number(entry.id.replace(/^pending-/, ""));
      if (Number.isFinite(numeric) && numeric > seq) seq = numeric;
    }
    items.value = restored;
  }

  function enqueue(
    text: string,
    images: PendingImage[],
    mode: "queue" | "steer" = "queue",
  ): string {
    const id = `pending-${++seq}`;
    items.value.push({ id, text, images: [...images], mode, createdAt: Date.now() });
    persist();
    return id;
  }

  /** Drop an item that was never sent. */
  function remove(id: string): boolean {
    const before = items.value.length;
    items.value = items.value.filter((item) => item.id !== id);
    if (items.value.length === before) return false;
    persist();
    return true;
  }

  /** Remove and return an item, so the caller can deliver it immediately. */
  function take(id: string): PendingMessage | undefined {
    const item = items.value.find((candidate) => candidate.id === id);
    if (!item) return undefined;
    items.value = items.value.filter((candidate) => candidate.id !== id);
    persist();
    return item;
  }

  function clear(): void {
    items.value = [];
    persist();
  }

  function send(item: PendingMessage, streamingBehavior?: "steer" | "followUp"): void {
    post({
      type: "prompt",
      message: item.text,
      ...(streamingBehavior ? { streamingBehavior } : {}),
      ...(item.images.length > 0
        ? {
            images: item.images.map((image) => ({
              type: "image" as const,
              data: image.data,
              mimeType: image.mimeType,
            })),
          }
        : {}),
    });
    useComposerStore().remember(item.text);
  }

  /**
   * Deliver a queued item right now as a steering prompt.
   *
   * If the agent has gone idle in the meantime a plain prompt is equivalent —
   * `streamingBehavior` is only meaningful, and only accepted, mid-stream.
   */
  function steerNow(id: string): void {
    const item = take(id);
    if (!item) return;
    send(item, useSessionStore().isStreaming ? "steer" : undefined);
  }

  /**
   * Send the head of the queue, one at a time.
   *
   * Called when the agent settles: pi's default `followUpMode` is
   * `one-at-a-time`, and sending the next item only after the previous turn
   * finished keeps the same observable behaviour while the queue stays ours.
   */
  function flushNext(): void {
    const session = useSessionStore();
    const next = items.value[0];
    if (!next || flushing.value) return;
    // Re-checked here rather than only at the call site: a turn may have started
    // between `agent_settled` and this tick.
    if (session.isStreaming || session.isCompacting) return;
    flushing.value = true;
    items.value = items.value.slice(1);
    persist();
    send(next);
    flushing.value = false;
  }

  return {
    items,
    count,
    isEmpty,
    flushing,
    restore,
    enqueue,
    remove,
    take,
    clear,
    steerNow,
    flushNext,
  };
});
