/// <reference types="vite/client" />

/** Build-time constant: the webview page this bundle was built for. */
declare const __PI_PAGE__: "chat" | "settings";

/** Raw host-injected configuration; see `index.html`. */
interface InjectedConfig {
  home: string;
  sep: string;
  workspace: string;
  fontSize: string;
  lang: string;
  mermaidTheme: string;
  bgImage: string;
  bgOpacity: string;
  sendShortcut: string;
}

declare global {
  interface Window {
    __PI__?: Partial<InjectedConfig>;
  }
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

declare module "*.ttf?inline" {
  const src: string;
  export default src;
}

declare module "*.css?inline" {
  const src: string;
  export default src;
}

declare module "*.svg?raw" {
  const src: string;
  export default src;
}

export {};
