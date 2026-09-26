<!--
  The turn's changed files, at the end of the turn.

  Read-only: the rows come from the turn's own tool blocks (`lib/turn-files.ts`),
  a click opens the file in the editor, and the disclosure under a row shows the
  turn's own unified diff — the same `diff-block` markup the tool card uses.
  Nothing here writes to disk; the revert surface is the rewind card.

  A file that was written whole carries no line counts, because pi returns no
  diff for `write`; the row says 整文件写入 instead of showing a zero.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { post } from "@/lib/bridge.ts";
import { parseDiffRows } from "@/lib/diff.ts";
import { t } from "@/lib/i18n.ts";
import { shortenWorkspacePath } from "@/lib/paths.ts";
import type { TurnFileChange, TurnFiles } from "@/lib/turn-files.ts";

const props = defineProps<{ changes: TurnFiles }>();

/** The card starts open: the answer just ended and this is the summary of it. */
const open = ref(true);
const expanded = ref<Record<string, boolean>>({});

const title = computed(() =>
  t("Edited {0} file{1}", props.changes.files.length, props.changes.files.length === 1 ? "" : "s"),
);

function displayPath(path: string): string {
  return shortenWorkspacePath(path);
}

function openFile(path: string): void {
  post({ type: "openFile", filePath: path, line: null });
}

function toggleDiff(path: string): void {
  expanded.value = { ...expanded.value, [path]: !expanded.value[path] };
}

function rowsOf(file: TurnFileChange) {
  return parseDiffRows(file.diff);
}
</script>

<template>
  <div v-if="changes.files.length" class="turn-files">
    <div class="turn-files-head">
      <button
        class="turn-files-head-toggle"
        type="button"
        :aria-expanded="open"
        :title="open ? t('Collapse') : t('Expand')"
        @click="open = !open"
      >
        <span
          class="codicon"
          :class="open ? 'codicon-chevron-down' : 'codicon-chevron-right'"
        ></span>
      </button>
      <span class="turn-files-title">{{ title }}</span>
      <span v-if="changes.added || changes.removed" class="turn-files-totals">
        <span v-if="changes.added" class="turn-files-added">+{{ changes.added }}</span>
        <span v-if="changes.removed" class="turn-files-removed">-{{ changes.removed }}</span>
      </span>
    </div>

    <ul v-if="open" class="turn-files-list">
      <li v-for="file in changes.files" :key="file.path" class="turn-files-row">
        <div class="turn-files-line">
          <button
            class="turn-files-open"
            type="button"
            :title="file.path"
            @click="openFile(file.path)"
          >
            <span class="turn-files-path">{{ displayPath(file.path) }}</span>
          </button>
          <span v-if="file.written" class="turn-files-tag">{{ t("Whole-file write") }}</span>
          <span v-if="file.added" class="turn-files-added">+{{ file.added }}</span>
          <span v-if="file.removed" class="turn-files-removed">-{{ file.removed }}</span>
          <button
            v-if="file.diff"
            class="turn-files-diff-toggle"
            type="button"
            :aria-expanded="!!expanded[file.path]"
            :title="expanded[file.path] ? t('Hide diff') : t('Show diff')"
            @click="toggleDiff(file.path)"
          >
            <span
              class="codicon"
              :class="expanded[file.path] ? 'codicon-chevron-down' : 'codicon-chevron-right'"
            ></span>
          </button>
        </div>

        <div v-if="expanded[file.path]" class="diff-block">
          <div
            v-for="(row, index) in rowsOf(file)"
            :key="index"
            class="diff-line"
            :class="row.kind"
          >
            <span class="diff-sign">{{
              row.kind === "added" ? "+" : row.kind === "removed" ? "-" : ""
            }}</span>
            <span class="diff-gutter">{{ row.lineNumber }}</span>
            <span class="diff-content">{{ row.content }}</span>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
