// Translation lookup for the webview bundles.
//
// Keys are the English source strings, which keeps `t("Ask anything…")`
// readable at the call site and makes a missing translation fall back to
// English rather than to a symbol.

import chatZhCn from "../locales/chat.zh-cn.json";
import settingsZhCn from "../locales/settings.zh-cn.json";
import { language } from "./injected";

type Bundle = Record<string, string>;

const ZH_CN: Bundle = {
  ...(chatZhCn as Bundle),
  ...(settingsZhCn as Bundle),
};

const ACTIVE: Bundle = language() === "zh-cn" ? ZH_CN : {};

/** Translate a source-string key, substituting `{0}`, `{1}`, … placeholders. */
export function t(key: string, ...args: (string | number)[]): string {
  let text = ACTIVE[key] ?? key;
  for (let i = 0; i < args.length; i++) {
    text = text.split(`{${i}}`).join(String(args[i]));
  }
  return text;
}

/** Resolved UI language. */
export const currentLanguage = (): string => language();
