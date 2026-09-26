import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n.ts";
import TodoPill from "@/components/TodoPill.vue";
import { useOverlaysStore } from "@/stores/overlays.ts";

vi.mock("@/lib/bridge.ts", () => ({
  post: () => {},
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

type Status = "pending" | "in_progress" | "completed";

function publish(items: Array<{ id: string; text: string; status: Status }>, at = 1): void {
  useOverlaysStore().applyWidget("pi-todo", [JSON.stringify({ items, updatedAt: at })]);
}

const THREE = [
  { id: "a", text: "第一步", status: "completed" as Status },
  { id: "b", text: "第二步", status: "in_progress" as Status },
  { id: "c", text: "第三步", status: "pending" as Status },
];

describe("TodoPill", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("renders nothing without a payload", () => {
    expect(mount(TodoPill).find(".todo-pill").exists()).toBe(false);
  });

  it("renders nothing for an empty list", () => {
    publish([]);
    expect(mount(TodoPill).find(".todo-pill").exists()).toBe(false);
  });

  it("renders nothing when the payload is malformed", () => {
    useOverlaysStore().applyWidget("pi-todo", ["not json"]);
    expect(mount(TodoPill).find(".todo-pill").exists()).toBe(false);
  });

  it("labels the done/total count as tasks", () => {
    publish(THREE);
    const label = mount(TodoPill).get(".todo-pill-label").text();
    expect(label).toContain(t("Tasks"));
    expect(label).toContain("1/3");
  });

  it("opens the list on hover and closes after the leave delay", async () => {
    publish(THREE);
    const wrapper = mount(TodoPill);
    expect(wrapper.find(".todo-popover").exists()).toBe(false);

    await wrapper.get(".todo-pill-hover").trigger("mouseenter");
    expect(wrapper.get(".todo-popover").text()).toContain("第一步");
    expect(wrapper.get(".todo-popover").classes()).toContain("is-open");

    await wrapper.get(".todo-pill-hover").trigger("mouseleave");
    vi.advanceTimersByTime(200);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".todo-popover.is-open").exists()).toBe(false);
  });

  it("says 全部完成 and hides itself three seconds later", async () => {
    publish([
      { id: "a", text: "第一步", status: "completed" },
      { id: "b", text: "第二步", status: "completed" },
    ]);
    const wrapper = mount(TodoPill);
    expect(wrapper.get(".todo-pill").text()).toContain(t("All done"));

    vi.advanceTimersByTime(3100);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".todo-pill").exists()).toBe(false);
  });

  it("never opens without a hover, even after the popover was torn down mid-hover", async () => {
    publish(THREE);
    const wrapper = mount(TodoPill);
    await wrapper.get(".todo-pill-hover").trigger("mouseenter");
    expect(wrapper.find(".todo-popover.is-open").exists()).toBe(true);

    publish([]); // the list disappears while the popover is open
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".todo-pill").exists()).toBe(false);

    publish(THREE, 2); // a new list arrives
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".todo-pill").exists()).toBe(true);
    expect(wrapper.find(".todo-popover.is-open").exists()).toBe(false);
  });

  it("never opens without a hover after the all-done linger tore the popover down", async () => {
    publish(THREE);
    const wrapper = mount(TodoPill);
    await wrapper.get(".todo-pill-hover").trigger("mouseenter");
    expect(wrapper.find(".todo-popover.is-open").exists()).toBe(true);

    publish(
      [
        { id: "a", text: "第一步", status: "completed" },
        { id: "b", text: "第二步", status: "completed" },
      ],
      2,
    );
    await wrapper.vm.$nextTick(); // let the all-done watcher arm the linger timer
    vi.advanceTimersByTime(3100); // 全部完成 lingers, then the wrapper goes
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".todo-pill").exists()).toBe(false);

    publish(THREE, 3); // a new list arrives
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".todo-pill").exists()).toBe(true);
    expect(wrapper.find(".todo-popover.is-open").exists()).toBe(false);
  });

  it("keeps an open popover open when the same list is re-published", async () => {
    publish(THREE);
    const wrapper = mount(TodoPill);
    await wrapper.get(".todo-pill-hover").trigger("mouseenter");
    expect(wrapper.find(".todo-popover.is-open").exists()).toBe(true);

    publish(THREE, 2); // compaction: same items, new updatedAt — a new array object
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".todo-popover.is-open").exists()).toBe(true);
  });
});
