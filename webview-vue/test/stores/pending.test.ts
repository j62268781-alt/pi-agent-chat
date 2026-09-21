// What a held message can never be allowed to do is disappear.
//
// Both delivery paths take the item out of the list *before* pi has accepted it,
// and pi rejects a prompt outright when compaction is in progress — plus, less
// predictably, when no model is selected or auth fails. Without a way back, a
// rejected 引导 was one lost row in the queue and the text only survived in the
// composer's up-arrow history. So: refuse the compaction case up front, and put
// anything pi rejects back where it came from.

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePendingStore } from "@/stores/pending.ts";
import { useSessionStore } from "@/stores/session.ts";

const { posted } = vi.hoisted(() => ({ posted: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/bridge.ts", () => ({
  post: (message: Record<string, unknown>) => {
    posted.push(message);
  },
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

function seedQueue(): ReturnType<typeof usePendingStore> {
  const pending = usePendingStore();
  pending.enqueue("第一条", []);
  pending.enqueue("第二条", []);
  pending.enqueue("第三条", []);
  return pending;
}

/** The ack id the last posted prompt carries. */
function lastAckId(): string {
  const ackId = posted[posted.length - 1]?.ackId;
  expect(typeof ackId).toBe("string");
  return ackId as string;
}

describe("pending queue — delivery that can fail", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    posted.length = 0;
  });

  it("refuses to steer while a compaction is in progress, keeping the item", () => {
    const pending = seedQueue();
    useSessionStore().isCompacting = true;

    expect(pending.steerNow(pending.items[1]!.id)).toBe(false);
    expect(posted).toEqual([]);
    expect(pending.items.map((item) => item.text)).toEqual(["第一条", "第二条", "第三条"]);
  });

  it("carries an ack id on the steered prompt so a rejection can be traced back", () => {
    const pending = seedQueue();
    useSessionStore().isStreaming = true;

    expect(pending.steerNow(pending.items[1]!.id)).toBe(true);
    expect(posted).toEqual([
      {
        type: "prompt",
        message: "第二条",
        streamingBehavior: "steer",
        ackId: lastAckId(),
      },
    ]);
    expect(pending.items.map((item) => item.text)).toEqual(["第一条", "第三条"]);
  });

  it("puts a rejected steer back in its original position", () => {
    const pending = seedQueue();
    useSessionStore().isStreaming = true;
    const id = pending.items[1]!.id;

    pending.steerNow(id);
    expect(pending.reject(lastAckId())).toBe(true);

    expect(pending.items.map((item) => item.text)).toEqual(["第一条", "第二条", "第三条"]);
    expect(pending.items[1]!.id).toBe(id);
  });

  it("sends the head as a plain prompt, and returns it if pi rejects that too", () => {
    const pending = seedQueue();

    pending.flushNext();
    expect(posted).toEqual([{ type: "prompt", message: "第一条", ackId: lastAckId() }]);

    pending.reject(lastAckId());
    expect(pending.items.map((item) => item.text)).toEqual(["第一条", "第二条", "第三条"]);
  });

  it("ignores a rejection for an id it no longer holds", () => {
    const pending = seedQueue();

    expect(pending.reject("ack-nope")).toBe(false);
    expect(pending.count).toBe(3);
  });
});
