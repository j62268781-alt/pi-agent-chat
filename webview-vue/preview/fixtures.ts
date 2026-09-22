// Transcript fixtures for the design preview.
//
// Shaped exactly like what the host pushes (`TranscriptMessage[]`), so the
// preview renders through the real store, the real `turns` computed and the
// real components — only the data is invented. Content mirrors a session on
// this repository, so the sample text has honest lengths and code in it.

import type { ExtensionUiRequest } from "@protocol/rpc";
import type { PendingMessage } from "@/stores/pending.ts";
import type {
  AssistantMessage,
  SystemMessage,
  TranscriptMessage,
  UserMessage,
} from "@/stores/transcript.ts";

const T0 = 1_756_000_000_000;
const MIN = 60_000;

function user(id: string, text: string, at: number): UserMessage {
  return { kind: "user", id, timestamp: at, text, images: [] };
}

function system(
  id: string,
  variant: SystemMessage["variant"],
  text: string,
  at: number,
): TranscriptMessage {
  return { kind: "system", id, variant, text, timestamp: at };
}

/** Tools render one row each; `added`/`removed` feed the turn's +/- summary. */
function tool(
  id: string,
  name: string,
  args: Record<string, unknown>,
  extra: Partial<AssistantMessage["blocks"][number]> = {},
): AssistantMessage["blocks"][number] {
  return {
    kind: "tool",
    id,
    name,
    argsText: JSON.stringify(args),
    args,
    status: "done",
    startedAt: T0,
    durationMs: 120,
    output: "",
    diffText: "",
    writeContent: "",
    added: 0,
    removed: 0,
    filePath: null,
    fileLine: null,
    subagent: null,
    questionnaire: null,
    ...extra,
  } as AssistantMessage["blocks"][number];
}

function assistant(
  id: string,
  at: number,
  blocks: AssistantMessage["blocks"],
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    kind: "assistant",
    id,
    timestamp: at,
    model: "Claude Sonnet 4",
    blocks,
    usage: null,
    stopReason: null,
    errorMessage: null,
    ...overrides,
  };
}

const DIFF = `@@ -98,12 +98,12 @@
 .codicon-history::before {
   content: "\\\\ea82";
 }
-:root {
-  --chat-fs: 14px;
-  --chat-fs-11: calc(var(--chat-fs) * 11 / 13);
-  --chat-fs-12: calc(var(--chat-fs) * 12 / 13);
-}
+:root {
+  --pi-fs-micro: calc(var(--chat-fs) * 10 / 14);
+  --pi-fs-meta: calc(var(--chat-fs) * 12 / 14);
+  --pi-fs-body: var(--chat-fs);
+}`;

export const TRANSCRIPT: TranscriptMessage[] = [
  system("sys-1", "compaction", "", T0 - 12 * MIN),

  user(
    "u-1",
    "webview 的字号有点乱，同一屏里既有 --chat-fs-12 又有硬编码的 13px，调大字号时层次会塌。帮我收一下。",
    T0,
  ),

  assistant("a-1", T0 + 4_000, [
    {
      kind: "thinking",
      id: "th-1",
      text: "先确认字号声明一共散成几种形式：变量档位、硬编码 px、em。硬编码的那些不会跟随 chatFontSize，是层次塌掉的根因。",
      running: false,
      open: false,
    },
    tool(
      "t-1",
      "grep",
      { pattern: "font-size: *[0-9]", path: "webview-vue/src" },
      {
        output:
          "src/styles/chat.css:543:  font-size: 15px;\nsrc/styles/chat.css:766:  font-size: 13px;\nsrc/styles/chat.css:843:  font-size: 12px;\nsrc/styles/chat.css:1007:  font-size: 14px;\nsrc/styles/settings.css:1144:  font-size: 0;",
        durationMs: 84,
        filePath: "webview-vue/src",
      },
    ),
    tool(
      "t-2",
      "read",
      { path: "webview-vue/src/styles/chat.css", offset: 95, limit: 40 },
      {
        output:
          ":root {\n  --chat-fs: 14px;\n  --chat-fs-8: calc(var(--chat-fs) * 8 / 13);\n  --chat-fs-9: calc(var(--chat-fs) * 9 / 13);\n  --chat-fs-10: calc(var(--chat-fs) * 10 / 13);\n  --chat-fs-11: calc(var(--chat-fs) * 11 / 13);\n  --chat-fs-12: calc(var(--chat-fs) * 12 / 13);\n  --chat-fs-14: calc(var(--chat-fs) * 14 / 13);\n  --chat-fs-15: calc(var(--chat-fs) * 15 / 13);\n}",
        durationMs: 41,
        filePath: "webview-vue/src/styles/chat.css",
        fileLine: 95,
      },
    ),
    tool(
      "t-3",
      "edit",
      { path: "webview-vue/src/styles/chat.css", oldText: ":root {…}", newText: ":root {…}" },
      {
        diffText: DIFF,
        added: 4,
        removed: 6,
        durationMs: 213,
        filePath: "webview-vue/src/styles/chat.css",
        fileLine: 109,
      },
    ),
    tool(
      "t-4",
      "bash",
      { command: "pnpm --filter @pi-agent-chat/webview-vue test" },
      {
        output:
          " ✓ test/components/TurnBlock.test.ts (12)\n ✓ test/components/QueuePanel.test.ts (5)\n\n Test Files  2 passed (2)\n      Tests  17 passed (17)",
        durationMs: 4_180,
      },
    ),
    tool(
      "t-5",
      "bash",
      { command: "pnpm --filter @pi-agent-chat/webview-vue typecheck" },
      {
        output:
          "src/styles/chat.css — no type errors\nnode scripts/extract-model-icons.mjs\nvue-tsc --noEmit -p tsconfig.json",
        status: "error",
        durationMs: 9_640,
      },
    ),
    tool(
      "t-6",
      "task",
      { description: "audit remaining literals" },
      {
        subagent: {
          title: "Audit remaining colour literals",
          failed: false,
          body: "6 literals in `.mcp-state-*` / `.mcp-dot-*`; the lightbox scrim text and the mermaid canvas are deliberate and should stay.",
        },
        durationMs: 22_500,
      },
    ),
    {
      kind: "text",
      id: "tx-1",
      markdown: `## 收完了，字号从九档收敛到五档

改动集中在 \`webview-vue/src/styles/\` 下，**没有动布局**：

1. 九个数值档位（\`--chat-fs-8\` … \`-16\`）合并成五档语义档位，全部由 \`chatFontSize\` 按比例驱动；
2. 38 处硬编码 \`font-size\` 改为引用语义档位——这正是调大字号时层次塌掉的原因；
3. 行高按用途配对：正文 1.6 阅读、行 1.4 扫读、标签 1.35 收紧。

| 档位 | 默认值 | 用在哪 |
| --- | --- | --- |
| \`display\` | 18px | 空态标题 |
| \`title\` | 16px | 轮次头、对话框标题 |
| \`body\` | 14px | 正文、按钮 |
| \`meta\` | 12px | 工具行、时间戳 |
| \`micro\` | 10px | 徽标、计数 |

新的比例是这样的：

\`\`\`css
:root {
  --pi-fs-micro: calc(var(--chat-fs) * 10 / 14);
  --pi-fs-meta: calc(var(--chat-fs) * 12 / 14);
  --pi-fs-body: var(--chat-fs);
}
\`\`\`

主题跟随之后，色值的来源变成这样：

\`\`\`mermaid
flowchart LR
  A[VS Code 主题] --> B[--vscode-* 变量]
  B --> C[tokens.css]
  C --> D[聊天面板]
  C --> E[设置面板]
\`\`\`

> 内联代码不再用 \`0.92em\`，改为跟随编辑器的字号与字族，聊天里的片段和编辑器里的同一段代码看起来一致。

一个待定项：工具栏图标的 18px 是上一轮为修一个变量名写错的问题而加的（见 \`chat.css:2897\` 的注释）。尺寸钉死并居中之后，16px 才是 VS Code 工具栏自己的规格，要不要退回去由你定。`,
      streaming: false,
      collapsed: false,
    },
  ]),

  user("u-2", "顺便把工具行的图标也统一一下吧，现在有的 16 有的 18。", T0 + 9 * MIN),

  assistant(
    "a-2",
    T0 + 9 * MIN + 3_000,
    [
      {
        kind: "thinking",
        id: "th-2",
        text: "图标不该跟着 chatFontSize 缩放，VS Code 自身的工具栏图标是固定 16px。先看现在有哪几种尺寸在用。",
        running: true,
        open: true,
      },
      tool(
        "t-7",
        "grep",
        { pattern: "codicon.*font-size|font-size.*codicon", path: "webview-vue/src/styles" },
        { status: "running", output: "", durationMs: null },
      ),
    ],
    { stopReason: null },
  ),
];

/**
 * The queue above the composer.
 *
 * This is the composer's own pending list — the one that owns an id per row and
 * therefore the one that can steer, edit and delete. pi's own `steering` /
 * `followUp` queue is deliberately *not* seeded: it reports bare strings with no
 * handle, so it is read-only, and in practice it stays empty now that queue
 * messages are held locally.
 */
export const PENDING: PendingMessage[] = [
  {
    id: "pending-1",
    text: "先别动 settings.css，那边我还要改",
    images: [],
    mode: "queue",
    createdAt: 1_756_000_540_000,
  },
  {
    id: "pending-2",
    text: "改完把 docs/design/STYLE-SPEC.md 也更新一下",
    images: [],
    mode: "queue",
    createdAt: 1_756_000_541_000,
  },
  {
    id: "pending-3",
    text: "顺便确认一下 300px 侧栏下不会挤",
    images: [],
    mode: "steer",
    createdAt: 1_756_000_542_000,
  },
];

/** Session state the toolbar and composer read: model, thinking, the ring. */
export const SESSION = {
  sessionName: "字号与图标收口",
  model: { id: "claude-sonnet-4", name: "Claude Sonnet 4", provider: "anthropic", reasoning: true },
  thinkingLevel: "medium",
  thinkingLevels: ["off", "low", "medium", "high"],
  permissionMode: "AskForApproval" as const,
  isStreaming: true,
  statusText: "working",
  messageCount: 4,
  contextUsage: { tokens: 68_400, contextWindow: 200_000, percent: 34 },
  sessionCost: 0.42,
};

/**
 * The two questions the ask card answers, exactly as the host pushes them: a
 * `select` from the permission gate and an `editor` whose prefill is the
 * questionnaire's form definition.
 */
export const ASK = {
  permission: {
    type: "extension_ui_request",
    id: "preview-permission",
    method: "select",
    title: "Permission Required",
    message:
      'tool : bash\ninput : with input {"command":"git checkout pubspec.lock","description":"还原依赖锁变更"}',
    options: ["Yes", 'Yes, allow tool "bash" for this session', "No", "No, provide reason"],
  } as ExtensionUiRequest,
  questionnaire: {
    type: "extension_ui_request",
    id: "preview-questionnaire",
    method: "editor",
    title: "Pi Questionnaire Form",
    prefill: JSON.stringify({
      questions: [
        {
          id: "stylesheet",
          label: "Stylesheet",
          prompt:
            "工作区的 chat.css 有 200 多行与令牌层对不上，看起来像上一轮手工改过样式，并不是这次任务的产物。要怎么处理？",
          options: [
            {
              label: "还原掉",
              description:
                "git checkout webview-vue/src/styles/chat.css，避免把无关的改动带进后续提交",
            },
            { label: "保留这些变动", description: "确定是有意的调整，需要一起提交" },
            {
              label: "先给我看差异",
              description: "我先列出具体哪些规则变了、方向如何，再由你决定",
            },
          ],
          allowOther: true,
        },
        {
          id: "scope",
          label: "收口",
          prompt: "这一轮改动要落到哪些文件？",
          options: [
            { label: "只动样式", description: "chat.css 与令牌层" },
            { label: "样式加组件" },
            { label: "连测试一起", description: "顺带补上契约测试" },
          ],
          allowOther: true,
        },
      ],
    }),
  } as ExtensionUiRequest,
};

/**
 * Sessions for the switcher popup — the list the host pushes back on
 * `listSessions`, newest first, with the first one open. Times are relative to
 * load so the popup's "N min ago" line stays meaningful in a screenshot run.
 */
export const SESSIONS = [
  {
    file: "/Users/joeson/.pi/agent/sessions/--preview--/2026-09-22T11-53-00.jsonl",
    name: "",
    firstMessage: "只回复 pong",
    modified: new Date(Date.now() - 11 * 60000).toISOString(),
    messageCount: 3,
  },
  {
    file: "/Users/joeson/.pi/agent/sessions/--preview--/2026-09-22T11-52-00.jsonl",
    name: "",
    firstMessage: "只回复 pok",
    modified: new Date(Date.now() - 12 * 60000).toISOString(),
    messageCount: 5,
  },
  {
    file: "/Users/joeson/.pi/agent/sessions/--preview--/2026-09-22T11-38-00.jsonl",
    name: "字号与图标收口",
    firstMessage: "",
    modified: new Date(Date.now() - 25 * 60000).toISOString(),
    messageCount: 42,
  },
];
