// The webview side of the host bridge: a typed wrapper over
// `acquireVsCodeApi()` plus the inbound message dispatcher.

import type { ExtToWebview, WebviewToExt } from "@protocol/messages";

interface VsCodeApi {
  postMessage(message: WebviewToExt): void;
  getState<T = unknown>(): T | undefined;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Absent when the bundle is opened in a plain browser during development.
const api: VsCodeApi =
  typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : { postMessage: () => {}, getState: () => undefined, setState: () => {} };

/** Send one message to the extension host. */
export function post(message: WebviewToExt): void {
  api.postMessage(message);
}

/** Subscribe to host messages. Returns an unsubscribe function. */
export function onHostMessage(handler: (message: ExtToWebview) => void): () => void {
  const listener = (event: MessageEvent): void => {
    const data = event.data as ExtToWebview | undefined;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;
    handler(data);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/** Webview state that VS Code persists across hide/show cycles. */
export const persisted = {
  get<T>(): T | undefined {
    return api.getState<T>();
  },
  set(state: unknown): void {
    api.setState(state);
  },
};
