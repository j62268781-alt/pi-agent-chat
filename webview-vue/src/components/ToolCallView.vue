<!--
  One `tool` content block: a collapsible card with the tool name, a one-line
  argument summary, a status indicator, and the result (diff / file body / text).

  Cards stay folded by default — `chatExpandToolCalls` opens them all — because
  the header is meant to carry the meaning on its own ("终端命令 已运行 · npm
  test", "查看 app.ts 的读取详情"). Bash and read get their own body layout:
  a command line with a `$` prompt, and a numbered file body.

  Ctrl/Cmd-clicking the header jumps to the file the tool touched, which is why
  `data-has-file` is set — `chat.css` styles that affordance with `:has()`.
-->
<script setup lang="ts">
import { computed, watch } from "vue";
import { useFoldState } from "@/composables/useFoldState.ts";
import { post } from "@/lib/bridge.ts";
import { parseDiffRows } from "@/lib/diff.ts";
import { formatDuration } from "@/lib/format.ts";
import { t } from "@/lib/i18n.ts";
import { basenameOf, shortenWorkspacePath } from "@/lib/paths.ts";
import { answerText } from "@/lib/questionnaire.ts";
import { formatToolSummary, toolDisplayName, toolPathArg, toolStr } from "@/lib/tool-format.ts";
import { useDisplayStore } from "@/stores/display";
import type { ToolBlock } from "@/stores/transcript";
import QuestionnaireCard from "./QuestionnaireCard.vue";

const props = defineProps<{ block: ToolBlock }>();

/** Inline payloads beyond this are truncated so a huge file cannot wedge the view. */
const MAX_INLINE = 12000;
/** Characters of a bash command kept in the folded header. */
const COMMAND_PREVIEW_MAX = 70;

const display = useDisplayStore();

const fold = useFoldState(display.expandToolCalls);
const { open } = fold;

// A live switch, not a creation-time seed: flipping `chatExpandToolCalls` in the
// settings panel re-applies to every card the user has not opened or folded by
// hand, so the transcript answers the switch immediately.
watch(
  () => display.expandToolCalls,
  (value) => {
    fold.set(value);
  },
);

/** Lower-case handle for the layout branches; MCP names keep their own case. */
const name = computed(() => (props.block.name || "").toLowerCase());
const isBash = computed(() => name.value === "bash");
const isRead = computed(() => name.value === "read");
const isEdit = computed(() => name.value === "write" || name.value === "edit");
const isSubagent = computed(() => name.value === "subagent");

/**
 * Title of the row. One vocabulary for every step type, so a glance down the
 * fold reads as a list of steps: 已思考 / 终端命令 / 读取文件 / 编辑文件. The
 * kind of thing is the title; what it touched goes in the subtitle.
 */
const displayName = computed(() => {
  if (isBash.value) return t("Terminal command");
  if (isRead.value) return t("Read file");
  if (isEdit.value) return t("Edit file");
  if (isSubagent.value) return "";
  return toolDisplayName(props.block.name || "tool");
});

/**
 * The file a read/edit touched, as a bare name: the row is ~300px wide and the
 * full path is one click away (`openFile`), so the path itself is not shown.
 */
const fileTag = computed(() => {
  if (!isRead.value && !isEdit.value) return "";
  const args = props.block.args;
  return args ? basenameOf(shortenWorkspacePath(toolPathArg(args))) : "";
});

function openFile(): void {
  const args = props.block.args;
  const filePath = props.block.filePath || (args ? toolPathArg(args) : "");
  if (!filePath) return;
  post({ type: "openFile", filePath, line: props.block.fileLine });
}

/**
 * Sub-agent state, folded into the header: "子 Agent 已完成 12s". The head is
 * the only place the outcome is visible, so duration and failure both live here.
 */
const subagentState = computed(() => {
  const duration = props.block.durationMs != null ? formatDuration(props.block.durationMs) : "";
  if (props.block.status === "running") return t("Subagent running");
  if (props.block.status === "error")
    return duration ? t("Subagent failed {0}", duration) : t("Subagent failed");
  return duration ? t("Subagent finished {0}", duration) : t("Subagent finished");
});

/** How a command finished, in the same words for every command row. */
const bashState = computed(() => {
  if (props.block.status === "running") return t("Running");
  if (props.block.status === "error") return t("Run failed");
  return t("Ran successfully");
});

/** Folded-header summary — the tools the user watches most get their own wording. */
const summary = computed(() => {
  const args = props.block.args;
  // Once answered, the row says what came back — that is the part worth reading
  // without expanding the card.
  const result = props.block.questionnaire;
  if (result) {
    if (result.cancelled) return t("Cancelled");
    const answers = result.answers.map((answer) => answerText(answer)).join(" \u00b7 ");
    if (answers) return truncate(answers, COMMAND_PREVIEW_MAX);
    return t("{0} questions", result.questions.length);
  }
  if (!args) return props.block.argsText ? "…" : "";
  if (isBash.value) {
    const command = toolStr(args.command);
    if (command) {
      return bashState.value + " \u00b7 " + truncate(firstLine(command), COMMAND_PREVIEW_MAX);
    }
    return bashState.value;
  }
  // read/edit carry their file as a tag instead of a path in the text.
  if (isRead.value || isEdit.value) return "";
  if (isSubagent.value) return subagentTitle(args);
  return formatToolSummary(props.block.name, args);
});

/** "Explore · <任务描述> · 子 Agent 已完成 12s", mirroring the board's row. */
function subagentTitle(args: Record<string, unknown>): string {
  const parts: string[] = [];
  const agent = toolStr(args.agent);
  if (agent) parts.push(agent);
  const tasks = Array.isArray(args.tasks) ? args.tasks : null;
  if (tasks && tasks.length > 0) {
    parts.push(
      t("parallel") +
        " \u00b7 " +
        tasks.length +
        (tasks.length > 1 ? " " + t("tasks") : " " + t("task")),
    );
  } else {
    const description = toolStr(args.title) || toolStr(args.task);
    if (description) parts.push(truncate(description, 60));
  }
  parts.push(subagentState.value);
  return parts.join(" \u00b7 ");
}
/** Elapsed time only: the row's leading glyph already carries the state. */
const statusLabel = computed(() =>
  props.block.status === "running" || props.block.durationMs == null
    ? ""
    : formatMs(props.block.durationMs),
);

const diffRows = computed(() => (props.block.diffText ? parseDiffRows(props.block.diffText) : []));
const writeLines = computed(() => {
  if (!props.block.writeContent || props.block.diffText) return [];
  const lines = props.block.writeContent.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
});
const argsText = computed(() => clamp(props.block.argsText));
const outputText = computed(() =>
  diffRows.value.length || writeLines.value.length ? "" : clamp(props.block.output),
);

// ---- bash: the command, then its output ------------------------------------

const bashCommand = computed(() => (isBash.value ? toolStr(props.block.args?.command) : ""));

/**
 * The console's closing line. The board's command card ends on a green line
 * ("✓ 6 passed (1.4s)"); here it carries the two facts we own — the outcome and
 * the elapsed time — rather than repeating the tail of the output.
 */
const bashResult = computed(() => {
  const outcome = props.block.status === "error" ? t("failed") : t("Processed");
  return statusLabel.value ? `${outcome} \u00b7 ${statusLabel.value}` : outcome;
});

// ---- read: the call's input, then a numbered file body ----------------------
//
// pi's `read` returns raw text with no line numbers (only its truncation notice
// mentions them), so the gutter is derived from `offset` — the same 1-indexed
// start pi was given.

const readText = computed(() => (isRead.value ? clamp(props.block.output) : ""));
const readLines = computed(() => {
  const text = readText.value;
  if (!text) return [];
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
});
const readStart = computed(() => {
  const offset = props.block.args?.offset;
  return typeof offset === "number" && offset > 0 ? offset : 1;
});
const readGutterWidth = computed(() => String(readStart.value + readLines.value.length - 1).length);

function clamp(text: string): string {
  if (text.length <= MAX_INLINE) return text;
  return (
    text.slice(0, MAX_INLINE) + t(" ... (truncated, {0} more chars)", text.length - MAX_INLINE)
  );
}

/** Bash headers show one line: a multi-line command would blow the row up. */
function firstLine(value: string): string {
  const end = value.indexOf("\n");
  return end === -1 ? value : value.slice(0, end) + " \u2026";
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + "\u2026" : value;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function onHeadClick(event: MouseEvent): void {
  fold.pin();
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
    @toggle="fold.onToggle"
  >
    <summary class="tool-head" @click="onHeadClick">
      <span
        class="row-state"
        :class="{
          'codicon codicon-check is-done': block.status === 'done',
          'codicon codicon-close is-error': block.status === 'error',
          'is-running': block.status === 'running',
        }"
        aria-hidden="true"
      ></span>
      <span v-if="displayName" class="tool-name">{{ displayName }}</span>
      <!-- 文件类：一个小 tag（只有文件名 + 后缀），点击在编辑器里打开 —— 行里不
           放完整路径（彬哥）。`prevent` 免得点 tag 顺手把折叠翻开。 -->
      <button
        v-if="fileTag"
        class="file-tag"
        type="button"
        :title="block.filePath ?? fileTag"
        @click.stop.prevent="openFile"
      >
        {{ fileTag }}
      </button>
      <span v-else-if="summary" class="tool-summary">{{ summary }}</span>
      <span v-if="statusLabel" class="tool-status">{{ statusLabel }}</span>
    </summary>

    <!-- 终端命令：展开才是一扇终端窗口（`$ 命令` + 输出 + 结果行）。行本身和别的
         步骤一样，只是一行带状态图标的文案。 -->
    <template v-if="isBash">
      <div class="term">
        <div class="term-line">
          <span class="term-prompt">$</span>
          <span class="term-command">{{ bashCommand || "…" }}</span>
        </div>
        <pre v-if="outputText" class="term-output">{{ outputText }}</pre>
        <pre v-else-if="block.status === 'running'" class="term-output">…</pre>
        <div
          v-if="block.status !== 'running'"
          class="term-result"
          :class="block.status === 'error' ? 'is-error' : 'is-done'"
        >
          <span
            class="codicon"
            :class="block.status === 'error' ? 'codicon-close' : 'codicon-check'"
            aria-hidden="true"
          ></span>
          <span>{{ bashResult }}</span>
        </div>
      </div>
    </template>

    <!-- 文件读取：只展示读到的那一段（行号从 offset 起，正好是 offset..offset+limit
         这个窗口），放进代码框里。参数里的 Input 不再展示 —— 行上的 tag 已经说明
         是哪个文件了（彬哥）。 -->
    <template v-else-if="isRead">
      <div v-if="readLines.length" class="code-block">
        <div v-for="(line, index) in readLines" :key="index" class="code-line">
          <span class="code-gutter">{{
            String(readStart + index).padStart(readGutterWidth, " ")
          }}</span>
          <span class="code-content">{{ line }}</span>
        </div>
      </div>
      <pre v-else-if="block.status === 'running'" class="tool-result">…</pre>
    </template>

    <!-- 问卷：把问过什么、选了哪一项摊开，而不是那块原始 JSON。 -->
    <QuestionnaireCard v-else-if="block.questionnaire" :result="block.questionnaire" />

    <template v-else>
      <!-- 文件类不再回显参数（行上的 tag 已经说明改的是哪个文件，彬哥）；其余工具
           的参数仍然是唯一能说明「它调了什么」的东西，保留。 -->
      <pre v-if="argsText && !isEdit" class="tool-args">{{ argsText }}</pre>

      <div v-if="diffRows.length" class="diff-block">
        <div v-for="(row, index) in diffRows" :key="index" class="diff-line" :class="row.kind">
          <span class="diff-sign">{{
            row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " "
          }}</span>
          <span class="diff-gutter">{{ row.lineNumber }}</span>
          <span class="diff-content">{{ row.content }}</span>
        </div>
      </div>

      <div v-else-if="writeLines.length" class="diff-block">
        <!-- 整份写入：没有 diff 可对，那就按「全是新增」上色 —— 用户要的是
             「他改了什么」，而不是一段无色的文件内容（彬哥）。 -->
        <div v-for="(line, index) in writeLines" :key="index" class="diff-line added">
          <span class="diff-sign">+</span>
          <span class="diff-gutter">{{ index + 1 }}</span>
          <span class="diff-content">{{ line }}</span>
        </div>
      </div>

      <pre v-else-if="outputText" class="tool-result">{{ outputText }}</pre>

      <pre v-else-if="block.status === 'running'" class="tool-result">…</pre>
    </template>
  </details>
</template>
