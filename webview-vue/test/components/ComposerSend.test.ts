// The send button's three faces, and the routing behind them.
//
// Mid-turn the button is not simply "stop": with an empty composer it stops, and
// with something typed it sends — queueing the message here or steering pi right
// away, per `chatRunningSendBehavior`. That split is the whole reason the button
// reads `stopMode` instead of `isStreaming`, so it is worth locking at the
// component level: the store cannot see the class or the label.

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n.ts";
import Composer from "@/components/Composer.vue";
import { useComposerStore } from "@/stores/composer.ts";
import { useDisplayStore } from "@/stores/display.ts";
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

function mountComposer() {
  return mount(Composer, { shallow: true });
}

describe("Composer send button", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    posted.length = 0;
  });

  it("is disabled when idle with nothing typed", () => {
    const send = mountComposer().get("#send");

    expect(send.attributes("disabled")).toBeDefined();
    expect(send.classes()).not.toContain("is-stop");
    expect(send.get(".codicon").classes()).toContain("codicon-arrow-up");
  });

  it("stops the turn when the composer is empty mid-turn", async () => {
    useSessionStore().isStreaming = true;
    const send = mountComposer().get("#send");

    expect(send.classes()).toContain("is-stop");
    expect(send.get(".codicon").classes()).toContain("codicon-debug-stop");
    expect(send.attributes("title")).toBe(t("Stop generation"));

    await send.trigger("click");
    expect(posted).toEqual([{ type: "abort" }]);
  });

  it("sends instead of stopping once something is typed, and keeps the mode in the tooltip", async () => {
    useSessionStore().isStreaming = true;
    useComposerStore().setDraft("先别动 settings.css");
    const send = mountComposer().get("#send");

    expect(send.classes()).not.toContain("is-stop");
    expect(send.get(".codicon").classes()).toContain("codicon-arrow-up");
    // Icon-only in every state: the delivery mode is said on hover, not on the button.
    expect(send.text()).toBe("");
    expect(send.attributes("title")).toBe(
      `${t("Send message")} — ${t("Queued until the agent stops")}`,
    );

    await send.trigger("click");

    // Queueing holds the message in the composer's own list — nothing is posted.
    expect(posted).toEqual([]);
    expect(usePendingStore().items.map((item) => item.text)).toEqual(["先别动 settings.css"]);
  });

  it("steers immediately when the running-send behaviour says so", async () => {
    const display = useDisplayStore();
    display.apply({ ...display.settings, runningSendBehavior: "steer" });
    useSessionStore().isStreaming = true;
    useComposerStore().setDraft("改成跟随主题");
    const send = mountComposer().get("#send");

    expect(send.attributes("title")).toBe(
      `${t("Send message")} — ${t("Sent as a steer before the next model call")}`,
    );
    await send.trigger("click");

    expect(posted).toEqual([
      { type: "prompt", message: "改成跟随主题", streamingBehavior: "steer" },
    ]);
    expect(usePendingStore().items).toEqual([]);
  });

  it("sends a plain prompt when the agent is idle", async () => {
    useComposerStore().setDraft("做个 UI 重构");
    const send = mountComposer().get("#send");

    expect(send.attributes("title")).toBe(t("Send message"));
    await send.trigger("click");

    expect(posted).toEqual([{ type: "prompt", message: "做个 UI 重构" }]);
  });

  it("will not send while the window has no workspace folder", async () => {
    // The boot page covers the composer in this state, so the disabled button
    // and the refusal are what keep a typed prompt from reaching nothing.
    useSessionStore().workspaceRequired = true;
    useComposerStore().setDraft("先别发");
    const send = mountComposer().get("#send");

    expect(send.attributes("disabled")).toBeDefined();
    expect(send.attributes("title")).toBe(t("Open a workspace folder to start pi."));

    await send.trigger("click");
    expect(posted).toEqual([]);
  });
});
