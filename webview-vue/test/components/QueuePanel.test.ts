// The pending strip above the composer. 彬哥's reference draws it as a narrow card
// resting on the composer's top edge: one row per queued message — a ↳ glyph, the
// text, then 插话 / 编辑 / 删除. No panel title, no per-row badge or timestamp; the
// strip carries nothing but the rows themselves.

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { t } from "@/lib/i18n.ts";
import QueuePanel from "@/components/QueuePanel.vue";
import { useComposerStore } from "@/stores/composer.ts";
import { usePendingStore } from "@/stores/pending.ts";

describe("QueuePanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
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
});
