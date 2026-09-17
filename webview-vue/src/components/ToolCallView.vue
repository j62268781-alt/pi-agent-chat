<!--
  One `tool` content block: a collapsible card with the tool name, a one-line
  argument summary, a status indicator, and the result (diff / file body / text).

  Ctrl/Cmd-clicking the header jumps to the file the tool touched, which is why
  `data-has-file` is set — `chat.css` styles that affordance with `:has()`.
-->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { post } from "@/lib/bridge.ts";
import { parseDiffRows } from "@/lib/diff.ts";
import { t } from "@/lib/i18n.ts";
import { basenameOf, shortenWorkspacePath } from "@/lib/paths.ts";
import { formatToolSummary, toolDisplayName, toolPathArg, toolStr } from "@/lib/tool-format.ts";
import { useDisplayStore } from "@/stores/display";
import type { ToolBlock } from "@/stores/transcript";

const props = defineProps<{ block: ToolBlock }>();

/** Inline payloads beyond this are truncated so a huge file cannot wedge the view. */
const MAX_INLINE = 12000;
/** Characters of a bash command kept in the folded header. */
const COMMAND_PREVIEW_MAX = 70;

const display = useDisplayStore();

const open = ref(display.expandToolCalls);
const pinnedByUser = ref(false);

const displayName = computed(() => toolDisplayName(props.block.name || "tool"));
/**
 * Folded-header summary. The tools the user watches most often get the board's
 * own wording — a bash row leads with "Ran · <command>", a read row names the
 * file it opened. Anything else keeps the generic argument summary.
 */
const summary = computed(() => {
  const args = props.block.args;
  if (!args) return props.block.argsText ? "…" : "";
  const name = props.block.name;
  if (name === "bash") {
    const command = toolStr(args.command);
    if (command) return t("Ran") + " \u00b7 " + truncate(command, COMMAND_PREVIEW_MAX);
  } else if (name === "read" || name === "write" || name === "edit") {
    const base = basenameOf(shortenWorkspacePath(toolPathArg(args)));
    if (base) {
      return name === "read" ? t("View read details for {0}", base) : t("Edited {0}", base);
    }
  }
  return formatToolSummary(name, args);
});
const statusLabel = computed(() => {
  if (props.block.status === "running") return "●";
  if (props.block.status === "error") return "✕";
  return props.block.durationMs != null ? formatMs(props.block.durationMs) : "✓";
});

const hasResult = computed(() =>
  Boolean(props.block.diffText || props.block.writeContent || props.block.output),
);
const diffRows = computed(() => (props.block.diffText ? parseDiffRows(props.block.diffText) : []));
const writeLines = computed(() => {
  if (!props.block.writeContent || props.block.diffText) return [];
  const lines = props.block.writeContent.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
});
const writeGutterWidth = computed(() => String(writeLines.value.length).length);
const argsText = computed(() => clamp(props.block.argsText));
const outputText = computed(() =>
  diffRows.value.length || writeLines.value.length ? "" : clamp(props.block.output),
);

/** Tool cards open themselves once a result lands, unless the user collapsed one. */
watch(
  hasResult,
  (landed) => {
    if (landed && !pinnedByUser.value) open.value = true;
  },
  { immediate: true },
);

function clamp(text: string): string {
  if (text.length <= MAX_INLINE) return text;
  return (
    text.slice(0, MAX_INLINE) + t(" ... (truncated, {0} more chars)", text.length - MAX_INLINE)
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + "\u2026" : value;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function onHeadClick(event: MouseEvent): void {
  pinnedByUser.value = true;
  if ((event.ctrlKey || event.metaKey) && props.block.filePath) {
    event.preventDefault();
    post({ type: "openFile", filePath: props.block.filePath, line: props.block.fileLine });
  }
}
</script>

<template>
  <details
    class="tool-block"
    :open="open"
    :data-has-file="block.filePath ? '1' : undefined"
    :data-added="block.added || undefined"
    :data-removed="block.removed || undefined"
    @toggle="pinnedByUser = true"
  >
    <summary class="tool-head" @click="onHeadClick">
      <span class="tool-name">{{ displayName }}</span>
      <span class="tool-summary">{{ summary }}</span>
      <span class="tool-status" :class="{ 'is-running': block.status === 'running' }">
        {{ statusLabel }}
      </span>
    </summary>

    <pre v-if="argsText" class="tool-args">{{ argsText }}</pre>

    <div v-if="diffRows.length" class="diff-block">
      <div v-for="(row, index) in diffRows" :key="index" class="diff-line" :class="row.kind">
        <span class="diff-sign">{{
          row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " "
        }}</span>
        <span class="diff-gutter">{{ row.lineNumber }}</span>
        <span class="diff-content">{{ row.content }}</span>
      </div>
    </div>

    <div v-else-if="writeLines.length" class="code-block">
      <div v-for="(line, index) in writeLines" :key="index" class="code-line">
        <span class="code-gutter">{{ String(index + 1).padStart(writeGutterWidth, " ") }}</span>
        <span class="code-content">{{ line }}</span>
      </div>
    </div>

    <pre v-else-if="outputText" class="tool-result">{{ outputText }}</pre>

    <pre v-else-if="block.status === 'running'" class="tool-result">…</pre>
  </details>
</template>
