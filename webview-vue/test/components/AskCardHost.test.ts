// The ask card: which of pi's requests are answered on it, and what goes back.
//
// Two things have to hold whatever the card looks like. The value sent back is
// pi's own option string, never the localized label on the row — the permission
// plugin matches on that sentence. And a request the card does not recognise
// must fall through to the modal untouched, or a plain editor dialog would lose
// its only input.

import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionUiRequest } from "@protocol/rpc";
import AskCardHost from "@/components/AskCardHost.vue";
import { t } from "@/lib/i18n.ts";
import { useOverlaysStore } from "@/stores/overlays.ts";

const post = vi.hoisted(() => vi.fn());

vi.mock("@/lib/bridge.ts", () => ({ post }));

// The card draws a localized label over an option string that pi itself matches
// on, and in English the two are the same sentence — the collision is only
// visible in the language the panel actually ships. `lib/i18n.ts` resolves its
// bundle when it is imported, so the language has to be set before that, which
// is what the hoisted block buys.
vi.hoisted(() => {
  window.__PI__ = { ...window.__PI__, lang: "zh-cn" };
});

const REQUEST_ID = "req-7";

function request(overrides: Partial<ExtensionUiRequest>): ExtensionUiRequest {
  return { type: "extension_ui_request", id: REQUEST_ID, method: "select", ...overrides };
}

/** The permission gate's prompt, as the host hands it to the webview. */
const PERMISSION = request({
  title: "Permission Required",
  message: "tool : web_search",
  options: ["Yes", 'Yes, allow tool "web_search" for this session', "No", "No, provide reason"],
});

const QUESTIONNAIRE = request({
  method: "editor",
  title: "Pi Questionnaire Form",
  prefill: JSON.stringify({
    questions: [
      {
        id: "scope",
        label: "Scope",
        prompt: "改动范围？",
        options: [{ label: "只改这一处" }, { label: "整个模块" }],
        allowOther: true,
      },
    ],
  }),
});

/** Mount the host with one request pending, the way the host's push lands. */
function mountWith(pending: ExtensionUiRequest) {
  const overlays = useOverlaysStore();
  overlays.dialog = pending;
  const wrapper = mount(AskCardHost, { attachTo: document.body });
  return { wrapper, overlays };
}

describe("AskCardHost — the permission prompt", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    post.mockClear();
  });

  it("asks one numbered row per option, numbered the way pi lists them", () => {
    const { wrapper } = mountWith(PERMISSION);

    const rows = wrapper.findAll(".ask-row");
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.get(".ask-num").text())).toEqual(["1", "2", "3", "4"]);
    expect(rows[0]?.get(".ask-label").text()).toBe(t("Yes"));
  });

  it("draws pi's fact block, whichever heading it arrived under", () => {
    const { wrapper } = mountWith(PERMISSION);

    expect(wrapper.get(".ask-pre").text()).toBe("tool : web_search");
  });

  it("answers with pi's own option string, not the label it drew", async () => {
    const { wrapper, overlays } = mountWith(PERMISSION);

    const drawn = wrapper.findAll(".ask-row")[1]?.get(".ask-label").text();
    expect(drawn).toBe(t("Yes, allow {0} for this session", 'tool "web_search"'));
    expect(drawn).not.toBe('Yes, allow tool "web_search" for this session');

    await wrapper.findAll(".ask-row")[1]?.trigger("click");

    expect(post).toHaveBeenCalledWith({
      type: "dialogResponse",
      id: REQUEST_ID,
      value: 'Yes, allow tool "web_search" for this session',
      confirmed: true,
    });
    expect(overlays.dialog).toBeNull();
  });

  it("keeps the allow / deny cue on the marker, never on the row's wording", () => {
    const { wrapper } = mountWith(PERMISSION);
    const rows = wrapper.findAll(".ask-row");

    expect(rows[0]?.classes()).toContain("is-allow");
    expect(rows[1]?.classes()).toContain("is-allow");
    expect(rows[2]?.classes()).toContain("is-block");
    expect(rows[3]?.classes()).toContain("is-block");
  });

  it("reads a dangerous title off pi's string and paints the body as code", () => {
    const { wrapper } = mountWith(
      request({
        title: "Dangerous Command:",
        message: "rm -rf /tmp/x",
        options: ["Allow", "Block"],
      }),
    );

    // The heading is translated (the key falls through when there is no entry),
    // so the warning glyph keys off the untranslated title.
    expect(wrapper.get(".ask-title").text()).toBe(t("Dangerous Command:"));
    expect(wrapper.find(".ask-warn").exists()).toBe(true);
    expect(wrapper.get(".ask-pre").text()).toBe("rm -rf /tmp/x");
  });

  it("focuses the first row, so the card is answered by keyboard too", async () => {
    mountWith(PERMISSION);
    await flushPromises();

    expect(document.activeElement?.className).toContain("ask-row");
  });
});

describe("AskCardHost — the questionnaire", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    post.mockClear();
  });

  it("renders the form as the card rather than as pi's raw JSON editor", () => {
    const { wrapper } = mountWith(QUESTIONNAIRE);

    expect(wrapper.get(".ask-title").text()).toBe("改动范围？");
    expect(wrapper.findAll(".ask-row")).toHaveLength(2);
    expect(wrapper.find(".ask-other-open").exists()).toBe(true);
  });

  it("submits the answers as the `{answers}` JSON the tool parses", async () => {
    const { wrapper } = mountWith(QUESTIONNAIRE);

    await wrapper.findAll(".ask-row")[0]?.trigger("click");

    expect(post).toHaveBeenCalledWith({
      type: "dialogResponse",
      id: REQUEST_ID,
      value: JSON.stringify({
        answers: [
          { id: "scope", value: "只改这一处", label: "只改这一处", wasCustom: false, index: 1 },
        ],
      }),
      confirmed: true,
    });
  });
});

describe("AskCardHost — what stays in the modal", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    post.mockClear();
  });

  it("leaves a plain editor request to the modal's text field", () => {
    const { wrapper } = mountWith(
      request({ method: "editor", title: "Edit this", prefill: "not a form" }),
    );

    expect(wrapper.find(".ask-card").exists()).toBe(false);
  });

  it("leaves a select with no options to the modal", () => {
    const { wrapper } = mountWith(request({ title: "Pick one", options: [] }));

    expect(wrapper.find(".ask-card").exists()).toBe(false);
  });

  it("leaves a confirm request to the modal", () => {
    const { wrapper } = mountWith(request({ method: "confirm", title: "Sure?" }));

    expect(wrapper.find(".ask-card").exists()).toBe(false);
  });

  it("dismisses the card on Escape, which the modal's own handler cannot reach", async () => {
    const { wrapper, overlays } = mountWith(PERMISSION);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();

    expect(post).toHaveBeenCalledWith({
      type: "dialogResponse",
      id: REQUEST_ID,
      // Not `cancelled`: a permission prompt has no "no answer" state, so the
      // keyboard has to deny the way the ✕ does.
      value: "No",
      confirmed: true,
    });
    expect(overlays.dialog).toBeNull();
  });

  it("denies when the ✕ is used, in pi's own words", async () => {
    const { wrapper, overlays } = mountWith(PERMISSION);

    // The tooltip has to say what the button does, or the ✕ reads as "cancel".
    expect(wrapper.get(".ask-close").attributes("title")).toBe(t("Deny"));
    await wrapper.get(".ask-close").trigger("click");

    expect(post).toHaveBeenCalledWith({
      type: "dialogResponse",
      id: REQUEST_ID,
      value: "No",
      confirmed: true,
    });
    expect(overlays.dialog).toBeNull();
  });

  it("falls back to the last option when pi's wording names no deny", async () => {
    // A two-option prompt is allow / block by position, whatever the words are.
    const { wrapper } = mountWith(
      request({ title: "Pick one", options: ["Continue", "Start over"] }),
    );

    await wrapper.get(".ask-close").trigger("click");

    expect(post).toHaveBeenCalledWith({
      type: "dialogResponse",
      id: REQUEST_ID,
      value: "Start over",
      confirmed: true,
    });
  });

  it("still cancels when the card is a question, not a decision", async () => {
    const { wrapper } = mountWith(QUESTIONNAIRE);

    await wrapper.get(".ask-close").trigger("click");

    expect(post).toHaveBeenCalledWith({
      type: "dialogResponse",
      id: REQUEST_ID,
      cancelled: true,
    });
  });
});
