import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RewindWidget from "@/components/RewindWidget.vue";
import { useOverlaysStore } from "@/stores/overlays.ts";

vi.mock("@/lib/bridge.ts", () => ({
  post: () => {},
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

describe("RewindWidget", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("renders nothing without its payload", () => {
    expect(mount(RewindWidget).find(".rewind-widget").exists()).toBe(false);
  });

  it("renders nothing when another key is showing", () => {
    useOverlaysStore().applyWidget("pi-todo", ['{"items":[]}']);
    expect(mount(RewindWidget).find(".rewind-widget").exists()).toBe(false);
  });

  it("renders the card once the host sends rewind-files", () => {
    useOverlaysStore().applyWidget("rewind-files", [
      JSON.stringify({ files: [{ absPath: "/tmp/a.ts", added: 2, removed: 1 }] }),
    ]);
    expect(mount(RewindWidget).find(".rewind-widget").exists()).toBe(true);
  });
});
