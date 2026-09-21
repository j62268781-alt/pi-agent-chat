// The pending strip above the composer. 彬哥's reference draws it as a narrow card
// resting on the composer's top edge: one row per queued message — a ↳ glyph, the
// text, then 插话 / 编辑 / 删除. No panel title, no per-row badge or timestamp; the
// strip carries nothing but the rows themselves.

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n.ts";
import QueuePanel from "@/components/QueuePanel.vue";
import { useComposerStore } from "@/stores/composer.ts";
import { useOverlaysStore } from "@/stores/overlays.ts";
import { usePendingStore } from "@/stores/pending.ts";
import { useSessionStore } from "@/stores/session.ts";
import { useTranscriptStore } from "@/stores/transcript.ts";

const { posted, persisted } = vi.hoisted(() => ({
  posted: [] as Array<Record<string, unknown>>,
  persisted: [] as unknown[],
}));

// `post` and `persisted` are thin wrappers over `acquireVsCodeApi()`, which is
// a no-op outside the webview — without this seam the two actions that talk to
// the host are unobservable.
vi.mock("@/lib/bridge.ts", () => ({
  post: (message: Record<string, unknown>) => {
    posted.push(message);
  },
  persisted: { get: () => undefined, set: (state: unknown) => persisted.push(state) },
  onHostMessage: () => () => {},
}));

describe("QueuePanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    posted.length = 0;
    persisted.length = 0;
  });

  it("renders a queued message as one row: the text, then 插话 / 编辑 / 删除", () => {
    usePendingStore().enqueue("我看引导和排队时那个", []);
    const wrapper = mount(QueuePanel);

    const row = wrapper.get(".queue-item");
    expect(row.get(".queue-text").text()).toBe("我看引导和排队时那个");
    expect(row.get(".queue-lead").classes()).toContain("codicon-indent");

    const buttons = row.findAll("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0]!.text()).toBe(t("Steer"));
    expect(buttons[1]!.attributes("title")).toBe(t("Edit"));
    expect(buttons[2]!.attributes("title")).toBe(t("Delete"));
  });

  it("has no panel header — the strip is only rows", () => {
    usePendingStore().enqueue("排队中", []);
    const wrapper = mount(QueuePanel);

    expect(wrapper.find(".queue-head").exists()).toBe(false);
    expect(wrapper.find(".queue-title").exists()).toBe(false);
  });

  it("pulls a queued message back into the composer rather than sending or dropping it", async () => {
    const pending = usePendingStore();
    pending.enqueue("改一下这句", []);
    const wrapper = mount(QueuePanel);

    await wrapper.findAll("button")[1]!.trigger("click");

    expect(pending.items).toHaveLength(0);
    expect(useComposerStore().draft).toBe("改一下这句");
  });

  it("appends when the composer already holds a draft, so nothing typed is lost", async () => {
    const pending = usePendingStore();
    pending.enqueue("后半句", []);
    useComposerStore().setDraft("前半句 ");
    const wrapper = mount(QueuePanel);

    await wrapper.findAll("button")[1]!.trigger("click");

    expect(useComposerStore().draft).toBe("前半句 后半句");
  });

  it("deletes only the row it was clicked on, and writes the shorter list back", async () => {
    const pending = usePendingStore();
    pending.enqueue("第一条", []);
    const doomed = pending.enqueue("第二条", []);
    pending.enqueue("第三条", []);
    const wrapper = mount(QueuePanel);

    // Row 2's third button.
    await wrapper.findAll(".queue-item")[1]!.findAll("button")[2]!.trigger("click");

    expect(pending.items.map((item) => item.text)).toEqual(["第一条", "第三条"]);
    expect(pending.items.some((item) => item.id === doomed)).toBe(false);
    expect(posted).toEqual([]);
    // The strip survives a webview reload, so a delete that is not persisted
    // would come back as if it had never happened.
    expect(persisted.length).toBeGreaterThan(0);
  });

  it("steers a queued message straight to pi, and drops it from the strip", async () => {
    const pending = usePendingStore();
    pending.enqueue("现在就插这句", []);
    useSessionStore().isStreaming = true;
    const wrapper = mount(QueuePanel);

    await wrapper.get(".queue-item").findAll("button")[0]!.trigger("click");

    expect(pending.items).toEqual([]);
    // `ackId` is what lets pi's rejection find its way back to this row.
    expect(posted).toEqual([
      expect.objectContaining({
        type: "prompt",
        message: "现在就插这句",
        streamingBehavior: "steer",
      }),
    ]);
    expect(typeof posted[0]!.ackId).toBe("string");
  });

  it("sends a plain prompt when the agent went idle in the meantime", async () => {
    const pending = usePendingStore();
    pending.enqueue("空闲了就正常发", []);
    const wrapper = mount(QueuePanel);

    await wrapper.get(".queue-item").findAll("button")[0]!.trigger("click");

    // pi only accepts `streamingBehavior` mid-stream; sending it idle is an error.
    expect(posted).toEqual([
      expect.objectContaining({ type: "prompt", message: "空闲了就正常发" }),
    ]);
    expect(posted[0]!.streamingBehavior).toBeUndefined();
  });

  it("keeps the row and says why when pi cannot take a steer during compaction", async () => {
    const pending = usePendingStore();
    const overlays = useOverlaysStore();
    const toast = vi.spyOn(overlays, "toast").mockImplementation(() => {});
    pending.enqueue("压缩中点引导", []);
    useSessionStore().isCompacting = true;
    const wrapper = mount(QueuePanel);

    await wrapper.get(".queue-item").findAll("button")[0]!.trigger("click");

    expect(posted).toEqual([]);
    expect(pending.items.map((item) => item.text)).toEqual(["压缩中点引导"]);
    expect(toast).toHaveBeenCalledWith(t("Context is being compacted"), "info");
  });

  it("leaves pi's own queue rows read-only, because they carry no id to act on", () => {
    const transcript = useTranscriptStore();
    transcript.queue.steering = ["扩展自己入队的一条"];
    const wrapper = mount(QueuePanel);

    const hostRow = wrapper.get(".queue-item.is-host");
    expect(hostRow.text()).toContain("扩展自己入队的一条");
    expect(hostRow.findAll("button")).toHaveLength(0);
  });
});
