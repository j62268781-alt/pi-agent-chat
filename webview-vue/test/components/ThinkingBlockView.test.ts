// Regression cover for the thinking row's fold.
//
// The old handler pinned the block on *every* `toggle` event, but Chromium fires
// `toggle` for a programmatic `open` change just as it does for a click — so the
// auto-open the component performs itself latched the row open for good, and the
// reasoning never folded away when the answer started. `fireToggle` below mimics
// that browser behaviour (verified against a real one; jsdom does not raise the
// event on its own).

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { beforeEach, describe, expect, it } from "vitest";
import type { ThinkingBlock } from "@/stores/transcript.ts";
import { useDisplayStore } from "@/stores/display.ts";
import ThinkingBlockView from "./ThinkingBlockView.vue";

/** Reactive like the store's blocks: the view watches `block.running` in place. */
const thinkingBlock = (over: Partial<ThinkingBlock> = {}): ThinkingBlock =>
  reactive({
    kind: "thinking",
    id: "think-1",
    text: "第一步：先看目录结构。",
    running: false,
    open: false,
    ...over,
  } as ThinkingBlock);

/** The `toggle` event Chromium raises after the `open` attribute changes. */
const fireToggle = (details: HTMLDetailsElement): void => {
  details.dispatchEvent(new Event("toggle"));
};

const detailsOf = (wrapper: ReturnType<typeof mount>): HTMLDetailsElement =>
  wrapper.get("details").element as HTMLDetailsElement;

describe("ThinkingBlockView — when the row folds", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("opens itself while the model is still reasoning", () => {
    const wrapper = mount(ThinkingBlockView, {
      props: { block: thinkingBlock({ running: true }) },
    });
    expect(detailsOf(wrapper).open).toBe(true);
  });

  it("folds away once the answer starts", async () => {
    const block = thinkingBlock({ running: true });
    const wrapper = mount(ThinkingBlockView, { props: { block } });
    const details = detailsOf(wrapper);
    fireToggle(details);
    expect(details.open).toBe(true);

    block.running = false;
    await wrapper.vm.$nextTick();

    expect(details.open).toBe(false);
  });

  it("keeps the row shut once the user closed it by hand", async () => {
    const block = thinkingBlock({ running: true });
    const wrapper = mount(ThinkingBlockView, { props: { block } });
    const details = detailsOf(wrapper);
    fireToggle(details);

    details.open = false;
    fireToggle(details);
    block.text = "第一步：先看目录结构。第二步：读 package.json。";
    await wrapper.vm.$nextTick();

    expect(details.open).toBe(false);
  });

  it("leaves a settled row open under `expandThinking`", () => {
    useDisplayStore().settings.expandThinking = true;
    const wrapper = mount(ThinkingBlockView, {
      props: { block: thinkingBlock({ running: false }) },
    });
    expect(detailsOf(wrapper).open).toBe(true);
  });
});
