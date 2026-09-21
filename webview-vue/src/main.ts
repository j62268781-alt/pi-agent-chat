import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "@/App.vue";
import { installCodiconFont } from "@/lib/codicon-font";
import { language } from "@/lib/injected";
import { useDisplayStore } from "@/stores/display";
import "@/tokens.css";

installCodiconFont();

document.documentElement.lang = language();

const app = createApp(App);
app.use(createPinia());

// Seed the CSS custom properties from the host-injected display settings before
// the first paint, so the transcript never flashes at the wrong size.
useDisplayStore().applyCssVariables();

app.mount("#app");
