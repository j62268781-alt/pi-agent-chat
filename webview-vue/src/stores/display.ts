// Live display preferences.
//
// Seeded from the host-injected `window.__PI__.display` and replaced wholesale
// whenever the host pushes `displaySettings`, so a settings change lands
// immediately without the webview reloading (which would drop the draft, the
// scroll position and the pending queue).

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { ChatDisplaySettings } from "@protocol/messages";
import { displaySettings } from "@/lib/injected";

/** Element the transcript font size and background are applied to. */
function root(): HTMLElement {
  return document.documentElement;
}

export const useDisplayStore = defineStore("display", () => {
  const settings = ref<ChatDisplaySettings>(displaySettings());

  const runningSendBehavior = computed(() => settings.value.runningSendBehavior);
  const collapseWork = computed(() => settings.value.collapseWork);
  const showToolCallCount = computed(() => settings.value.showToolCallCount);
  const expandToolCalls = computed(() => settings.value.expandToolCalls);
  const expandThinking = computed(() => settings.value.expandThinking);
  const keepReadingAnchor = computed(() => settings.value.keepReadingAnchor);
  const sendShortcut = computed(() => settings.value.sendShortcut);

  /** Mirror the settings into CSS custom properties. */
  function applyCssVariables(): void {
    const style = root().style;
    const size = settings.value.fontSize > 0 ? `${Math.round(settings.value.fontSize)}px` : "13px";
    // `--chat-fs` drives the transcript, `--fs` the settings panel.
    style.setProperty("--chat-fs", size);
    style.setProperty("--fs", size);

    const background = settings.value.backgroundImage;
    if (background) {
      style.setProperty("--pi-bg-image", `url("${background.replace(/"/g, '\\"')}")`);
      style.setProperty("--pi-bg-blur", "blur(8px)");
      style.setProperty("--pi-bg-on", "1");
    } else {
      style.removeProperty("--pi-bg-image");
      style.removeProperty("--pi-bg-blur");
      style.setProperty("--pi-bg-on", "0");
    }
    const opacity = Math.min(1, Math.max(0, settings.value.backgroundOpacity));
    style.setProperty("--pi-bg-opacity", String(opacity));
  }

  /** Replace the whole object; the host always pushes a complete snapshot. */
  function apply(next: ChatDisplaySettings): void {
    settings.value = next;
    applyCssVariables();
  }

  return {
    settings,
    runningSendBehavior,
    collapseWork,
    showToolCallCount,
    expandToolCalls,
    expandThinking,
    keepReadingAnchor,
    sendShortcut,
    apply,
    applyCssVariables,
  };
});