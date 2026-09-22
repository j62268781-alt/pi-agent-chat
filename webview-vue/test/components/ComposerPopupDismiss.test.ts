// Which popups the composer's outside-click closer owns.
//
// The composer closes its popups on any document `mousedown` outside the wrap it
// hosts. The session switcher is not one of those: it lives in the chat header
// and closes itself. But its name still reached the handler, where the wrap
// lookup returned `null` — so *every* mousedown, including one on the switcher's
// own trash button, ran `closePopups()`. The popup then unmounts before
// `mouseup` and the browser never dispatches `click`, so the row never switched
// and the trash never deleted (彬哥's "删除没有反应，感觉没有给删除").

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Composer from "@/components/Composer.vue";
import { useComposerStore } from "@/stores/composer.ts";

vi.mock("@/lib/bridge.ts", () => ({
  post: () => {},
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

function downOn(el: Element): void {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
}

describe("composer popup dismissal", () => {
  let wrapper: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.querySelectorAll("[data-test-standin]").forEach((el) => el.remove());
  });

  it("leaves the header's session switcher to close itself", () => {
    const composer = useComposerStore();
    wrapper = mount(Composer, { attachTo: document.body, shallow: true });
    composer.openPopup = "sessions";

    // Stand-in for a node inside `#sessions-popup`: the composer never renders
    // that popup (the header does), so a mousedown there must be none of its
    // business — whatever node it lands on.
    const row = document.createElement("button");
    row.dataset.testStandin = "sessions-row";
    document.body.append(row);
    downOn(row);

    expect(composer.openPopup).toBe("sessions");
  });

  it("still closes the model popup when the click lands outside its wrap", () => {
    const composer = useComposerStore();
    wrapper = mount(Composer, { attachTo: document.body, shallow: true });
    composer.openPopup = "model";

    downOn(document.body);

    expect(composer.openPopup).toBeNull();
  });

  it("keeps the model popup open for a click inside its own wrap", () => {
    const composer = useComposerStore();
    wrapper = mount(Composer, { attachTo: document.body, shallow: true });
    composer.openPopup = "model";

    downOn(wrapper.get(".model-wrap").element);

    expect(composer.openPopup).toBe("model");
  });
});
