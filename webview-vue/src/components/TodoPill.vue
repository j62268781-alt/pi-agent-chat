<!--
  The todo capsule in the floating row above the composer. Hover-only: entering
  the wrapper opens the list, leaving closes it after a short delay so the pointer
  can travel from the capsule into the panel without the panel vanishing.

  The payload arrives as a widget — `widgetLines[0]` is the JSON the bundled
  `todo` extension published — so this component owns no state beyond "open" and
  the "just finished, show 全部完成 for a moment" timer. It is read-only: the
  model writes the list, the panel only shows it.

  The key string is duplicated from `pi-extensions/todo-model.ts` on purpose: the
  webview bundle cannot import from the pi side.
-->
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { t } from "@/lib/i18n.ts";
import { useOverlaysStore } from "@/stores/overlays.ts";

type TodoStatus = "pending" | "in_progress" | "completed";
interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
}

const WIDGET_KEY = "pi-todo";
/** Long enough to cross the gap between capsule and panel without a flicker. */
const LEAVE_DELAY_MS = 120;
const ALL_DONE_LINGER_MS = 3000;

const overlays = useOverlaysStore();

/** The list, or null when there is nothing worth showing. */
const items = computed<TodoItem[] | null>(() => {
  const lines = overlays.widgets[WIDGET_KEY];
  if (!lines || lines.length === 0) return null;
  try {
    const parsed = JSON.parse(lines[0] ?? "") as { items?: unknown };
    if (!Array.isArray(parsed.items)) return null;
    const list = parsed.items as TodoItem[];
    return list.length > 0 ? list : null;
  } catch {
    return null;
  }
});

const total = computed(() => items.value?.length ?? 0);
const done = computed(() => items.value?.filter((item) => item.status === "completed").length ?? 0);
const allDone = computed(() => total.value > 0 && done.value === total.value);

/** Once everything is done the capsule lingers briefly, then steps aside. */
const hidden = ref(false);
let linger: ReturnType<typeof setTimeout> | undefined;

// `immediate` because the list can already be finished the first time this
// mounts — the extension publishes without asking us, so there is no transition
// for a lazy watcher to catch, and the capsule would linger forever.
watch(
  allDone,
  (finished) => {
    if (linger !== undefined) clearTimeout(linger);
    hidden.value = false;
    if (!finished) return;
    linger = setTimeout(() => {
      hidden.value = true;
    }, ALL_DONE_LINGER_MS);
  },
  { immediate: true },
);

const open = ref(false);
let leave: ReturnType<typeof setTimeout> | undefined;

function enter(): void {
  if (leave !== undefined) clearTimeout(leave);
  open.value = true;
}

function scheduleClose(): void {
  if (leave !== undefined) clearTimeout(leave);
  leave = setTimeout(() => {
    open.value = false;
  }, LEAVE_DELAY_MS);
}

/**
 * The wrapper is removed when the list empties or finishes — `open` must not
 * outlive it, or the next payload remounts the popover already expanded with no
 * hover behind it. Only the "gone" transitions reset it: a content-only
 * re-publish (the extension repeats the same list after a compaction) must leave
 * an open popover alone.
 */
watch(
  () => items.value === null || hidden.value,
  (gone) => {
    if (!gone) return;
    if (leave !== undefined) clearTimeout(leave);
    open.value = false;
  },
);

onUnmounted(() => {
  if (linger !== undefined) clearTimeout(linger);
  if (leave !== undefined) clearTimeout(leave);
});
</script>

<template>
  <!-- the wrapper is the shared hit area: hovering the capsule *or* the panel keeps it open -->
  <div
    v-if="items && !hidden"
    class="todo-pill-hover"
    @mouseenter="enter"
    @mouseleave="scheduleClose"
    @focusin="enter"
    @focusout="scheduleClose"
  >
    <button class="todo-pill" type="button" :aria-expanded="open" :title="t('Todos')">
      <span class="codicon codicon-check todo-pill-icon" aria-hidden="true"></span>
      <span class="todo-pill-label">{{
        allDone ? t("All done") : `${t("Tasks")} ${done}/${total}`
      }}</span>
    </button>

    <div v-if="open" class="todo-popover is-open">
      <div class="todo-popover-title">{{ t("Todos") }} {{ done }}/{{ total }}</div>
      <ul class="todo-list">
        <li v-for="item in items" :key="item.id" class="todo-row" :class="`is-${item.status}`">
          <span class="todo-state" aria-hidden="true">
            <span v-if="item.status === 'completed'" class="codicon codicon-check"></span>
            <span v-else-if="item.status === 'in_progress'" class="todo-spin"></span>
          </span>
          <span class="todo-text">{{ item.text }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
