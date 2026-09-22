// The composer while a question is on top of it.
//
// The ask card (permission prompt, questionnaire) is drawn over the input box,
// so the box underneath has to stop taking focus and clicks — otherwise typing
// aimed at the card's rows lands in a box nobody can see. `inert` is the whole
// mechanism; the attribute has to come and go with the dialog, or the composer
// never works again.

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Composer from "@/components/Composer.vue";
import { useOverlaysStore } from "@/stores/overlays.ts";

vi.mock("@/lib/bridge.ts", () => ({
  post: () => {},
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

const box = () => mount(Composer, { shallow: true }).get(".composer-box");

describe("Composer under a question", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("is reachable while no question is up", () => {
    expect(box().attributes("inert")).toBeUndefined();
  });

  it("is taken out of the tab order for as long as the question covers it", async () => {
    const overlays = useOverlaysStore();
    const wrapper = mount(Composer, { shallow: true });

    overlays.dialog = {
      type: "extension_ui_request",
      id: "req-1",
      method: "select",
      title: "Permission Required",
      options: ["Yes", "No"],
    };
    await wrapper.vm.$nextTick();

    expect(wrapper.get(".composer-box").attributes("inert")).toBeDefined();
  });
});
