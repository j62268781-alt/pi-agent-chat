// Design preview entry.
//
// Mounts the real chat page against fixture data, with one of VS Code's real
// themes applied as `--vscode-*` custom properties and the real stylesheets
// loaded. Nothing is mocked but the host: the components, stores, tokens and CSS
// are the ones the extension ships, so what the preview shows is what a user
// sees.
//
// Not part of any build entry — `vite --mode chat` serves it in dev only.

import { createPinia } from "pinia";
import { createApp, nextTick } from "vue";
import ChatPage from "@/pages/ChatPage.vue";
import { installCodiconFont } from "@/lib/codicon-font";
import { language } from "@/lib/injected";
import { useComposerStore } from "@/stores/composer";
import { useDisplayStore } from "@/stores/display";
import { useOverlaysStore } from "@/stores/overlays";
import { usePendingStore } from "@/stores/pending";
import { useSessionStore } from "@/stores/session";
import { useTranscriptStore } from "@/stores/transcript";
import { ASK, PENDING, SESSION, TRANSCRIPT } from "./fixtures";
import { applyPreviewTheme, themeFromUrl } from "./theme-host";
import { THEMES } from "./themes.generated";

const params = new URLSearchParams(location.search);
const theme = themeFromUrl();

await import("./styles/index");

installCodiconFont();
applyPreviewTheme(theme);
document.documentElement.lang = language();

const app = createApp(ChatPage);
app.use(createPinia());
app.mount("#app");

// Seed the stores the way the host's messages would, then lift the boot splash.
// Setup stores expose their refs unwrapped, so these are plain assignments.
const transcript = useTranscriptStore();
const session = useSessionStore();
const display = useDisplayStore();
const pending = usePendingStore();
const composer = useComposerStore();

transcript.messages = TRANSCRIPT;
pending.items = structuredClone(PENDING);
composer.draft = "";

session.sessionName = SESSION.sessionName;
session.model = SESSION.model;
session.thinkingLevel = SESSION.thinkingLevel;
session.thinkingLevels = SESSION.thinkingLevels;
session.permissionMode = SESSION.permissionMode;
// `?streaming=0` shows the composer at rest, so the send button's three faces
// (disabled / stop / send-with-label) are each reachable by URL.
session.isStreaming = params.get("streaming") !== "0";
session.messageCount = SESSION.messageCount;
session.contextUsage = SESSION.contextUsage;
session.sessionCost = SESSION.sessionCost;

transcript.statusText = SESSION.statusText;
// `?ask=permission|questionnaire` puts one of pi's two questions on the card
// over the composer, the way the host pushes it.
const ask = params.get("ask");
if (ask === "permission" || ask === "questionnaire") {
  useOverlaysStore().dialog = ASK[ask];
}
// `display.surface` is what the host reports; the store turns it into the body
// class the token layer reads, exactly as in production.
display.apply({
  ...display.settings,
  surface: params.get("surface") === "editor" ? "editor" : "sidebar",
});

const { isBooting } = await import("@/composables/useHostLink");
isBooting.value = false;
await nextTick();

/* ── control bar (hidden with ?bare=1) ──────────────────────────────────────── */

const bar = document.getElementById("preview-bar");
if (params.get("bare") !== "1") {
  bar?.removeAttribute("hidden");

  // The viewport readout is the fastest way to tell a layout problem from a
  // browser that is covering the bottom of the page: if this says 390x844 and
  // the composer is still cut off, the chrome is overlaying it, not the CSS.
  const label = document.getElementById("preview-bar-label");
  const renderViewport = (): void => {
    if (label) label.textContent = `${window.innerWidth}×${window.innerHeight}`;
  };
  renderViewport();
  window.addEventListener("resize", renderViewport);

  const themeSelect = document.getElementById("preview-theme") as HTMLSelectElement;
  themeSelect.replaceChildren(
    ...THEMES.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.label;
      option.selected = entry.id === theme.id;
      return option;
    }),
  );
  themeSelect.addEventListener("change", () => {
    const next = THEMES.find((entry) => entry.id === themeSelect.value);
    if (next) applyPreviewTheme(next);
  });

  const surfaceButton = document.getElementById("preview-surface") as HTMLButtonElement;
  const renderSurface = (): void => {
    surfaceButton.textContent = `surface: ${display.settings.surface}`;
  };
  renderSurface();
  surfaceButton.addEventListener("click", () => {
    display.apply({
      ...display.settings,
      surface: display.settings.surface === "editor" ? "sidebar" : "editor",
    });
    renderSurface();
  });

  const fsButton = document.getElementById("preview-fs") as HTMLButtonElement;
  const SIZES = [13, 14, 16, 18];
  let size = SIZES.find((entry) => entry === display.settings.fontSize) ?? 13;
  const renderSize = (): void => {
    fsButton.textContent = `chatFontSize: ${size}`;
  };
  renderSize();
  fsButton.addEventListener("click", () => {
    size = SIZES[(SIZES.indexOf(size) + 1) % SIZES.length] ?? 13;
    display.apply({ ...display.settings, fontSize: size });
    renderSize();
  });
}
