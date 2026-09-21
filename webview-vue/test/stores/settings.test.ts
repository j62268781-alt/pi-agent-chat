// The sidebar's order and grouping.
//
// The two config tabs lead because they are what the panel is opened for, and
// the rest keep their original relative order. The sections are derived from the
// flat list rather than a second table, so a new tab that forgets its `group`
// would break these expectations instead of silently landing under the previous
// heading.

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settings.ts";

describe("settings sidebar", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("opens on 常规 and follows with 设置", () => {
    const store = useSettingsStore();
    expect(store.tabs.map((tab) => tab.id)).toEqual([
      "general",
      "settings",
      "models",
      "agents",
      "prompts",
      "skills",
      "mcp",
      "commit",
      "sysprompt",
    ]);
    expect(store.activeTab).toBe("general");
  });

  it("groups the tabs into one contiguous run each", () => {
    const groups = useSettingsStore().tabs.map((tab) => tab.group);
    const collapsed = groups.filter((group, index) => group !== groups[index - 1]);
    expect(collapsed).toEqual([...new Set(groups)]);
    expect(new Set(groups).size).toBe(3);
  });

  it("advertises every tab it can render", () => {
    // `init.tabs` filters this list, so an id the host does not know disappears
    // from the sidebar without an error — keep the two sides in step.
    const store = useSettingsStore();
    store.applyInit({
      type: "init",
      lang: "zh-cn",
      hasWorkspace: false,
      initialTab: null,
      tabs: [
        "general",
        "settings",
        "models",
        "agents",
        "prompts",
        "skills",
        "mcp",
        "commit",
        "sysprompt",
      ],
    });
    expect(store.tabs).toHaveLength(9);
    expect(store.activeTab).toBe("general");
  });
});
