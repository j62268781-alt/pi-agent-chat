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
import { isBooting } from "@/composables/useHostLink.ts";
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
  {
    // Unnamed: its row shows a date label instead of a name — the string 彬哥
    // read, typed into the search box, and got nothing back for.
    file: "/tmp/sessions/c.jsonl",
    name: "",
    firstMessage: "随便聊两句",
    modified: "2026-08-25T14:07:00.000Z",
    messageCount: 3,
  },
];

/** The "MM-DD" the row's own title shows for a session that has no name. */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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

  it("keeps the list open while the confirmation is up", async () => {
    const wrapper = mountPopup();
    const overlays = useOverlaysStore();
    const composer = useComposerStore();
    await wrapper.findAll(".session-item-del")[1]?.trigger("click");

    // Answering the dialog is a mousedown *outside* this popup (the dialog is its
    // own overlay), and that is exactly the click that used to close the list:
    // deleting several rows meant re-opening it for every one of them.
    expect(overlays.confirmState).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flushPromises();

    expect(composer.openPopup).toBe("sessions");
  });

  it("is still open once the deletion is under way", async () => {
    const wrapper = mountPopup();
    await wrapper.findAll(".session-item-del")[1]?.trigger("click");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await useOverlaysStore().settleConfirmation(true);
    await flushPromises();

    expect(useComposerStore().openPopup).toBe("sessions");
    expect(post).toHaveBeenCalledWith({ type: "deleteSession", file: LIST[1]?.file });
  });

  it("marks the row busy while its delete is in flight", async () => {
    const wrapper = mountPopup();
    await wrapper.findAll(".session-item-del")[1]?.trigger("click");
    await useOverlaysStore().settleConfirmation(true);
    await flushPromises();

    const rows = wrapper.findAll(".session-item");
    expect(rows[1]?.classes()).toContain("is-deleting");
    expect(rows[1]?.find(".session-item-del-spin").exists()).toBe(true);
    expect(rows[0]?.classes()).not.toContain("is-deleting");
  });

  it("drops the busy state when the host re-pushes the list", async () => {
    const wrapper = mountPopup();
    const session = useSessionStore();
    await wrapper.findAll(".session-item-del")[1]?.trigger("click");
    await useOverlaysStore().settleConfirmation(true);
    await flushPromises();

    session.sessionList = [...LIST];
    await flushPromises();

    expect(wrapper.findAll(".session-item")[1]?.classes()).not.toContain("is-deleting");
  });
});

// A switch is slow — pi rebuilds its runtime, seconds — and when the target has
// no cached transcript (a session created in another pi process, say) there is
// nothing to paint meanwhile. What covers that wait must not be the boot page:
// that one is the pi logo of a cold start, so raising it made a switch look like
// the extension restarting (彬哥: 点别的进程建的会话，面板变成启动页再进 chat ui).
// The transcript draws its own state instead, off `switchSnapshot`.
describe("SessionsPopup — switching", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(post).mockClear();
    isBooting.value = false;
  });

  it("does not raise the boot page over the panel", async () => {
    const wrapper = mountPopup();

    await wrapper.findAll(".session-item")[1]?.trigger("click");

    expect(post).toHaveBeenCalledWith({ type: "switchSession", file: LIST[1]?.file });
    expect(isBooting.value).toBe(false);
    // The window the transcript's own loading state is drawn from.
    expect(useSessionStore().switchSnapshot).not.toBeNull();
  });
});

// The search area (彬哥的参考图): filtering happens in the webview over the list the
// host already pushed, so it is instant and needs no round trip. It reuses the
// model popup's recipe — query in the composer store, Escape closes, arrows move
// the highlight, Enter opens it.
describe("SessionsPopup — the search area", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(post).mockClear();
  });

  const box = (wrapper: ReturnType<typeof mountPopup>) => wrapper.get("#sessions-search");

  it("filters by first message and by name", async () => {
    const wrapper = mountPopup();

    await box(wrapper).setValue("间距");
    expect(wrapper.findAll(".session-item")).toHaveLength(1);
    expect(wrapper.get(".session-item").text()).toContain("再看间距");

    await box(wrapper).setValue("会话 A");
    expect(wrapper.findAll(".session-item")).toHaveLength(1);
    expect(wrapper.get(".session-item").text()).toContain("会话 A");
  });

  it("matches the title it shows, date label included", async () => {
    const wrapper = mountPopup();
    const unnamed = LIST[2]!;
    const label = dayLabel(unnamed.modified);
    // The row really does show that label — the search has to agree with it.
    expect(wrapper.findAll(".session-item-title")[2]?.text()).toContain(label);

    await box(wrapper).setValue(label);

    expect(wrapper.findAll(".session-item")).toHaveLength(1);
    expect(wrapper.get(".session-item").text()).toContain(unnamed.firstMessage);
  });

  it("says so when nothing matches, and keeps the box in place", async () => {
    const wrapper = mountPopup();

    await box(wrapper).setValue("没有这条");

    expect(wrapper.findAll(".session-item")).toHaveLength(0);
    expect(wrapper.get(".sessions-empty").text()).toBe(t("No matching sessions"));
    expect(wrapper.find("#sessions-search").exists()).toBe(true);
  });

  it("lands the highlight on the open session", async () => {
    const wrapper = mountPopup();

    // Row 0 is the open session: bare Enter asks for the session already on
    // screen, which `choose` ignores — the popup just closes, nothing is posted.
    await box(wrapper).trigger("keydown", { key: "Enter" });

    expect(post).not.toHaveBeenCalled();
  });

  it("opens whatever an arrow and Enter point at", async () => {
    const wrapper = mountPopup();

    await box(wrapper).trigger("keydown", { key: "ArrowDown" });
    await box(wrapper).trigger("keydown", { key: "Enter" });

    expect(post).toHaveBeenCalledWith({ type: "switchSession", file: LIST[1]?.file });
  });

  it("does not carry the filter into the next visit", async () => {
    const wrapper = mountPopup();
    await box(wrapper).setValue("间距");
    expect(wrapper.findAll(".session-item")).toHaveLength(1);

    useComposerStore().closePopups();
    await wrapper.vm.$nextTick();

    expect(useComposerStore().sessionSearch).toBe("");
  });
});
