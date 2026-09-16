import codiconTtf from "@vscode/codicons/dist/codicon.ttf?inline";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "@/App.vue";
import { backgroundImage, backgroundOpacity, chatFontSize, language } from "@/lib/injected";
import "@/tokens.css";

// `@vscode/codicons` is shipped as a subset: only the glyphs referenced by the
// components and stylesheets are declared, so the @font-face rule is registered
// here instead of pulling in the package's full stylesheet.
const codiconStyle = document.createElement("style");
codiconStyle.textContent = `@font-face{font-family:"codicon";font-display:block;src:url(${codiconTtf}) format("truetype")}`;
document.head.prepend(codiconStyle);

const root = document.documentElement;
root.lang = language();

// `--chat-fs` drives the transcript, `--fs` the settings panel.
const fontSize = `${chatFontSize()}px`;
root.style.setProperty("--chat-fs", fontSize);
root.style.setProperty("--fs", fontSize);

const background = backgroundImage();
if (background) {
  root.style.setProperty("--pi-bg-image", `url("${background.replace(/"/g, '\\"')}")`);
  root.style.setProperty("--pi-bg-blur", "blur(8px)");
  root.style.setProperty("--pi-bg-on", "1");
}
root.style.setProperty("--pi-bg-opacity", String(backgroundOpacity()));

createApp(App).use(createPinia()).mount("#app");
