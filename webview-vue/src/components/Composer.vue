<!--
  The composer: the draft input, the attachment tray, the model / thinking /
  permission pickers, the context ring and the send-or-stop button.

  The store owns the draft, this component owns the contenteditable. Typing
  serializes the DOM back into `composer.draft` (closing `@file` / `/command`
  tokens into chips as they are completed); a watcher redraws the chips when the
  draft is written from the outside (`prefillInput`, `appendInput`, history) and
  restores the caret at the end of the text.

  Ported from the legacy `composer.ts` — the DOM ids/classes match `index.html`
  and `chat.css`, which is why the triggers and their `#model-popup` /
  `#permission-popup` shells are rendered here while the popup bodies live in
  `./composer/*.vue`.
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { post } from "@/lib/bridge.ts";
import { formatTokens } from "@/lib/format.ts";
import { t } from "@/lib/i18n.ts";
import {
  getCaretOffset,
  renderSegments,
  segmentsFromLiveText,
  segmentsFromText,
} from "@/lib/input-tokens.ts";
import { getModelIcon, modelIconHtml } from "@/lib/model-icons.ts";
import { shortenWorkspacePath } from "@/lib/paths.ts";
import { computeCacheHitPct, aggregateUsage } from "@/lib/usage.ts";
import { useComposerStore, type PendingImage } from "@/stores/composer.ts";
import type { ContextChip } from "@protocol/messages";
import { useOverlaysStore } from "@/stores/overlays.ts";
import { usePendingStore } from "@/stores/pending.ts";
import { useSessionStore } from "@/stores/session.ts";
import { useDisplayStore } from "@/stores/display.ts";
import { useTranscriptStore } from "@/stores/transcript.ts";
import Autocomplete from "./composer/Autocomplete.vue";
import ModelPicker from "./composer/ModelPicker.vue";
import PermissionPicker from "./composer/PermissionPicker.vue";

/** One row of the autocomplete dropdown. */
interface Suggestion {
  value: string;
  name: string;
  detail?: string;
  source?: string;
  matches?: number[];
}

/** Attachments are inlined into the prompt, so keep them small. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Gap between a trigger pill and its popup, mirrored from the legacy layout. */
const POPUP_GAP = 12;

const composer = useComposerStore();
const session = useSessionStore();
const display = useDisplayStore();
const overlays = useOverlaysStore();
const pending = usePendingStore();
const transcript = useTranscriptStore();

const inputEl = ref<HTMLElement | null>(null);
const modelWrapEl = ref<HTMLElement | null>(null);
const permissionWrapEl = ref<HTMLElement | null>(null);

/** Paths the host has returned before, so `@` filters something instantly. */
const knownFiles = ref<string[]>([]);

let fileTimer: number | null = null;
let composing = false;
/** Set while the DOM is redrawn from the store, so the redraw is not read back. */
let rendering = false;
/** Draft saved when history recall starts, restored when it runs past the newest. */
let historySnapshot: string | null = null;

// ------------------------------------------------------------------ rendering

/** The contenteditable as plain text, with chips back in `@file` / `/cmd` form. */
function serializeInput(root: HTMLElement): string {
  let out = "";
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as HTMLElement;
    if (element.tagName === "BR") {
      out += "\n";
      continue;
    }
    if (element.classList.contains("token-file")) {
      out += "@" + (element.getAttribute("data-path") ?? "");
      continue;
    }
    if (element.classList.contains("token-cmd")) {
      out += element.getAttribute("data-value") ?? element.textContent ?? "";
      continue;
    }
    out += serializeInput(element);
  }
  return out;
}

function autoGrow(): void {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = "auto";
  const height = Math.max(36, Math.min(el.scrollHeight, 200));
  el.style.height = `${height}px`;
  el.style.overflowY = height >= 200 ? "auto" : "hidden";
}

/** Redraw the chips from the store and put the caret back. */
function renderCurrent(caret?: number): void {
  const el = inputEl.value;
  if (!el) return;
  rendering = true;
  renderSegments(el, composer.segments, caret);
  rendering = false;
}

function onInput(): void {
  if (rendering) return;
  const el = inputEl.value;
  if (!el) return;
  const text = serializeInput(el);
  const caret = getCaretOffset(el);
  historySnapshot = null;
  if (text !== composer.draft) composer.draft = text;
  // Redraw so a completed token becomes a chip. Never during IME composition:
  // rewriting the DOM there closes the candidate window.
  if (!composing) renderSegments(el, segmentsFromLiveText(text, caret), caret);
  autoGrow();
  updateAutocomplete();
}

// `composer.draft` is also written by the host (appendInput / prefillInput) and
// by history recall; those writes have to reach the DOM, while the echo of our
// own typing must not (it would move the caret). Comparing the two is what keeps
// the loop closed — the store never re-renders over what the user just typed.
watch(
  () => composer.draft,
  (draft) => {
    if (rendering) return;
    const el = inputEl.value;
    if (!el || serializeInput(el) === draft) return;
    renderCurrent(draft.length);
    autoGrow();
  },
);

// ------------------------------------------------------------------ autocomplete

/**
 * Fuzzy score for a command name — prefix hit beats a word-boundary hit beats a
 * subsequence — plus the indices to highlight. Ported from the legacy matcher.
 */
function scoreCommand(
  name: string,
  query: string,
): { score: number; indices: number[] | null } | null {
  const lower = name.toLowerCase();
  if (!query) return { score: 1, indices: null };
  const direct = lower.indexOf(query);
  if (direct >= 0) {
    const indices = Array.from({ length: query.length }, (_, step) => direct + step);
    if (direct === 0) return { score: 900, indices };
    const previous = lower.charAt(direct - 1);
    const base = previous === "-" || previous === "_" || previous === " " ? 750 : 600;
    return { score: base - direct, indices };
  }
  let position = 0;
  let first = -1;
  let last = -1;
  let streak = 0;
  let longest = 0;
  const indices: number[] = [];
  for (let i = 0; i < lower.length && position < query.length; i++) {
    if (lower.charAt(i) !== query.charAt(position)) continue;
    if (first < 0) first = i;
    streak = last >= 0 && i === last + 1 ? streak + 1 : 1;
    if (streak > longest) longest = streak;
    last = i;
    indices.push(i);
    position += 1;
  }
  if (position !== query.length) return null;
  let startBonus = 0;
  if (first === 0) {
    startBonus = 50;
  } else {
    const previous = lower.charAt(first - 1);
    if (previous === "-" || previous === "_" || previous === " ") startBonus = 30;
  }
  const gaps = last - first + 1 - query.length;
  const compactBonus = gaps > 0 ? Math.max(0, 40 - gaps * 3) : 40;
  return { score: 100 + startBonus + longest * 8 + compactBonus, indices };
}

function commandSuggestions(query: string): Suggestion[] {
  const needle = query.toLowerCase();
  const scored: Array<{ suggestion: Suggestion; score: number; order: number }> = [];
  session.commands.forEach((command, order) => {
    const match = scoreCommand(command.name, needle);
    if (match) {
      scored.push({
        suggestion: {
          value: command.name,
          name: `/${command.name}`,
          detail: command.description ?? "",
          source: command.source,
          // The label carries the leading `/`, so shift the highlight indices.
          matches: match.indices ? match.indices.map((index) => index + 1) : undefined,
        },
        score: match.score,
        order,
      });
      return;
    }
    // No name hit: fall back to the description, so a half-remembered command
    // can be found by what it does ("压缩" → /compact). Ranked below every name
    // hit, ordered by where in the text the query sits.
    const description = command.description ?? "";
    const hit = needle ? description.toLowerCase().indexOf(needle) : -1;
    if (hit < 0) return;
    scored.push({
      suggestion: {
        value: command.name,
        name: `/${command.name}`,
        detail: description,
        source: command.source,
      },
      score: 200 - hit,
      order,
    });
  });
  scored.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.order - b.order));
  return scored.map((entry) => entry.suggestion);
}

function fileSuggestion(path: string): Suggestion {
  const slash = path.lastIndexOf("/");
  return slash >= 0
    ? { value: path, name: path.slice(slash + 1), detail: path.slice(0, slash) }
    : { value: path, name: path };
}

/** The dropdown rows, derived from `.autocomplete` state + the command list. */
const suggestions = computed<Suggestion[]>(() => {
  const state = composer.autocomplete;
  if (!state) return [];
  if (state.kind === "command") return commandSuggestions(state.query);
  return state.items.map((item) => fileSuggestion(item.value));
});

/** Offset where the word under the caret begins (just past the last whitespace). */
function wordStart(text: string, caret: number): number {
  const before = text.slice(0, caret);
  for (let i = before.length - 1; i >= 0; i--) {
    if (/\s/.test(before.charAt(i))) return i + 1;
  }
  return 0;
}

/**
 * `/` starts a command token wherever it opens a word — the same rule `@`
 * follows. It used to be stricter (only at the very head of the message: the
 * first line, no space in the token), which meant one `/partial ` poisoned the
 * caret for the rest of the draft, and a second `/` could never reopen the list.
 * pi only honours a command at the start of a message, so a completion typed
 * mid-sentence is plain text — which is exactly what those characters are.
 */
function slashToken(text: string, caret: number): { token: string; start: number } | null {
  const start = wordStart(text, caret);
  const token = text.slice(start, caret);
  if (token.charAt(0) !== "/") return null;
  return { token: token.slice(1), start };
}

function atToken(text: string, caret: number): { query: string; start: number } | null {
  const start = wordStart(text, caret);
  const token = text.slice(start, caret);
  if (token.charAt(0) !== "@") return null;
  return { query: token.slice(1), start };
}

function clearFileTimer(): void {
  if (fileTimer !== null) {
    clearTimeout(fileTimer);
    fileTimer = null;
  }
}

function hideAutocomplete(): void {
  clearFileTimer();
  composer.autocomplete = null;
}

function showAutocomplete(kind: "command" | "file", query: string, list: Suggestion[]): void {
  composer.autocomplete = {
    kind,
    query,
    items: list.map((item) => ({
      value: item.value,
      label: item.name,
      detail: item.detail ?? "",
    })),
    selected: list.length > 0 ? 0 : -1,
  };
}

function updateAutocomplete(): void {
  const el = inputEl.value;
  if (!el) return;
  const text = serializeInput(el);
  const caret = getCaretOffset(el);

  const slash = slashToken(text, caret);
  if (slash) {
    clearFileTimer();
    const list = commandSuggestions(slash.token);
    if (list.length === 0) hideAutocomplete();
    else showAutocomplete("command", slash.token, list);
    return;
  }

  const at = atToken(text, caret);
  if (!at) {
    hideAutocomplete();
    return;
  }
  // Filter what we already know, then let the host widen the search.
  const needle = at.query.toLowerCase();
  const local = knownFiles.value.filter((path) => path.toLowerCase().includes(needle));
  showAutocomplete(
    "file",
    at.query,
    local.map((path) => fileSuggestion(path)),
  );
  clearFileTimer();
  const query = at.query;
  fileTimer = window.setTimeout(() => {
    fileTimer = null;
    post({ type: "searchFiles", query });
  }, 120);
}

// Remember every path the host resolves so the next `@` can filter locally.
watch(
  () => composer.autocomplete,
  (state) => {
    if (!state || state.kind !== "file" || state.items.length === 0) return;
    const seen = new Set(knownFiles.value);
    for (const item of state.items) seen.add(item.value);
    knownFiles.value = [...seen];
  },
);

/** Replace the token under the caret with the accepted suggestion. */
function complete(suggestion: Suggestion): void {
  const el = inputEl.value;
  if (!el) return;
  const text = serializeInput(el);
  const caret = getCaretOffset(el);
  let start: number;
  let replacement: string;
  if (composer.autocomplete?.kind === "file") {
    const at = atToken(text, caret);
    if (!at) {
      hideAutocomplete();
      return;
    }
    start = at.start;
    replacement = `@${shortenWorkspacePath(suggestion.value)} `;
  } else {
    // Replace the `/word` under the caret, not the whole line: the token can now
    // sit anywhere, and the text around it has to survive the completion.
    const slash = slashToken(text, caret);
    if (!slash) {
      hideAutocomplete();
      return;
    }
    start = slash.start;
    replacement = `/${suggestion.value} `;
  }
  const next = text.slice(0, start) + replacement + text.slice(caret);
  const position = start + replacement.length;
  el.focus();
  composer.draft = next;
  renderSegments(el, segmentsFromText(next), position);
  hideAutocomplete();
  autoGrow();
}

function onAutocompleteSelect(index: number): void {
  const chosen = suggestions.value[index];
  if (chosen) complete(chosen);
}

// ------------------------------------------------------------------ editing

/** Insert text at the caret and keep it there. Shared by paste / newline. */
function insertAtCaret(text: string): void {
  const el = inputEl.value;
  if (!el) return;
  const value = serializeInput(el);
  const caret = getCaretOffset(el);
  const next = value.slice(0, caret) + text + value.slice(caret);
  composer.draft = next;
  renderSegments(el, segmentsFromText(next), caret + text.length);
  autoGrow();
}

function navigateHistory(direction: -1 | 1): void {
  const el = inputEl.value;
  if (!el || composer.history.length === 0) return;
  if (direction === -1 && historySnapshot === null) historySnapshot = composer.draft;
  if (!composer.recall(direction)) return;
  if (direction === 1 && composer.draft === "" && historySnapshot !== null) {
    // Walked past the newest entry: put back what was typed before recalling.
    composer.setDraft(historySnapshot);
    historySnapshot = null;
  }
  el.focus();
  renderSegments(el, composer.segments, composer.payload.length);
  autoGrow();
}

function onCompositionStart(): void {
  composing = true;
}

function onCompositionEnd(): void {
  composing = false;
  const el = inputEl.value;
  if (el) {
    const text = serializeInput(el);
    const caret = getCaretOffset(el);
    renderSegments(el, segmentsFromLiveText(text, caret), caret);
  }
  autoGrow();
  updateAutocomplete();
}

function onKeydown(ev: KeyboardEvent): void {
  const state = composer.autocomplete;
  const list = suggestions.value;
  if (state && list.length > 0 && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
    ev.preventDefault();
    const delta = ev.key === "ArrowDown" ? 1 : -1;
    const next = (state.selected + delta + list.length) % list.length;
    composer.autocomplete = { ...state, selected: next };
    return;
  }
  if (
    state &&
    list.length > 0 &&
    !ev.altKey &&
    !ev.ctrlKey &&
    !ev.metaKey &&
    (ev.key === "Enter" || ev.key === "Tab")
  ) {
    ev.preventDefault();
    const chosen = list[state.selected] ?? list[0];
    if (chosen) complete(chosen);
    return;
  }
  if (ev.key === "Escape" && (state || fileTimer !== null)) {
    ev.preventDefault();
    hideAutocomplete();
    return;
  }
  const el = inputEl.value;
  const plain = !ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey;
  if (el && plain && ev.key === "ArrowUp") {
    if (serializeInput(el).slice(0, getCaretOffset(el)).indexOf("\n") === -1) {
      ev.preventDefault();
      navigateHistory(-1);
      return;
    }
  }
  if (el && plain && ev.key === "ArrowDown") {
    if (serializeInput(el).slice(getCaretOffset(el)).indexOf("\n") === -1) {
      ev.preventDefault();
      navigateHistory(1);
      return;
    }
  }
  if (ev.key === "Enter" && !ev.isComposing && !composing) {
    ev.preventDefault();
    const isMac = /Mac/i.test(navigator.platform || "");
    const modifier = isMac ? ev.metaKey : ev.ctrlKey;
    const followUp = ev.altKey && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey;
    const send = display.sendShortcut === "enter" ? plain : modifier && !ev.shiftKey && !ev.altKey;
    if (followUp) sendPrompt(true);
    else if (send) sendPrompt();
    else insertAtCaret("\n");
  }
}

// ------------------------------------------------------------------ intake

/**
 * Running-send behavior, carried by the send button's tooltip: 排队 holds the
 * message here (deletable, steerable) and 引导 hands it to pi as a steering
 * prompt right away. The value lives in the global config, so the host's
 * `displaySettings` push is what moves the wording.
 */
const runningSendHint = computed(() =>
  display.runningSendBehavior === "steer"
    ? t("Sent as a steer before the next model call")
    : t("Queued until the agent stops"),
);

/** Mid-turn with something typed: the button sends (queue or steer) instead of
 *  stopping. Stopping is the empty-composer action — see `stopMode`. */
const sendWhileRunning = computed(() => session.isStreaming && composer.hasContent);

// ------------------------------------------------------------------ attachments

function isImageType(type: string): boolean {
  return type.startsWith("image/");
}

function addImageFile(file: File): void {
  if (!isImageType(file.type) || file.size > MAX_IMAGE_BYTES) return;
  const reader = new FileReader();
  reader.onload = () => {
    const url = String(reader.result ?? "");
    const marker = ";base64,";
    const index = url.indexOf(marker);
    if (url.indexOf("data:") !== 0 || index < 0) return;
    composer.addImages([
      { type: "image", data: url.slice(index + marker.length), mimeType: url.slice(5, index) },
    ]);
  };
  reader.readAsDataURL(file);
}

/** Chip label: `App.tsx L12` / `App.tsx L12-L45` — path basename + line range. */
function chipLabel(chip: ContextChip): string {
  const base = chip.path.slice(chip.path.lastIndexOf("/") + 1);
  const range =
    chip.startLine === chip.endLine ? `L${chip.startLine}` : `L${chip.startLine}-L${chip.endLine}`;
  return `${base} ${range}`;
}

function dataUrl(image: PendingImage): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

function onPaste(ev: ClipboardEvent): void {
  const data = ev.clipboardData;
  if (!data) return;
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !isImageType(item.type)) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (files.length > 0) {
    ev.preventDefault();
    for (const file of files) addImageFile(file);
    return;
  }
  ev.preventDefault();
  const text = data.getData("text/plain");
  if (text) insertAtCaret(text);
}

function hasFiles(data: DataTransfer | null): boolean {
  return !!data && Array.from(data.types).includes("Files");
}

function onDragOver(ev: DragEvent): void {
  if (hasFiles(ev.dataTransfer)) ev.preventDefault();
}

function onDrop(ev: DragEvent): void {
  const files = ev.dataTransfer?.files;
  if (!files || files.length === 0) return;
  ev.preventDefault();
  for (const file of Array.from(files)) addImageFile(file);
}

function onAttach(): void {
  if (session.isStreaming) return;
  post({ type: "pickResource" });
}

// ------------------------------------------------------------------ send / stop

function sendPrompt(explicitQueue?: boolean): void {
  // A compaction rebuilds the context; a message sent mid-flight would race it.
  if (session.isCompacting) {
    overlays.toast(t("Context is being compacted"), "info");
    return;
  }
  // The new-session guide with the previous session still generating: sending
  // would either land in that session (steer) or race it (new session) — keep
  // the draft and ask the user to stop/wait first.
  if (session.pendingNew && session.isStreaming) {
    overlays.toast(
      t("The previous session is still generating — stop it or wait before starting a new one."),
      "info",
    );
    return;
  }
  const message = composer.payload;
  const images = composer.images.map((image) => ({
    type: "image" as const,
    data: image.data,
    mimeType: image.mimeType,
  }));
  // Context chips serialize to a lightweight `[path:L12-45]` tag line in front
  // of the text — the model reads that range itself; the code never enters the
  // transcript, so there is nothing heavy to render.
  const chipTags = composer.contextChips
    .map((chip) => `[${chip.path}:${chip.startLine}-${chip.endLine}]`)
    .join(" ");
  const messageWithTagLine = chipTags ? `${chipTags}\n${message}` : message;
  if (!messageWithTagLine.trim() && images.length === 0) return;

  const streaming = session.isStreaming;
  // While the agent works, `chatRunningSendBehavior` decides whether the
  // message is held locally (and stays deletable/steerable) or delivered as a
  // steering prompt right away. Alt+Enter always holds it.
  const hold = streaming && (explicitQueue === true || display.runningSendBehavior === "queue");

  composer.remember(messageWithTagLine);
  composer.clear();
  historySnapshot = null;
  inputEl.value?.focus();

  if (hold) {
    pending.enqueue(messageWithTagLine, images);
    return;
  }
  if (streaming) {
    post({
      type: "prompt",
      message: messageWithTagLine,
      streamingBehavior: "steer",
      ...(images.length > 0 ? { images } : {}),
    });
    return;
  }
  post({ type: "prompt", message: messageWithTagLine, ...(images.length > 0 ? { images } : {}) });
}

// Stopping is the *empty* composer action while the agent works; with something
// typed the same button sends, and `chatRunningSendBehavior` decides whether that
// means queueing it here or steering pi immediately.
const stopMode = computed(() => session.isStreaming && !composer.hasContent);
const sendDisabled = computed(
  () => session.isCompacting || (!stopMode.value && !composer.hasContent),
);
const sendTitle = computed(() =>
  session.isCompacting
    ? t("Context is being compacted")
    : stopMode.value
      ? t("Stop generation")
      : sendWhileRunning.value
        ? `${t("Send message")} — ${runningSendHint.value}`
        : t("Send message"),
);

function onSendClick(): void {
  if (stopMode.value) {
    post({ type: "abort" });
    return;
  }
  sendPrompt();
}

// ------------------------------------------------------------------ toolbar state

const placeholder = t("Ask anything…");

const modelLabel = computed(() => {
  const model = session.model;
  if (model)
    return model.provider
      ? `${model.name || model.id} · ${model.provider}`
      : model.name || model.id;
  // A dead pi leaves `models` empty too; saying "no models configured" there
  // points the user at the model settings when the process never came up.
  if (session.piFailure) return t("Pi is not running");
  return session.models.length === 0 ? t("No models configured") : "";
});

const modelIconMarkup = computed(() => {
  const model = session.model;
  return model ? modelIconHtml(getModelIcon(model.name || model.id)) : "";
});

const permissionSafe = computed(() => session.permissionMode !== "FullAccess");
const permissionTitle = computed(() => t(permissionSafe.value ? "Smart approval" : "Full access"));
const permissionIconClass = computed(() =>
  permissionSafe.value ? "codicon-shield permission-safe" : "codicon-unlock permission-danger",
);

const contextPercent = computed(() => session.contextPercent);
const ctxRingClass = computed(() => ({
  "is-warn": contextPercent.value >= 50 && contextPercent.value < 80,
  "is-error": contextPercent.value >= 80,
}));
const ctxDashOffset = computed(() => String(100 - contextPercent.value));

/**
 * The gauge's own number. `contextPercent` answers 0 both for "nothing is in
 * the context yet" and for "the host has not reported usage at all", so the
 * label keys off a real reading — the same pair of numbers the hover card
 * needs — rather than off the percentage.
 *
 * The `%` stays out of the ring: measured at 10px, "100%" is 24.4px and the
 * ring's hole is 21px, while "100" is 16.2px. The unit lives on the element's
 * own label (and the hover card's first line) instead.
 */
const ctxHasReading = computed(() => {
  const usage = session.contextUsage;
  return typeof usage?.tokens === "number" && typeof usage.contextWindow === "number";
});
const ctxPercentWhole = computed(() => Math.round(contextPercent.value));
const ctxPercentLabel = computed(() => String(ctxPercentWhole.value));
const ctxAriaLabel = computed(() =>
  ctxHasReading.value ? t("Context usage") + " " + ctxPercentWhole.value + "%" : t("Context usage"),
);

// ---- context-usage readout -------------------------------------------------
//
// The ring is an indicator, not a readout: the numbers live in a hover card
// (`#ctx-tooltip`, positioned by hand because the ring sits at the bottom of a
// scrolling panel). Ported from the legacy `rebuildCtxRingTooltip` +
// `showTooltip` pair — a card with the percentage, the used / total context and,
// when the host reports one, the session cost.

const ctxRingEl = ref<HTMLElement | null>(null);
const ctxTooltipEl = ref<HTMLElement | null>(null);
const ctxTooltipRows = ref<{ label: string; value: string }[]>([]);
const ctxTooltipOpen = ref(false);
const ctxTooltipPos = ref({ left: 0, top: 0 });
/** Hover intent delay, mirrored from the legacy tooltip. */
const CTX_TOOLTIP_DELAY_MS = 500;
let ctxTooltipTimer: number | null = null;

const ctxRows = computed(() => {
  const usage = session.contextUsage;
  const tokens = usage && typeof usage.tokens === "number" ? usage.tokens : null;
  const total = usage && typeof usage.contextWindow === "number" ? usage.contextWindow : null;
  const rows: { label: string; value: string }[] = [];
  if (tokens != null && total != null) {
    rows.push({ label: t("Usage:"), value: contextPercent.value.toFixed(1) + "%" });
    rows.push({ label: t("Context:"), value: formatTokens(tokens) + " / " + formatTokens(total) });
  }
  // Session-wide share of the prompt that came from the prompt cache, not the
  // last turn's: it is there as soon as a restored transcript renders.
  const cacheHitPct = computeCacheHitPct(aggregateUsage(transcript.messages));
  if (cacheHitPct != null) rows.push({ label: t("Cache:"), value: cacheHitPct.toFixed(1) + "%" });
  if (session.sessionCost != null)
    rows.push({ label: t("Cost:"), value: "$" + session.sessionCost.toFixed(3) });
  return rows;
});

async function showCtxTooltip(): Promise<void> {
  const rows = ctxRows.value;
  const ring = ctxRingEl.value;
  if (rows.length === 0 || !ring) return;
  ctxTooltipRows.value = rows;
  ctxTooltipOpen.value = true;
  await nextTick();
  const el = ctxTooltipEl.value;
  if (!el) return;
  const r = ring.getBoundingClientRect();
  const cw = el.offsetWidth;
  const ch = el.offsetHeight;
  let left = r.left + r.width / 2 - cw / 2;
  if (left < 4) left = 4;
  else if (left + cw > window.innerWidth - 4) left = window.innerWidth - cw - 4;
  const above = r.top - ch - 6;
  ctxTooltipPos.value = { left, top: above < 4 ? r.bottom + 6 : above };
}

function onCtxEnter(): void {
  if (ctxTooltipTimer !== null) clearTimeout(ctxTooltipTimer);
  ctxTooltipTimer = window.setTimeout(() => {
    ctxTooltipTimer = null;
    void showCtxTooltip();
  }, CTX_TOOLTIP_DELAY_MS);
}

function onCtxLeave(): void {
  if (ctxTooltipTimer !== null) {
    clearTimeout(ctxTooltipTimer);
    ctxTooltipTimer = null;
  }
  ctxTooltipOpen.value = false;
}

// ------------------------------------------------------------------ popups

/**
 * Anchor a popup under its trigger. VS Code sidebars go down to ~230px, so the
 * legacy implementation measured and clamped instead of trusting CSS.
 */
function positionPopup(wrap: HTMLElement | null, selector: string, floor: number): void {
  const popup = wrap?.querySelector<HTMLElement>(selector);
  if (!wrap || !popup) return;
  const rect = wrap.getBoundingClientRect();
  const margin = 8;
  popup.style.minWidth = `${Math.min(window.innerWidth - margin * 2, Math.max(floor, rect.width))}px`;
  popup.style.left = "0px";
  popup.style.top = "";
  popup.style.bottom = "";
  const width = popup.offsetWidth;
  if (rect.left + width > window.innerWidth - margin) {
    popup.style.left = `${Math.max(margin - rect.left, rect.width - width)}px`;
  }
  const height = popup.offsetHeight || 220;
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < height + margin && rect.top > spaceBelow) {
    popup.style.bottom = `${rect.height + POPUP_GAP}px`;
  } else {
    popup.style.top = `${rect.height + POPUP_GAP}px`;
  }
}

// The thinking panel grows the model popup in place, so it has to be re-measured.
watch([() => composer.openPopup, () => composer.modelSubview], async () => {
  await nextTick();
  if (composer.openPopup === "model") positionPopup(modelWrapEl.value, ".model-popup", 260);
  else if (composer.openPopup === "permission")
    positionPopup(permissionWrapEl.value, ".permission-popup", 250);
});

// A question covers the box: leave the caret in the composer and the keystrokes
// meant for the card's rows would land in a box nobody can see.
watch(
  () => overlays.dialog,
  (dialog) => {
    if (dialog) inputEl.value?.blur();
  },
);

/**
 * Clicking outside a trigger closes its popup. One popup is open at a time, so
 * the open one's wrapper decides — clicks inside the popup (including the
 * thinking panel) keep it open.
 */
function onDocumentMouseDown(ev: MouseEvent): void {
  const target = ev.target as Node | null;
  if (!target) return;
  // The suggestion dropdown is derived state, not an "open" flag: dismissing it
  // here only hides it — the next keystroke re-opens it for the same `/cmd` or
  // `@file` token, filtered by whatever the token reads at that moment.
  const inDropdown = target instanceof Element && target.closest("#autocomplete") !== null;
  if (!inDropdown && !inputEl.value?.contains(target)) hideAutocomplete();

  const open = composer.openPopup;
  if (!open) return;
  const wrap =
    open === "model" ? modelWrapEl.value : open === "permission" ? permissionWrapEl.value : null;
  // `sessions` is the chat header's popup, not this component's: it anchors on
  // its own element and closes itself. Closing it here would fire on the
  // switcher's own mousedown, unmounting the row before `mouseup` — the browser
  // then never dispatches `click`, so neither the row's switch nor the trash's
  // delete ever ran (彬哥's "删除没有反应").
  if (!wrap) return;
  if (wrap.contains(target)) return;
  composer.closePopups();
}

// ------------------------------------------------------------------ lifecycle

onMounted(() => {
  document.addEventListener("mousedown", onDocumentMouseDown);
  // The draft may already be set (prefill before mount), so draw it once.
  renderCurrent(composer.payload.length);
  autoGrow();
  updateAutocomplete();
});

onUnmounted(() => {
  document.removeEventListener("mousedown", onDocumentMouseDown);
  if (ctxTooltipTimer !== null) clearTimeout(ctxTooltipTimer);
  clearFileTimer();
});
</script>

<template>
  <div class="composer">
    <Autocomplete
      v-if="composer.autocomplete && suggestions.length > 0"
      :items="suggestions"
      :selected="composer.autocomplete.selected"
      @select="onAutocompleteSelect"
    />
    <!-- A question (permission gate, questionnaire) is drawn over this box, so
         the box is taken out of the tab order and out of reach of the pointer
         for as long as it is up. -->
    <div class="composer-box" :inert="overlays.dialog ? true : undefined">
      <div v-if="composer.contextChips.length > 0" class="context-chips">
        <span
          v-for="chip in composer.contextChips"
          :key="chip.id"
          class="context-chip"
          :title="t('Open in editor')"
          @click="post({ type: 'openContextChip', path: chip.path, line: chip.startLine })"
        >
          <span class="codicon codicon-file-text"></span>
          <span class="context-chip-label">{{ chipLabel(chip) }}</span>
          <button
            class="context-chip-x"
            type="button"
            :aria-label="t('Remove')"
            @click.stop="composer.removeContextChip(chip.id)"
          >
            <span class="codicon codicon-close"></span>
          </button>
        </span>
      </div>
      <div v-if="composer.images.length > 0" id="attach-preview" class="attach-preview">
        <div v-for="(image, index) in composer.images" :key="index" class="attach-thumb">
          <img
            :src="dataUrl(image)"
            :title="t('Click to preview')"
            @click="
              overlays.openLightbox(
                composer.images.map((img) => ({ src: dataUrl(img), alt: img.name })),
                index,
              )
            "
          />
          <button
            class="attach-remove"
            type="button"
            :title="t('Remove image')"
            @click="composer.removeImage(index)"
          >
            ×
          </button>
        </div>
      </div>
      <div
        id="input"
        ref="inputEl"
        class="composer-input"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        :data-placeholder="placeholder"
        @input="onInput"
        @keydown="onKeydown"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
        @paste="onPaste"
        @dragover="onDragOver"
        @drop="onDrop"
      ></div>
      <div class="composer-controls-bar">
        <button
          id="attach-btn"
          class="icon-btn"
          type="button"
          :title="t('Add file or folder')"
          :disabled="session.isStreaming"
          @click="onAttach"
        >
          <span class="codicon codicon-add"></span>
        </button>
        <div
          id="model-wrap"
          ref="modelWrapEl"
          class="select-wrap model-wrap"
          :class="{ 'is-open': composer.openPopup === 'model' }"
        >
          <button
            id="model-trigger"
            class="model-trigger"
            type="button"
            :title="modelLabel"
            @click="composer.togglePopup('model')"
          >
            <span id="model-icon" class="model-icon-slot" v-html="modelIconMarkup"></span>
            <span id="model-trigger-label" class="model-trigger-label">{{ modelLabel }}</span>
          </button>
          <div v-if="composer.openPopup === 'model'" id="model-popup" class="model-popup">
            <div id="model-title" class="picker-title">{{ t("Model") }}</div>
            <ModelPicker />
          </div>
        </div>
        <div
          id="permission-wrap"
          ref="permissionWrapEl"
          class="select-wrap permission-wrap"
          :class="{ 'is-open': composer.openPopup === 'permission' }"
        >
          <button
            id="permission-trigger"
            class="permission-trigger"
            type="button"
            :title="permissionTitle"
            @click="composer.togglePopup('permission')"
          >
            <span
              id="permission-icon"
              class="codicon permission-icon"
              :class="permissionIconClass"
            ></span>
            <span id="permission-trigger-label" class="permission-trigger-label">
              {{ permissionTitle }}
            </span>
          </button>
          <div
            v-if="composer.openPopup === 'permission'"
            id="permission-popup"
            class="permission-popup"
          >
            <div id="permission-title" class="picker-title">{{ t("Permission approval") }}</div>
            <PermissionPicker />
          </div>
        </div>
        <span
          id="ctx-ring"
          ref="ctxRingEl"
          class="ctx-ring"
          :class="ctxRingClass"
          role="img"
          :aria-label="ctxAriaLabel"
          @mouseenter="onCtxEnter"
          @mouseleave="onCtxLeave"
        >
          <!-- `28` unit viewBox with the stroke centred on 11.75 puts the ring's
               outer edge at 26px, the row's own control size; the percentage
               sits in the 21px hole that leaves. -->
          <svg viewBox="0 0 28 28">
            <circle class="ctx-ring-track" cx="14" cy="14" r="11.75"></circle>
            <circle
              id="ctx-ring-prog"
              class="ctx-ring-prog"
              cx="14"
              cy="14"
              r="11.75"
              pathLength="100"
              :style="{ strokeDashoffset: ctxDashOffset }"
            ></circle>
          </svg>
          <span v-if="ctxHasReading" class="ctx-ring-label">{{ ctxPercentLabel }}</span>
        </span>
        <button
          id="send"
          class="icon-btn send-btn"
          :class="{ 'is-stop': stopMode }"
          type="button"
          :disabled="sendDisabled"
          :title="sendTitle"
          @click="onSendClick"
        >
          <span
            class="codicon"
            :class="stopMode ? 'codicon-debug-stop' : 'codicon-arrow-up'"
          ></span>
        </button>
      </div>
    </div>

    <!-- Context readout. Fixed-positioned and appended last so it is never
         clipped by the composer's own overflow. Label and value are separate
         spans on one row: the legacy card padded its columns with spaces, which
         only lines up in a monospace font. -->
    <div
      v-show="ctxTooltipOpen"
      id="ctx-tooltip"
      ref="ctxTooltipEl"
      class="ctx-tooltip"
      role="tooltip"
      :style="{ left: ctxTooltipPos.left + 'px', top: ctxTooltipPos.top + 'px' }"
    >
      <div v-for="row in ctxTooltipRows" :key="row.label" class="ctx-row">
        <span class="ctx-row-label">{{ row.label }}</span>
        <span class="ctx-row-value">{{ row.value }}</span>
      </div>
    </div>
  </div>
</template>
