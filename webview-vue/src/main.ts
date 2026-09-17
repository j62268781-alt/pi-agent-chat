import codiconTtf from "@vscode/codicons/dist/codicon.ttf?inline";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "@/App.vue";
import { language } from "@/lib/injected";
import { useDisplayStore } from "@/stores/display";
import "@/tokens.css";

// `@vscode/codicons` is shipped as a subset: only the glyphs referenced by the
// components and stylesheets are declared, so the @font-face rule is registered
// here instead of pulling in the package's full stylesheet.
const codiconStyle = document.createElement("style");
codiconStyle.textContent = `@font-face{font-family:"codicon";font-display:block;src:url(${codiconTtf}) format("truetype")}`;
document.head.prepend(codiconStyle);

document.documentElement.lang = language();

const app = createApp(App);
app.use(createPinia());

// Seed the CSS custom properties from the host-injected display settings before
// the first paint, so the transcript never flashes at the wrong size.
useDisplayStore().applyCssVariables();

app.mount("#app");
