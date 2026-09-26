# 面板 todo（胶囊 + 悬浮窗）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 模型通过 `todo` 工具维护任务的待办列表，VS Code 面板在输入区上方显示一枚可悬停展开的胶囊（`任务 1/3`）。

**Architecture:** 新增 bundled pi 扩展（`pi-extensions/todo.ts`）持有当前会话的列表并向 pi 发 `setWidget("pi-todo", [JSON])`；宿主原样转发给 webview；webview 按 key 渲染胶囊。列表**不落在消息历史里**，所以 compaction 不影响它；实测 `abort` 不清 widget，切会话由扩展自己清。

**Tech Stack:** TypeScript（pi 扩展 + typebox schema）、Vue 3 + Pinia（webview）、vitest + @vue/test-utils（jsdom）、Playwright（效果图）。

**Spec:** `docs/superpowers/specs/2026-09-26-panel-todo-design.md`（执行者请一并读，本计划从它推导）

## Global Constraints

- **不做 TUI 渲染**：只发 JSON 行；TUI 里显示生 JSON 可接受（用户不用 TUI）。
- **不做面板侧交互**：胶囊与浮层只读，不勾选、不删除、不排序。
- **不持久化**：不写 `workspaceState`、不写磁盘。
- **全量快照契约**：`items` 是完整列表，上限 **50** 项，超出截断。
- **widget 载荷**：`widgetLines[0]` = `JSON.stringify({ items, updatedAt })`；键名固定 `"pi-todo"`。
- **不新增 codicon 字形**（手工子集）→ 只用已声明的 `codicon-check` 等；进行中圆环复用 `@keyframes tool-spin`。
- **测试位置**：host `test/unit/**`（`vitest.config.ts` 只收这个 glob）；webview `webview-vue/test/{components,stores}/`。
- **格式化**：只对改动文件跑 `pnpm exec oxfmt <file>`；**别**跑全仓 `pnpm run fmt`。
- **提交**：每任务末尾给了 commit 命令但**默认不执行** —— 用户点名才提交（“提交这 N 个文件”= 一个提交打包）。
- 验证命令：`pnpm run lint`、`pnpm run typecheck`、`npx vitest run`、`pnpm --filter @pi-agent-chat/webview-vue test`、`node scripts/typecheck-pi-extensions.mjs`。

---

### Task 1: `todo-model.ts`（纯函数，可单测）

**Files:**

- Create: `pi-extensions/todo-model.ts`
- Test: `test/unit/pi-extensions/todo-model.test.ts`

**Interfaces:**

- Consumes: 无（不依赖 pi / vscode）
- Produces（Task 2 用）:
  - `type TodoStatus = "pending" | "in_progress" | "completed"`
  - `interface TodoItem { id: string; text: string; status: TodoStatus }`
  - `const MAX_ITEMS = 50`、`const WIDGET_KEY = "pi-todo"`
  - `parseTodoItems(raw: unknown): { ok: true; items: TodoItem[]; dropped: number } | { ok: false; error: string }`
    （`dropped` = 因超过 `MAX_ITEMS` 被截掉的条数）
  - `summarize(items: TodoItem[], dropped?: number): string`
  - `toWidgetPayload(items: TodoItem[], now: number): string`

- [ ] **Step 1: 写失败测试**

Create `test/unit/pi-extensions/todo-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_ITEMS,
  parseTodoItems,
  summarize,
  toWidgetPayload,
} from "../../../pi-extensions/todo-model.ts";

describe("parseTodoItems", () => {
  it("accepts a well-formed list and trims the text", () => {
    const result = parseTodoItems({
      items: [{ id: "a", text: "  写迁移脚本  ", status: "in_progress" }],
    });
    expect(result).toEqual({
      ok: true,
      items: [{ id: "a", text: "写迁移脚本", status: "in_progress" }],
      dropped: 0,
    });
  });

  it("accepts an empty list as a deliberate clear", () => {
    expect(parseTodoItems({ items: [] })).toEqual({ ok: true, items: [], dropped: 0 });
  });

  it("rejects an unknown status", () => {
    const result = parseTodoItems({ items: [{ id: "a", text: "x", status: "done" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("status");
  });

  it("rejects a missing or blank text", () => {
    expect(parseTodoItems({ items: [{ id: "a", text: "   ", status: "pending" }] }).ok).toBe(false);
    expect(parseTodoItems({ items: [{ id: "a", status: "pending" }] }).ok).toBe(false);
  });

  it("rejects a missing id and duplicate ids", () => {
    expect(parseTodoItems({ items: [{ text: "x", status: "pending" }] }).ok).toBe(false);
    expect(
      parseTodoItems({
        items: [
          { id: "dup", text: "a", status: "pending" },
          { id: "dup", text: "b", status: "pending" },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects a non-array items field", () => {
    expect(parseTodoItems({ items: "nope" }).ok).toBe(false);
    expect(parseTodoItems(undefined).ok).toBe(false);
  });

  it("truncates past MAX_ITEMS instead of failing", () => {
    const items = Array.from({ length: MAX_ITEMS + 7 }, (_, i) => ({
      id: `t${i}`,
      text: `task ${i}`,
      status: "pending" as const,
    }));
    const result = parseTodoItems({ items });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(MAX_ITEMS);
      expect(result.dropped).toBe(7);
    }
  });
});

describe("summarize", () => {
  it("counts each status and the total", () => {
    expect(
      summarize([
        { id: "a", text: "x", status: "in_progress" },
        { id: "b", text: "y", status: "pending" },
        { id: "c", text: "z", status: "pending" },
        { id: "d", text: "w", status: "completed" },
      ]),
    ).toBe("待办已更新：1 进行中 · 2 待处理 · 1 已完成（共 4）");
  });

  it("mentions what the cap hid", () => {
    expect(summarize([{ id: "a", text: "x", status: "pending" }], 7)).toContain("另有 7 项未显示");
  });
});

describe("toWidgetPayload", () => {
  it("is the JSON the webview parses out of widgetLines[0]", () => {
    const items = [{ id: "a", text: "x", status: "pending" as const }];
    expect(JSON.parse(toWidgetPayload(items, 1234))).toEqual({ items, updatedAt: 1234 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/unit/pi-extensions/todo-model.test.ts`
Expected: FAIL — `Cannot find module '../../../pi-extensions/todo-model.ts'`

- [ ] **Step 3: 写实现**

Create `pi-extensions/todo-model.ts`:

```ts
// Pure helpers for the bundled `todo` extension: validating the model's list and
// rendering the strings the tool returns / publishes. No pi imports, so the rules
// stay unit-testable.

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
}

/** The model writes the whole list every call; beyond this we truncate. */
export const MAX_ITEMS = 50;

/** Widget key the webview renders (`TodoPill.vue` hardcodes the same string). */
export const WIDGET_KEY = "pi-todo";

const STATUSES: readonly TodoStatus[] = ["pending", "in_progress", "completed"];

export function parseTodoItems(
  raw: unknown,
): { ok: true; items: TodoItem[]; dropped: number } | { ok: false; error: string } {
  const list = (raw as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(list)) {
    return { ok: false, error: "`items` must be an array — send the complete list every call." };
  }
  const items: TodoItem[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const item = entry as { id?: unknown; text?: unknown; status?: unknown };
    if (typeof item?.id !== "string" || item.id.trim() === "") {
      return { ok: false, error: "Every todo needs a non-empty string `id`." };
    }
    if (seen.has(item.id)) return { ok: false, error: `Duplicate todo id "${item.id}".` };
    if (typeof item.text !== "string" || item.text.trim() === "") {
      return { ok: false, error: `Todo "${item.id}" needs non-empty \`text\`.` };
    }
    if (typeof item.status !== "string" || !STATUSES.includes(item.status as TodoStatus)) {
      return {
        ok: false,
        error: `Todo "${item.id}" has an invalid \`status\` — use pending, in_progress or completed.`,
      };
    }
    seen.add(item.id);
    items.push({ id: item.id, text: item.text.trim(), status: item.status as TodoStatus });
  }
  const kept = items.slice(0, MAX_ITEMS);
  return { ok: true, items: kept, dropped: items.length - kept.length };
}

export function summarize(items: TodoItem[], dropped = 0): string {
  const count = (status: TodoStatus) => items.filter((item) => item.status === status).length;
  const base = `待办已更新：${count("in_progress")} 进行中 · ${count("pending")} 待处理 · ${count("completed")} 已完成（共 ${items.length}）`;
  return dropped > 0 ? `${base} —— 另有 ${dropped} 项未显示（上限 ${MAX_ITEMS}）` : base;
}

export function toWidgetPayload(items: TodoItem[], now: number): string {
  return JSON.stringify({ items, updatedAt: now });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/unit/pi-extensions/todo-model.test.ts`
Expected: PASS

- [ ] **Step 5: 类型检查 + 格式化**

```bash
node scripts/typecheck-pi-extensions.mjs pi-extensions/todo-model.ts
pnpm exec oxfmt pi-extensions/todo-model.ts test/unit/pi-extensions/todo-model.test.ts
```

- [ ] **Step 6: Commit（默认不执行，等用户点名）**

```bash
git add pi-extensions/todo-model.ts test/unit/pi-extensions/todo-model.test.ts
git commit -m "feat(pi-extensions): validate and summarise the todo list"
```

---

### Task 2: `todo.ts` 扩展 + 注入接线

**Files:**

- Create: `pi-extensions/todo.ts`
- Modify: `src/utils/constants.ts`（加 `TODO_EXTENSION_PATH`）
- Modify: `src/services/pi/process.ts`（`createPiShellArgs` 与 `createRpcShellArgs` 两处注入点）
- Modify: `package.json`（`pi-agent-chat.disabledTools` 的 enum）
- Modify: `README.md`（bundled tools 清单那行）

**Interfaces:**

- Consumes: Task 1 的 `parseTodoItems` / `summarize` / `toWidgetPayload` / `WIDGET_KEY` / `MAX_ITEMS`
- Produces: 工具 `todo({ items })`；widget 消息 `{ widgetKey: "pi-todo", widgetLines: [payload] }`；工具结果 `details: { items, total, completed }`

- [ ] **Step 1: 写扩展**

Create `pi-extensions/todo.ts`:

```ts
/**
 * Bundled `todo` extension: the model replaces the session's task list, and the
 * list is published as a widget so the VS Code panel can show it above the
 * composer.
 *
 * The state lives here (per session runtime), NOT in the tool results: the
 * transcript gets compacted, and a compacted-away result would take the list with
 * it. pi does not clear widgets on its own — abort, new_session and
 * switch_session were all measured to leave them alone — so clearing is this
 * extension's job.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  MAX_ITEMS,
  WIDGET_KEY,
  parseTodoItems,
  summarize,
  toWidgetPayload,
  type TodoItem,
} from "./todo-model.js";

const TodoParams = Type.Object({
  items: Type.Array(
    Type.Object({
      id: Type.String({
        description: "Stable short id, unchanged across calls (kebab-case, <=32 chars)",
      }),
      text: Type.String({ description: "What the step is" }),
      status: StringEnum(["pending", "in_progress", "completed"] as const),
    }),
    {
      description:
        "The COMPLETE task list, in order. Always send every item — not just the ones that " +
        `changed: an omitted item is gone. Send an empty array to clear the list. At most ${MAX_ITEMS} items.`,
    },
  ),
});

export default function todo(pi: ExtensionAPI) {
  const disabledTools = (() => {
    try {
      const parsed = JSON.parse(process.env.PI_VSCODE_DISABLED_TOOLS ?? "[]");
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  })();
  if (disabledTools.includes("todo")) return;

  let items: TodoItem[] = [];

  const publish = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget(
      WIDGET_KEY,
      items.length === 0 ? undefined : [toWidgetPayload(items, Date.now())],
    );
  };

  // Session-scoped: every session start (startup/new/resume/fork) begins with no
  // list, and every teardown clears the widget. pi fires session_start twice for a
  // replacement, so this has to be idempotent — it is.
  const reset = (ctx: ExtensionContext): void => {
    items = [];
    publish(ctx);
  };
  pi.on("session_start", (_event, ctx) => reset(ctx));
  pi.on("session_shutdown", (_event, ctx) => reset(ctx));
  pi.on("session_before_switch", (_event, ctx) => reset(ctx));
  // Insurance only: compaction rewrites messages, not UI state, and no run was
  // ever observed clearing a widget — but re-publishing costs one line.
  pi.on("session_compact", (_event, ctx) => publish(ctx));

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description:
      "Replace the session's task list, then keep it current as you work. Use it for multi-step tasks: " +
      "send the COMPLETE list on every call (an item you omit is gone), keep exactly one item in_progress " +
      "while you work on it, and send an empty list when the work is done.",
    parameters: TodoParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parsed = parseTodoItems(params);
      // Throwing is the only way to fail a tool call — returning `isError` never
      // sets the flag (extensions.md:2120). The widget is deliberately left as it
      // was, so a malformed call cannot wipe the card the user is reading.
      if (!parsed.ok) throw new Error(parsed.error);

      items = parsed.items;
      publish(ctx);
      return {
        content: [{ type: "text" as const, text: summarize(items, parsed.dropped) }],
        details: {
          items,
          total: items.length,
          completed: items.filter((item) => item.status === "completed").length,
        },
      };
    },
  });
}
```

- [ ] **Step 2: 接线**

`src/utils/constants.ts` 加一行：

```ts
export const TODO_EXTENSION_PATH = "pi-extensions/todo.ts";
```

`src/services/pi/process.ts`：把两份重复的扩展路径列表抽成一个共用常量，并在 `createPiShellArgs` / `createRpcShellArgs` 两处都用它：

```ts
/** Bundled pi extensions, injected with `-e` on every spawn. */
export const BUNDLED_EXTENSIONS = [
  BRIDGE_EXTENSION_PATH,
  QUESTIONNAIRE_EXTENSION_PATH,
  TODO_EXTENSION_PATH,
  PERMISSION_GATE_EXTENSION_PATH,
  REWIND_CODE_EXTENSION_PATH,
] as const;

const extensionArgs = BUNDLED_EXTENSIONS.flatMap((path) => [
  "-e",
  join(options.extensionUri.fsPath, path),
]);
```

import 里补 `TODO_EXTENSION_PATH`；两处原来的 `-e` 字面量数组整体替换为 `...extensionArgs`（注意 `createRpcShellArgs` 那份**没有** `"-e"` 前缀，抽常量时必须统一成上面这种带 `-e` 的形式）。

`package.json` → `pi-agent-chat.disabledTools.items.enum`：

```json
"enum": ["vscode_get_diagnostics", "questionnaire", "todo"]
```

`README.md` 那一行：

```
| `pi-agent-chat.disabledTools`       | `[]`             | bundled tools to keep unregistered (`vscode_get_diagnostics`, `questionnaire`, `todo`) |
```

- [ ] **Step 3: 类型检查 + lint**

```bash
node scripts/typecheck-pi-extensions.mjs
pnpm run typecheck
pnpm exec oxfmt pi-extensions/todo.ts src/utils/constants.ts src/services/pi/process.ts
```

Expected: 全 0 退出。若某个生命周期事件的第二参不是 `ctx`，类型会在这里报错——按报错改成该 handler 的签名。

- [ ] **Step 4: 真会话冒烟**

Create `/tmp/todo-smoke.mjs`:

```js
// Boots pi with the todo extension injected, asks the model to publish a list,
// and asserts the widget message reaches the client.
import { spawn } from "node:child_process";

const repo = "/Users/joeson/Documents/pi-agent-chat";
const proc = spawn("pi", ["--mode", "rpc", "-e", `${repo}/pi-extensions/todo.ts`], {
  cwd: repo,
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
});
const send = (o) => proc.stdin.write(JSON.stringify(o) + "\n");
let booted = false;
let sawWidget = false;
let buffer = "";
proc.stdout.on("data", (c) => {
  buffer += c.toString("utf8");
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.type === "response" && m.command === "get_state" && !booted) {
      booted = true;
      send({
        id: 10,
        type: "prompt",
        message: "调用 todo 工具，列出两项：第一步(进行中)、第二步(待处理)",
      });
    }
    if (
      m.type === "extension_ui_request" &&
      m.method === "setWidget" &&
      m.widgetKey === "pi-todo"
    ) {
      sawWidget = true;
      console.log("WIDGET:", JSON.stringify(m.widgetLines));
    }
  }
});
const poll = setInterval(() => {
  if (!booted) send({ id: 1, type: "get_state" });
}, 400);
setTimeout(() => {
  clearInterval(poll);
  proc.kill("SIGKILL");
  console.log(sawWidget ? "PASS: pi-todo widget reached the client" : "FAIL: no widget seen");
  process.exit(sawWidget ? 0 : 1);
}, 60000);
```

Run: `node /tmp/todo-smoke.mjs`
Expected: 一行 `WIDGET: ["{\"items\":[…],\"updatedAt\":…}"]`，末行 `PASS`。
（这是"注册成功且能发 widget"的验证；模型偶尔不调工具就重跑一次。）

- [ ] **Step 5: 清理**

```bash
rm /tmp/todo-smoke.mjs
```

- [ ] **Step 6: Commit（默认不执行）**

```bash
git add pi-extensions/todo.ts src/utils/constants.ts src/services/pi/process.ts package.json README.md
git commit -m "feat(pi-extensions): a todo tool whose list reaches the panel"
```

---

### Task 3: widget 单槽 → 按 key 的 map（含 rewind 迁移）

**Files:**

- Modify: `webview-vue/src/stores/overlays.ts`（widget / widgetOpen / applyWidget / return）
- Modify: `webview-vue/src/components/RewindWidget.vue:25-29`
- Test: `webview-vue/test/stores/overlays.test.ts`（新建）、`webview-vue/test/components/RewindWidget.test.ts`（新建）

**Interfaces:**

- Consumes: host 侧照旧调用 `applyWidget(key, lines)`（签名不变）
- Produces: `widgets: Ref<Record<string, string[]>>`（Task 4/5 读 `widgets["rewind-files"]` / `widgets["pi-todo"]`）；**删除** `widget` 与 `widgetOpen` 两个导出

- [ ] **Step 1: 写失败测试**

Create `webview-vue/test/stores/overlays.test.ts`:

```ts
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useOverlaysStore } from "@/stores/overlays.ts";

describe("overlays widget slots", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("keeps one entry per key, so two extensions cannot evict each other", () => {
    const overlays = useOverlaysStore();
    overlays.applyWidget("rewind-files", ['{"files":[]}']);
    overlays.applyWidget("pi-todo", ['{"items":[]}']);
    expect(Object.keys(overlays.widgets)).toEqual(["rewind-files", "pi-todo"]);
  });

  it("clearing one key leaves the other alone", () => {
    const overlays = useOverlaysStore();
    overlays.applyWidget("rewind-files", ["a"]);
    overlays.applyWidget("pi-todo", ["b"]);
    overlays.applyWidget("pi-todo", undefined);
    expect(overlays.widgets["pi-todo"]).toBeUndefined();
    expect(overlays.widgets["rewind-files"]).toEqual(["a"]);
  });

  it("treats empty lines as a clear and ignores a missing key", () => {
    const overlays = useOverlaysStore();
    overlays.applyWidget("pi-todo", ["x"]);
    overlays.applyWidget("pi-todo", []);
    overlays.applyWidget(undefined, ["y"]);
    expect(overlays.widgets).toEqual({});
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @pi-agent-chat/webview-vue test -- run test/stores/overlays.test.ts`
Expected: FAIL — `overlays.widgets` 为 `undefined`

- [ ] **Step 3: 改 store**

`webview-vue/src/stores/overlays.ts`：

```ts
const widgets = ref<Record<string, string[]>>({});
```

（删掉 `const widget = ref<{ key: string; lines: string[] } | null>(null);` 和 `const widgetOpen = ref(true);`；`applyWidget` 换成下面这版；return 里的 `widget,` / `widgetOpen,` 换成 `widgets,`）

```ts
/**
 * One slot per widget key. With a single slot, any extension clearing its own
 * widget (`setWidget(key, undefined)`) wiped whoever else had one showing.
 */
function applyWidget(key: string | undefined, lines: string[] | undefined): void {
  if (!key) return;
  if (!lines || lines.length === 0) {
    const next = { ...widgets.value };
    delete next[key];
    widgets.value = next;
    return;
  }
  widgets.value = { ...widgets.value, [key]: lines };
}
```

- [ ] **Step 4: 迁移 rewind 并补它的测试**

`webview-vue/src/components/RewindWidget.vue`：

```ts
const parsed = computed(() => {
  const lines = overlays.widgets["rewind-files"];
  if (!lines) return null;
  return parseRewindWidget(lines);
});
```

Create `webview-vue/test/components/RewindWidget.test.ts`:

```ts
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RewindWidget from "@/components/RewindWidget.vue";
import { useOverlaysStore } from "@/stores/overlays.ts";

vi.mock("@/lib/bridge.ts", () => ({
  post: () => {},
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

describe("RewindWidget", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("renders nothing without its payload", () => {
    expect(mount(RewindWidget).find(".rewind-widget").exists()).toBe(false);
  });

  it("renders nothing when another key is showing", () => {
    useOverlaysStore().applyWidget("pi-todo", ['{"items":[]}']);
    expect(mount(RewindWidget).find(".rewind-widget").exists()).toBe(false);
  });

  it("renders the card once the host sends rewind-files", () => {
    useOverlaysStore().applyWidget("rewind-files", [
      JSON.stringify({ files: [{ path: "/tmp/a.ts", added: 2, removed: 1 }] }),
    ]);
    expect(mount(RewindWidget).find(".rewind-widget").exists()).toBe(true);
  });
});
```

（若 `parseRewindWidget` 要的键名不同，以 `webview-vue/src/lib/rewind-parse.ts` 为准调整第三个用例的 JSON。）

- [ ] **Step 5: 跑 webview 全套**

Run: `pnpm --filter @pi-agent-chat/webview-vue test`
Expected: PASS

- [ ] **Step 6: Commit（默认不执行）**

```bash
git add webview-vue/src/stores/overlays.ts webview-vue/src/components/RewindWidget.vue webview-vue/test/stores/overlays.test.ts webview-vue/test/components/RewindWidget.test.ts
git commit -m "fix(chat): give each widget its own slot"
```

---

### Task 4: `TodoPill.vue`（胶囊 + 悬停浮层）

**Files:**

- Create: `webview-vue/src/components/TodoPill.vue`
- Modify: `webview-vue/src/styles/chat.css`（文件末尾追加一个样式块）
- Modify: `webview-vue/src/locales/chat.zh-cn.json`（末尾追加 2 个键）
- Test: `webview-vue/test/components/TodoPill.test.ts`

**Interfaces:**

- Consumes: Task 3 的 `overlays.widgets["pi-todo"]`
- Produces: `<TodoPill />`（无 props、无 emit）；类名 `.todo-pill-hover` / `.todo-pill` / `.todo-popover`，供 Task 5 放进 `.float-row`

- [ ] **Step 1: 写失败测试**

Create `webview-vue/test/components/TodoPill.test.ts`:

```ts
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n.ts";
import TodoPill from "@/components/TodoPill.vue";
import { useOverlaysStore } from "@/stores/overlays.ts";

vi.mock("@/lib/bridge.ts", () => ({
  post: () => {},
  persisted: { get: () => undefined, set: () => {} },
  onHostMessage: () => () => {},
}));

type Status = "pending" | "in_progress" | "completed";

function publish(items: Array<{ id: string; text: string; status: Status }>, at = 1): void {
  useOverlaysStore().applyWidget("pi-todo", [JSON.stringify({ items, updatedAt: at })]);
}

const THREE = [
  { id: "a", text: "第一步", status: "completed" as Status },
  { id: "b", text: "第二步", status: "in_progress" as Status },
  { id: "c", text: "第三步", status: "pending" as Status },
];

describe("TodoPill", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("renders nothing without a payload", () => {
    expect(mount(TodoPill).find(".todo-pill").exists()).toBe(false);
  });

  it("renders nothing for an empty list", () => {
    publish([]);
    expect(mount(TodoPill).find(".todo-pill").exists()).toBe(false);
  });

  it("renders nothing when the payload is malformed", () => {
    useOverlaysStore().applyWidget("pi-todo", ["not json"]);
    expect(mount(TodoPill).find(".todo-pill").exists()).toBe(false);
  });

  it("labels the done/total count as tasks", () => {
    publish(THREE);
    const label = mount(TodoPill).get(".todo-pill-label").text();
    expect(label).toContain(t("Tasks"));
    expect(label).toContain("1/3");
  });

  it("opens the list on hover and closes after the leave delay", async () => {
    publish(THREE);
    const wrapper = mount(TodoPill);
    expect(wrapper.find(".todo-popover").exists()).toBe(false);

    await wrapper.get(".todo-pill-hover").trigger("mouseenter");
    expect(wrapper.get(".todo-popover").text()).toContain("第一步");
    expect(wrapper.get(".todo-popover").classes()).toContain("is-open");

    await wrapper.get(".todo-pill-hover").trigger("mouseleave");
    vi.advanceTimersByTime(200);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".todo-popover.is-open").exists()).toBe(false);
  });

  it("says 全部完成 and hides itself three seconds later", async () => {
    publish([
      { id: "a", text: "第一步", status: "completed" },
      { id: "b", text: "第二步", status: "completed" },
    ]);
    const wrapper = mount(TodoPill);
    expect(wrapper.get(".todo-pill").text()).toContain(t("All done"));

    vi.advanceTimersByTime(3100);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".todo-pill").exists()).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @pi-agent-chat/webview-vue test -- run test/components/TodoPill.test.ts`
Expected: FAIL — 找不到 `@/components/TodoPill.vue`

- [ ] **Step 3: 写组件**

Create `webview-vue/src/components/TodoPill.vue`:

```vue
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

watch(allDone, (finished) => {
  if (linger !== undefined) clearTimeout(linger);
  hidden.value = false;
  if (!finished) return;
  linger = setTimeout(() => {
    hidden.value = true;
  }, ALL_DONE_LINGER_MS);
});

const open = ref(false);
let leave: ReturnType<typeof setTimeout> | undefined;

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
      <span class="todo-pill-label">{{ allDone ? t("All done") : `${done}/${total}` }}</span>
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
```

- [ ] **Step 4: 追加样式**

`webview-vue/src/styles/chat.css` 末尾追加（沿用既有 token；**不新增 codicon 字形**）：

```css
/* ── 面板 todo：胶囊 + 悬停浮层 ───────────────────────────────────────────────
 * 胶囊与「回到底部」按钮同处一条居中浮空行（`.float-row`，见下）。载荷来自
 * `pi-extensions/todo.ts` 发的 widget，`widgetLines[0]` 是 JSON。只读：模型写。 */
.todo-pill-hover {
  position: relative;
  display: flex;
  align-items: center;
}

.todo-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  background: var(--pi-bg-raised);
  color: var(--pi-text);
  border: var(--pi-stroke) solid var(--pi-border);
  border-radius: 15px;
  box-shadow: var(--pi-shadow-menu);
  cursor: default;
  font-size: var(--pi-fs-meta);
  font-variant-numeric: tabular-nums;
}

.todo-pill-icon {
  font-size: 14px;
  color: var(--pi-text-secondary);
}

.todo-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 31;
  min-width: 220px;
  max-width: 340px;
  max-height: 240px;
  overflow-y: auto;
  padding: 8px 10px;
  background: var(--pi-bg-raised);
  border: var(--pi-stroke) solid var(--pi-border);
  border-radius: var(--pi-r-lg);
  box-shadow: var(--pi-shadow-menu);
}

.todo-popover-title {
  margin-bottom: 6px;
  color: var(--pi-text-muted);
  font-size: var(--pi-fs-micro);
  font-variant-numeric: tabular-nums;
}

.todo-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.todo-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: var(--pi-fs-meta);
  line-height: 1.4;
}

.todo-state {
  flex-shrink: 0;
  width: 14px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--pi-text-muted);
}

.todo-row.is-completed .todo-text {
  color: var(--pi-text-muted);
  text-decoration: line-through;
}

.todo-row.is-in_progress .todo-text {
  color: var(--pi-text);
}

.todo-row.is-pending .todo-text {
  color: var(--pi-text-secondary);
}

/* 进行中的圆环：复用既有 tool-spin，不新增字形。 */
.todo-spin {
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--pi-border);
  border-top-color: var(--pi-text-secondary);
  border-radius: 50%;
  animation: tool-spin 0.7s linear infinite;
}
```

- [ ] **Step 5: 追加文案**

`webview-vue/src/locales/chat.zh-cn.json` 末尾（最后一项后面加逗号）：

```json
  "Todos": "待办",
  "All done": "全部完成"
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter @pi-agent-chat/webview-vue test -- run test/components/TodoPill.test.ts`
Expected: PASS（9 个用例）

- [ ] **Step 7: 格式化 + 全套**

```bash
pnpm exec oxfmt webview-vue/src/components/TodoPill.vue webview-vue/src/styles/chat.css webview-vue/src/locales/chat.zh-cn.json webview-vue/test/components/TodoPill.test.ts
pnpm --filter @pi-agent-chat/webview-vue test
```

Expected: 全绿。

- [ ] **Step 8: Commit（默认不执行）**

```bash
git add webview-vue/src/components/TodoPill.vue webview-vue/src/styles/chat.css webview-vue/src/locales/chat.zh-cn.json webview-vue/test/components/TodoPill.test.ts
git commit -m "feat(chat): a todo capsule that opens on hover"
```

---

### Task 5: 挂进输入区上方那条浮空行 + 效果图

**Files:**

- Modify: `webview-vue/src/components/TranscriptView.vue`（template 末尾 + script import）
- Modify: `webview-vue/src/styles/chat.css`（`.float-row` 与按钮的位置覆写）
- Test: `webview-vue/test/components/TranscriptView.test.ts`（补一个断言）

**Interfaces:**

- Consumes: Task 4 的 `<TodoPill />`
- Produces: 浮空行 `.float-row`，内含 `[TodoPill] [回到底部按钮]`

- [ ] **Step 1: 写失败测试**

在 `webview-vue/test/components/TranscriptView.test.ts` 末尾追加一个 describe：

```ts
describe("TranscriptView floating row", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("pairs the todo capsule with the scroll-to-bottom button", () => {
    const wrapper = mount(TranscriptView, { shallow: true });

    const row = wrapper.get(".float-row");
    expect(row.find("#scroll-bottom-btn").exists()).toBe(true);
    expect(row.findComponent(TodoPill).exists()).toBe(true);
  });
});
```

（该文件顶部要 import `TodoPill from "@/components/TodoPill.vue"` —— `shallow: true` 会把它 stub，`findComponent` 按组件定义匹配，所以不必渲染内部。若该文件已有 `stubs` 配置，按现有风格调整。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @pi-agent-chat/webview-vue test -- run test/components/TranscriptView.test.ts`
Expected: FAIL — 找不到 `.float-row`

- [ ] **Step 3: 改模板**

`webview-vue/src/components/TranscriptView.vue`：script 里加 `import TodoPill from "./TodoPill.vue";`；template 末尾把那个按钮包进浮空行：

```html
<div class="float-row">
  <TodoPill />
  <button
    id="scroll-bottom-btn"
    class="scroll-bottom-btn"
    :class="{ show: !stuck }"
    type="button"
    :title="t('Scroll to bottom')"
    @click="scrollToBottom"
  >
    <span class="codicon codicon-chevron-down"></span>
  </button>
</div>
```

- [ ] **Step 4: 追加浮空行样式**

`webview-vue/src/styles/chat.css` 末尾追加：

```css
/* ── 输入区上方的浮空行：todo 胶囊 + 回到底部按钮 ─────────────────────────────
 * 按钮原来的规则是 `position:absolute; left:50%; margin-left:-15px`。进了 flex 行
 * 之后要就地中和，否则会被双重居中。 */
.float-row {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
}

.float-row .scroll-bottom-btn {
  position: static;
  left: auto;
  margin-left: 0;
}
```

- [ ] **Step 5: 跑 webview 全套 + 出效果图**

```bash
pnpm --filter @pi-agent-chat/webview-vue test
pnpm --filter @pi-agent-chat/webview-vue build:chat
```

起预览（沿用既有做法）：

```bash
# 1) 构建 + 把宿主占位符换成真实值（否则语言/主题都不生效）
pnpm --filter @pi-agent-chat/webview-vue build:chat
cd webview-vue/dist/chat && node -e '
const fs=require("fs");let s=fs.readFileSync("index.html","utf8");
const display=JSON.stringify({fontSize:14,surface:"editor",backgroundImage:"",backgroundOpacity:1,sendShortcut:"enter",runningSendBehavior:"queue",collapseWork:true,expandToolCalls:false,expandThinking:false,keepReadingAnchor:false});
const map={PI_HOME_PLACEHOLDER:"/Users/joeson",PI_SEP_PLACEHOLDER:"/",PI_WORKSPACE_PLACEHOLDER:"/Users/joeson/Documents/pi-agent-chat",PI_LANG_PLACEHOLDER:"zh-cn",PI_MERMAID_THEME_PLACEHOLDER:"default",PI_DISPLAY_PLACEHOLDER:display};
for(const [k,v] of Object.entries(map)) s=s.split(k).join(v);
fs.writeFileSync("preview.html",s); console.log("placeholders left:", /PI_[A-Z_]+_PLACEHOLDER/.test(s));'
# 2) 起服务
cd /Users/joeson/Documents/pi-agent-chat && (python3 -m http.server 8137 -d webview-vue/dist/chat >/tmp/todo-preview.log 2>&1 &)
```

再用 Playwright（MCP 的 `browser_run_code_unsafe`，或本地 playwright）跑这段：

```js
async (page) => {
  const shim = (theme) => `
    window.__sent = [];
    window.acquireVsCodeApi = () => ({
      getState: () => undefined,
      setState: () => {},
      postMessage: (m) => { window.__sent.push(m.type); setTimeout(() => {
        if (m.type === "webviewReady" || m.type === "ready")
          window.postMessage({ type: "messages", messages: [], historyAvailable: false }, "*");
      }, 0); },
    });
    addEventListener("DOMContentLoaded", () => {
      document.documentElement.dataset.piTheme = "${theme}";
      document.body.classList.add("${theme === "dark" ? "vscode-dark" : "vscode-light"}");
    });
  `;
  const items = [
    { id: "a", text: "建表并写迁移脚本", status: "completed" },
    { id: "b", text: "补 service 层单测", status: "in_progress" },
    { id: "c", text: "跑一遍真机验收", status: "pending" },
  ];
  const measured = [];
  for (const theme of ["dark", "light"]) {
    const ctx = page.context();
    await ctx.addInitScript({ content: shim(theme) });
    await page.goto("http://127.0.0.1:8137/preview.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    // 清掉启动页，然后投一份 todo widget
    await page.evaluate(() =>
      window.postMessage({ type: "messages", messages: [], historyAvailable: false }, "*"),
    );
    await page.evaluate(
      (lines) =>
        window.postMessage({ type: "widget", widgetKey: "pi-todo", widgetLines: lines }, "*"),
      [JSON.stringify({ items, updatedAt: 1 })],
    );
    await page.waitForTimeout(300);
    await page.locator(".todo-pill").hover();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/tmp/todo-pill-${theme}.png` });
    measured.push(
      await page.evaluate(() => {
        const pill = document.querySelector(".todo-pill").getBoundingClientRect();
        const row = document.querySelector(".float-row").getBoundingClientRect();
        const pop = document.querySelector(".todo-popover").getBoundingClientRect();
        const cs = getComputedStyle(document.querySelector(".todo-popover"));
        return {
          pillHeight: Math.round(pill.height),
          gap: Math.round(
            document.querySelector("#scroll-bottom-btn").getBoundingClientRect().left - pill.right,
          ),
          rowCentered: Math.abs(row.left - (innerWidth - row.right)) < 2,
          popoverGap: Math.round(pill.top - pop.bottom),
          popoverMaxHeight: cs.maxHeight,
          rowText: document.querySelector(".todo-popover").innerText.replace(/\n/g, " | "),
        };
      }),
    );
  }
  return JSON.stringify(measured, null, 1);
};
```

Expected（判读用实测值，不看缩略图）：`pillHeight: 30`、`gap: 8`、`rowCentered: true`、`popoverGap: 8`、`popoverMaxHeight: 240px`，`rowText` 里能看到三项与标题 `待办 1/3`。

两张图连同这组实测值一并发给用户（他点名要改的东西，图与落地同轮给）。

- [ ] **Step 6: 清理预览产物**

```bash
rm -f webview-vue/dist/chat/preview.html
pkill -f "http.server 8137"
```

- [ ] **Step 7: Commit（默认不执行）**

```bash
git add webview-vue/src/components/TranscriptView.vue webview-vue/src/styles/chat.css webview-vue/test/components/TranscriptView.test.ts
git commit -m "feat(chat): hang the todo capsule beside scroll-to-bottom"
```

---

### Task 6: 实机端到端验证（验收三条语义）

**Files:** 无改动（只验证；发现问题回到对应任务修）

- [ ] **Step 1: 在真 VS Code 里跑一轮**

按既有做法用隔离 profile + VSIX 启一个真宿主（或 F5 开发宿主），在新会话里让模型做一个多步任务（例如“分三步把这个文件的注释补全”），观察：

| 看什么                          | 期望                                                                       |
| ------------------------------- | -------------------------------------------------------------------------- |
| 输入区上方                      | 出现胶囊 `任务 0/3` → 随进度变成 `任务 1/3`、`任务 2/3`                    |
| 悬停胶囊                        | 展开列表（标题 `待办 1/3`、当前项转圈、完成项删除线）；移开约 0.12s 后收起 |
| 全部完成                        | 胶囊变“全部完成”，约 3s 后消失                                             |
| **点停止（abort）再继续发一条** | **胶囊仍在**，列表不变                                                     |
| **切到另一个会话**              | **胶囊消失**；切回来也不应出现（会话已重建）                               |
| 压缩上下文（`/compact`）        | 列表每一项仍在（这条是 spec §8 的兜底验证点）                              |

- [ ] **Step 2: 记录结果**

把每一步的实际情况写进 `docs/superpowers/plans/2026-09-26-panel-todo.md` 末尾的“执行记录”小节（成功写“已验”，失败写清现象 + 复现步骤）。**不要**为了让结果好看而改断言或跳过步骤；失败就如实报告。

- [ ] **Step 3: 全量回归**

```bash
pnpm run lint && pnpm run typecheck && npx vitest run && pnpm --filter @pi-agent-chat/webview-vue test
```

Expected: lint/typecheck 0 退出；webview 全绿；host 侧只剩既有的 2 个 macOS `bind.test.ts` 失败（与本改动无关）。
