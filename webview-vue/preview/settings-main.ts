// Settings-webview design preview.
//
// Same idea as `preview/main.ts` for the chat panel, but the settings page is a
// different webview with a different host contract, so it gets its own entry:
// the fake host goes in first, then the page is imported dynamically (a static
// import would evaluate `lib/bridge.ts` — and its `acquireVsCodeApi()` lookup —
// before the stub exists).
//
// Dev only: `vite --mode chat` serves `/preview/settings.html`.
//
//   ?theme=dark_modern   one of preview/themes.generated.ts
//   ?tab=settings        which tab to open first
//   ?lang=zh-cn|en
//   ?fs=13               the chat font size the scale is derived from

import { createPinia } from "pinia";
import { createApp } from "vue";
import { installCodiconFont } from "@/lib/codicon-font";
import { language } from "@/lib/injected";
import { installSettingsHost } from "./settings-host";
import { applyPreviewTheme, themeFromUrl } from "./theme-host";

installSettingsHost();

await import("@/tokens.css");
const { default: SettingsPage } = await import("@/pages/SettingsPage.vue");

installCodiconFont();
applyPreviewTheme(themeFromUrl());
document.documentElement.lang = language();

const app = createApp(SettingsPage);
app.use(createPinia());
app.mount("#app");
