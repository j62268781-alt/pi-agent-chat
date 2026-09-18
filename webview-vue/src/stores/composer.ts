// Composer state: the draft being typed, image attachments, input history and
// the open/closed state of every dropdown anchored to the composer bar.
//
// The legacy implementation kept the draft inside a contenteditable node and
// read it back with a caret-offset walker; here the text lives in the store and
// the rich `@file` / `/command` chips are rendered from it.

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { StreamingBehavior } from "@protocol/messages";
import { segmentsFromText, serializeSegments, type Segment } from "@/lib/input-tokens";

export interface PendingImage {
  type: "image";
  data: string;
  mimeType: string;
  /** Original file name, used as the lightbox image's alt/title. */
  name?: string;
}

export type ComposerPopup = "model" | "thinking" | "permission" | "sessions" | null;

export const useComposerStore = defineStore("composer", () => {
  const draft = ref("");
  const images = ref<PendingImage[]>([]);
  const history = ref<string[]>([]);
  const historyCursor = ref(-1);

  const openPopup = ref<ComposerPopup>(null);
  const modelSearch = ref("");
  /** Which sub-panel the model popup shows: the list, or the thinking picker. */
  const modelSubview = ref<"list" | "thinking">("list");

  const autocomplete = ref<{
    kind: "command" | "file";
    query: string;
    items: Array<{ value: string; label: string; detail?: string }>;
    selected: number;
  } | null>(null);

  /** Set when the host asks for the draft to be steered or queued instead. */
  const streamingBehavior = ref<StreamingBehavior | undefined>(undefined);

  const segments = computed<Segment[]>(() => segmentsFromText(draft.value));
  const hasContent = computed(() => draft.value.trim().length > 0 || images.value.length > 0);
  const isEmpty = computed(() => !hasContent.value && autocomplete.value === null);

  /** Flat text sent to the host, with chips re-serialized as source syntax. */
  const payload = computed(() => serializeSegments(segments.value));

  function setDraft(text: string): void {
    draft.value = text;
    historyCursor.value = -1;
  }

  /** Insert text at the caret (the composer calls this for chips/toolbar actions). */
  function insert(text: string): void {
    draft.value += text;
  }

  function clear(): void {
    draft.value = "";
    images.value = [];
    autocomplete.value = null;
    historyCursor.value = -1;
  }

  /** Remember a sent prompt so ArrowUp can recall it. */
  function remember(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const last = history.value[history.value.length - 1];
    if (last === trimmed) return;
    history.value.push(trimmed);
    if (history.value.length > 500) history.value.shift();
    historyCursor.value = -1;
  }

  /** Step through input history. Returns true when the draft changed. */
  function recall(direction: -1 | 1): boolean {
    if (history.value.length === 0) return false;
    let cursor = historyCursor.value;
    if (direction === -1) {
      cursor = cursor < 0 ? history.value.length - 1 : Math.max(0, cursor - 1);
    } else {
      if (cursor < 0) return false;
      cursor += 1;
      if (cursor >= history.value.length) {
        historyCursor.value = -1;
        draft.value = "";
        return true;
      }
    }
    historyCursor.value = cursor;
    draft.value = history.value[cursor] ?? "";
    return true;
  }

  function addImages(next: PendingImage[]): void {
    images.value = [...images.value, ...next];
  }

  function removeImage(index: number): void {
    images.value = images.value.filter((_, position) => position !== index);
  }

  function closePopups(): void {
    openPopup.value = null;
    modelSearch.value = "";
    modelSubview.value = "list";
  }

  function togglePopup(which: Exclude<ComposerPopup, null>): void {
    openPopup.value = openPopup.value === which ? null : which;
    if (which === "model") {
      modelSearch.value = "";
      modelSubview.value = "list";
    }
  }

  return {
    draft,
    images,
    history,
    openPopup,
    modelSearch,
    modelSubview,
    autocomplete,
    streamingBehavior,
    segments,
    hasContent,
    isEmpty,
    payload,
    setDraft,
    insert,
    clear,
    remember,
    recall,
    addImages,
    removeImage,
    closePopups,
    togglePopup,
  };
});
