// Transient UI surfaces: toasts, modal dialogs requested by pi's
// `extension_ui_request`, the info panel, the agent-set widget, the message
// context menu and the rewind card/dialogs.

import { defineStore } from "pinia";
import { ref } from "vue";
import type { ExtensionUiRequest } from "@protocol/rpc";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
  /** Persistent toasts are used for long operations and replaced, not stacked. */
  sticky: boolean;
}

export interface RewindFile {
  id: number;
  path: string;
  absPath: string;
  baselineHash: string | null;
  added: number;
  removed: number;
}

export interface RewindConfirm {
  title: string;
  body: string;
  confirmLabel: string;
  resolve: (accepted: boolean) => void;
}

export const useOverlaysStore = defineStore("overlays", () => {
  let toastSeq = 0;
  const toasts = ref<Toast[]>([]);
  const stickyToastId = ref<number | null>(null);

  const dialog = ref<ExtensionUiRequest | null>(null);
  const infoPanel = ref<{ title: string; markdown: string } | null>(null);
  const widget = ref<{ key: string; lines: string[] } | null>(null);
  const widgetOpen = ref(true);

  const rewindFiles = ref<RewindFile[]>([]);
  const rewindSessionId = ref("");
  const rewindBaselineHash = ref<string | null>(null);

  const confirmState = ref<RewindConfirm | null>(null);

  /**
   * Full-screen image preview (`Lightbox`); `null` while closed. Carries the
   * whole image batch so the lightbox can step between them.
   */
  const lightbox = ref<{ items: Array<{ src: string; alt?: string }>; index: number } | null>(null);

  function openLightbox(items: Array<{ src: string; alt?: string }>, index = 0): void {
    lightbox.value = { items, index };
  }

  /** Step between the batch's images, wrapping at both ends. */
  function stepLightbox(dir: 1 | -1): void {
    const lb = lightbox.value;
    if (!lb || lb.items.length < 2) return;
    lb.index = (lb.index + dir + lb.items.length) % lb.items.length;
  }

  function closeLightbox(): void {
    lightbox.value = null;
  }

  function toast(text: string, kind: ToastKind = "info"): void {
    const id = ++toastSeq;
    toasts.value.push({ id, text, kind, sticky: false });
    const lifetime = kind === "error" ? 6000 : 3000;
    setTimeout(() => dismissToast(id), lifetime);
  }

  /** Show (or replace) the single persistent toast used for long operations. */
  function sticky(text: string, kind: ToastKind = "info"): void {
    if (stickyToastId.value !== null) dismissToast(stickyToastId.value);
    const id = ++toastSeq;
    stickyToastId.value = id;
    toasts.value.push({ id, text, kind, sticky: true });
  }

  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((entry) => entry.id !== id);
    if (stickyToastId.value === id) stickyToastId.value = null;
  }

  function clearSticky(): void {
    if (stickyToastId.value !== null) dismissToast(stickyToastId.value);
  }

  function askConfirmation(title: string, body: string, confirmLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
      confirmState.value = { title, body, confirmLabel, resolve };
    });
  }

  function settleConfirmation(accepted: boolean): void {
    const pending = confirmState.value;
    confirmState.value = null;
    pending?.resolve(accepted);
  }

  function applyWidget(key: string | undefined, lines: string[] | undefined): void {
    if (!key || !lines || lines.length === 0) {
      widget.value = null;
      return;
    }
    widget.value = { key, lines };
    widgetOpen.value = true;
  }

  return {
    toasts,
    dialog,
    infoPanel,
    widget,
    widgetOpen,
    rewindFiles,
    rewindSessionId,
    rewindBaselineHash,
    confirmState,
    lightbox,
    openLightbox,
    stepLightbox,
    closeLightbox,
    toast,
    sticky,
    dismissToast,
    clearSticky,
    askConfirmation,
    settleConfirmation,
    applyWidget,
  };
});
