// The session switcher's rows carry one destructive control each, and the row
// itself answers Enter/Space by switching.
//
// Both things fixed here came off 彬哥's "删除功能有逻辑bug": the trash button
// was only drawn (and only hit-testable) while its row was hovered, so a click
// where the icon had just appeared landed on the row and switched sessions; and
// the row's keydown handler reached into the focused trash button, where its
// `.prevent` cancelled the button's own Enter activation — Enter on the trash
// switched the session and never opened the confirmation at all.

import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import SessionsPopup from "@/components/composer/SessionsPopup.vue";
import { useComposerStore } from "@/stores/composer.ts";
import { useOverlaysStore } from "@/stores/overlays.ts";
import { useSessionStore } from "@/stores/session.ts";

vi.mock("@/lib/bridge.ts", () => ({
  post: vi.fn(),
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

const LIST = [
  {
    file: "/tmp/sessions/a.jsonl",
    name: "会话 A",
    firstMessage: "先把底色收口",
    modified: "2026-08-24T09:49:00.000Z",
    messageCount: 4,
  },
  {
    file: "/tmp/sessions/b.jsonl",
    name: "会话 B",
    firstMessage: "再看间距",
    modified: "2026-08-24T10:49:00.000Z",
    messageCount: 8,
  },
];

const mountPopup = () => {
  const session = useSessionStore();
  session.sessionList = LIST;
  session.sessionFile = LIST[0]?.file ?? null;
  useComposerStore().openPopup = "sessions";
  return mount(SessionsPopup);
};

describe("SessionsPopup — the delete button", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(post).mockClear();
  });

  it("draws one on every row", () => {
    const wrapper = mountPopup();

    expect(wrapper.findAll(".session-item")).toHaveLength(LIST.length);
    expect(wrapper.findAll(".session-item-del")).toHaveLength(LIST.length);
  });

  it("keeps Enter on the trash away from the row's switch", async () => {
    const wrapper = mountPopup();
    const trash = wrapper.findAll(".session-item-del")[1];

    await trash?.trigger("keydown", { key: "Enter" });

    // jsdom synthesises no click from Enter, so what the button *does* with the
    // key is out of reach here — what matters is that the row does not see it:
    // the row switches on Enter, and its `.prevent` used to cancel the button's
    // own activation on the way, which is how Enter on the trash switched the
    // session and never opened the confirmation.
    expect(
      vi.mocked(post).mock.calls.map((call) => (call[0] as { type: string }).type),
    ).not.toContain("switchSession");
  });

  it("still switches when Enter lands on the row itself", async () => {
    const wrapper = mountPopup();

    await wrapper.findAll(".session-item")[1]?.trigger("keydown", { key: "Enter" });

    expect(useOverlaysStore().confirmState).toBeNull();
    expect(post).toHaveBeenCalledWith({ type: "switchSession", file: LIST[1]?.file });
  });

  it("deletes the row it belongs to, after the confirmation", async () => {
    const wrapper = mountPopup();
    await wrapper.findAll(".session-item-del")[1]?.trigger("click");
    await useOverlaysStore().settleConfirmation(true);
    await flushPromises();

    expect(post).toHaveBeenCalledWith({ type: "deleteSession", file: LIST[1]?.file });
  });

  it("asks before deleting anything", async () => {
    const wrapper = mountPopup();
    await wrapper.findAll(".session-item-del")[1]?.trigger("click");

    const dialog = useOverlaysStore().confirmState;
    expect(dialog?.title).toBe(t("Delete session?"));
    expect(
      vi.mocked(post).mock.calls.map((call) => (call[0] as { type: string }).type),
    ).not.toContain("deleteSession");
  });
});
