<!--
  Generic widget panel (`#widget` in the legacy markup): any host widget that
  is not the rewind card. `todo-list` gets the checklist rendering, everything
  else is shown line by line.

  Ported from the vanilla-TS bundle (`globals.ts`: `applyWidget`).
-->
<script setup lang="ts">
import { computed } from "vue";
import { post } from "@/lib/bridge.ts";
import { t } from "@/lib/i18n.ts";
import { useOverlaysStore } from "@/stores/overlays.ts";

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

const overlays = useOverlaysStore();

const widget = computed(() => {
  const value = overlays.widget;
  if (!value || value.key === "rewind-files") return null;
  return value;
});

const isTodo = computed(() => widget.value?.key === "todo-list");

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** `lines[0]` is `{"todos":[{"id":1,"text":"…","done":false}]}`. */
const todos = computed<TodoItem[]>(() => {
  if (!isTodo.value) return [];
  const first = widget.value?.lines[0];
  if (!first) return [];
  let data: unknown;
  try {
    data = JSON.parse(first);
  } catch {
    return [];
  }
  const payload = asRecord(data);
  const raw = payload && Array.isArray(payload.todos) ? payload.todos : [];
  const items: TodoItem[] = [];
  for (const entry of raw) {
    const item = asRecord(entry);
    if (!item) continue;
    items.push({
      id: item.id == null || item.id === "" ? "" : String(item.id),
      text: typeof item.text === "string" ? item.text : "",
      done: Boolean(item.done),
    });
  }
  return items;
});

const doneCount = computed(() => todos.value.filter((item) => item.done).length);

function toggle(): void {
  overlays.widgetOpen = !overlays.widgetOpen;
}

function clearTodos(): void {
  post({ type: "todoClear" });
}
</script>

<template>
  <div v-if="widget" class="widget">
    <div class="widget-card" :class="{ 'is-collapsed': !overlays.widgetOpen }">
      <div class="widget-head">
        <button
          type="button"
          class="widget-toggle"
          :aria-label="overlays.widgetOpen ? t('Collapse') : t('Expand')"
          :title="overlays.widgetOpen ? t('Collapse') : t('Expand')"
          @click="toggle"
        >
          <span class="codicon codicon-chevron-right"></span>
        </button>

        <span v-if="isTodo" class="widget-title">
          <span class="codicon codicon-checklist"></span>
          <span>{{ t("Todos") }}</span>
        </span>

        <span v-if="isTodo && todos.length > 0" class="widget-stats">
          {{ doneCount }}/{{ todos.length }}
        </span>

        <button
          v-if="isTodo && todos.length > 0"
          type="button"
          class="widget-clear"
          :aria-label="t('Clear all todos')"
          :title="t('Clear all todos')"
          @click="clearTodos"
        >
          <span class="codicon codicon-clear-all"></span>
        </button>
      </div>

      <div v-if="overlays.widgetOpen">
        <div v-if="isTodo" class="todo-list">
          <div
            v-for="(todo, index) in todos"
            :key="index"
            class="todo-item"
            :class="{ 'is-done': todo.done }"
          >
            <span class="todo-check">
              <span v-if="todo.done" class="codicon codicon-check"></span>
            </span>
            <span v-if="todo.id" class="todo-id">#{{ todo.id }}</span>
            <span class="todo-text">{{ todo.text }}</span>
          </div>
        </div>

        <div v-else class="widget-body">
          <!-- A blank line still needs a glyph so the row keeps its height. -->
          <div v-for="(line, index) in widget.lines" :key="index" class="widget-line">
            {{ line || " " }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
