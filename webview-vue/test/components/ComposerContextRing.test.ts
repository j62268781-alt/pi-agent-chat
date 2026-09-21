// The context ring is a gauge now, not just an indicator.
//
// It used to be a bare 18px arc whose only reading was the hover card. It draws
// the percentage in its own hole instead, so the two judgement calls worth
// locking are: the reading appears only when the host has actually reported
// usage (a fresh session and a silent host both mean `percent === 0`), and the
// ring is the taller box in the row while its *stroke* stays on the row's own
// control size — measured, "100%" is 24.4px wide at 10px and the hole is 21px,
// which is why the sign is not in there.

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n.ts";
import Composer from "@/components/Composer.vue";
import { useSessionStore } from "@/stores/session.ts";

vi.mock("@/lib/bridge.ts", () => ({
  post: () => {},
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

const mountComposer = () => mount(Composer, { shallow: true });

const read = (percent: number, tokens: number | null = 24_100) => {
  useSessionStore().contextUsage = { tokens, contextWindow: 200_000, percent };
};

describe("Composer context ring", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("stays wordless until the host reports a reading", () => {
    const ring = mountComposer().get("#ctx-ring");

    expect(ring.find(".ctx-ring-label").exists()).toBe(false);
    expect(ring.attributes("aria-label")).toBe(t("Context usage"));
  });

  it("draws the whole percentage in the ring, keeping the unit on the label", () => {
    read(12.6);
    const ring = mountComposer().get("#ctx-ring");

    expect(ring.get(".ctx-ring-label").text()).toBe("13");
    expect(ring.attributes("aria-label")).toBe(`${t("Context usage")} 13%`);
  });

  it("reports a reading of zero as a reading", () => {
    // `0%` with a real window is a fact about the session; it is not the same
    // state as "no reading yet", and hiding it would look like a broken gauge.
    read(0, 0);
    const ring = mountComposer().get("#ctx-ring");

    expect(ring.get(".ctx-ring-label").text()).toBe("0");
  });

  it("fills the arc from the same percentage the number shows", () => {
    read(12.5);
    const ring = mountComposer().get("#ctx-ring");

    expect(ring.get("#ctx-ring-prog").attributes("style")).toContain("87.5");
  });

  it("carries the state colour on the box, not on the number", () => {
    read(85);
    const ring = mountComposer().get("#ctx-ring");

    expect(ring.classes()).toContain("is-error");
    expect(ring.get(".ctx-ring-label").text()).toBe("85");
  });
});
