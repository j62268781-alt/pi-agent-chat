// The boot page's third face: a window with no workspace folder.
//
// Unlike the failure card — which offers a retry because a session exists to
// retry — this state has nothing behind it to start. The page has to say what is
// missing and hand over the one action the extension cannot take itself, VS
// Code's folder picker.

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n.ts";
import BootSplash from "@/components/BootSplash.vue";
import { isBooting } from "@/composables/useHostLink.ts";
import { useSessionStore } from "@/stores/session.ts";

const { posted } = vi.hoisted(() => ({ posted: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/bridge.ts", () => ({
  post: (message: Record<string, unknown>) => {
    posted.push(message);
  },
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

describe("boot page without a workspace folder", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    posted.length = 0;
    isBooting.value = false;
  });

  it("stays hidden while a session boots normally", () => {
    const splash = mount(BootSplash, { shallow: true });

    expect(splash.get("#boot-splash").attributes("style")).toContain("display: none");
    expect(splash.find("#boot-workspace").exists()).toBe(false);
  });

  it("shows what is missing and asks the host for the folder picker", async () => {
    useSessionStore().workspaceRequired = true;
    const splash = mount(BootSplash, { shallow: true });

    expect(splash.get("#boot-splash").attributes("style")).toContain("display: flex");
    expect(splash.get("#boot-workspace-msg").text()).toBe("Open a workspace folder to start pi.");

    // No retry: nothing to start until a folder exists.
    expect(splash.find("#boot-retry").exists()).toBe(false);
    const button = splash.get("#boot-open-folder");
    expect(button.text()).toBe(t("Open Folder..."));

    await button.trigger("click");
    expect(posted).toEqual([{ type: "openFolder" }]);
  });

  it("hands the page back to the splash once a folder arrives", () => {
    useSessionStore().workspaceRequired = true;
    isBooting.value = true;
    const splash = mount(BootSplash, { shallow: true });

    useSessionStore().workspaceRequired = false;

    return splash.vm.$nextTick().then(() => {
      expect(splash.find("#boot-workspace").exists()).toBe(false);
      expect(splash.find(".boot-dots").exists()).toBe(true);
    });
  });
});
