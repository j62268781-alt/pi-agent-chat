// The contenteditable's two empty-state traps.
//
// A contenteditable parks a `<br>` behind the caret whenever it is emptied, and
// Chrome gives a lone trailing `<br>` no line box, so `"a\n"` needs a second one
// to look like two lines. Both details are invisible to the store — the DOM is
// the only place they exist — so they are locked here.

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import Composer from "@/components/Composer.vue";
import { useComposerStore } from "@/stores/composer.ts";
import { LINE_FILLER_ATTR } from "@/lib/input-tokens.ts";

vi.mock("@/lib/bridge.ts", () => ({
  post: () => {},
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

function mountComposer() {
  return mount(Composer, { shallow: true });
}

const inputOf = (wrapper: ReturnType<typeof mountComposer>) =>
  wrapper.get("#input").element as HTMLElement;

describe("Composer input's empty state", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("throws away the caret-holder <br> so the placeholder comes back", async () => {
    const wrapper = mountComposer();
    const input = inputOf(wrapper);
    // What the browser leaves behind after the last character is deleted.
    input.innerHTML = "<br>";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();

    expect(input.innerHTML).toBe("");
    expect(input.matches(":empty"), "the placeholder only renders on :empty").toBe(true);
    expect(useComposerStore().draft).toBe("");
  });

  it("ignores a newline typed into an empty composer", async () => {
    const wrapper = mountComposer();
    const input = inputOf(wrapper);

    await wrapper.get("#input").trigger("keydown", { key: "Enter", shiftKey: true });

    expect(input.innerHTML).toBe("");
    expect(input.matches(":empty")).toBe(true);
    expect(useComposerStore().draft).toBe("");
  });

  it("gives a trailing newline a visible line without adding one to the draft", async () => {
    const wrapper = mountComposer();
    const input = inputOf(wrapper);
    useComposerStore().draft = "xab\n";
    await nextTick();

    const kids = Array.from(input.childNodes);
    expect(kids[0]?.textContent).toBe("xab");
    expect((kids[1] as HTMLElement).tagName).toBe("BR");
    // The filler only exists so the empty line below the text has a line box.
    expect((kids[2] as HTMLElement).tagName).toBe("BR");
    expect((kids[2] as HTMLElement).hasAttribute(LINE_FILLER_ATTR)).toBe(true);

    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    expect(useComposerStore().draft, "the filler is layout, not a newline").toBe("xab\n");
  });
});
