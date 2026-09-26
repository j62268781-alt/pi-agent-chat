# 面板里的 todo（胶囊 + 悬浮窗）

- 日期：2026-09-26
- 状态：设计已确认，待写实现计划
- 相关：`43c8cc0`（删掉的自带 todo/btw 扩展）、`@juicesharp/rpiv-todo`（只作参考，不引入）

## 1. 目标

模型在执行任务时能维护一份待办列表，用户在 VS Code 面板里**随时能看到进度**：
输入区上方出现一枚胶囊（`☑ 任务 3/7`），悬停展开整份列表，离开即收。

**必须成立的语义**（用户原话归纳）：

1. 只读——模型写，人看；面板里不做勾选/删除。
2. 有未完成项才出现；全部完成短暂显示后收回；没有列表就完全不出现。
3. **取消这一轮（abort）后再继续，列表仍然可见。**
4. **压缩上下文（compaction）不影响列表里的每一项。**
5. 切到别的会话就不显示（列表只属于那个会话）；**不持久化到磁盘。**

## 2. 非目标

- 不做 TUI 渲染（终端里那行会是生 JSON；用户不用 TUI，接受）。
- 不做面板侧交互（勾选/删除/排序）。
- 不做跨会话持久化、不做 `/todos`、`/todo-clear` 之类的命令。
- 不依赖任何第三方 todo 包。

## 3. 决策记录

| 决定                                           | 理由                                                       | 依据                                              |
| ---------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| 自研 pi 扩展 + 自己的卡片                      | 不引入第三方；载荷干净（JSON，不用解 ANSI）                | 用户选定                                          |
| **状态由扩展持有（进程内）**，不从消息历史派生 | 历史派生会被 compaction 抹掉，"每一项都在"失效             | 需求 4                                            |
| 工具契约 = **全量快照**                        | 每次提交完整列表 → "最后一次 = 真值"，结构上不可能丢项     | 需求 4                                            |
| 通道 = `setWidget` + `lines[0]` 放 JSON        | 与 rewind-files 同构；host 已无条件转发                    | `chat-session.ts:840-846`、`RewindWidget.vue:2-3` |
| 清空归扩展，pi 不代劳                          | 实测：`abort`/`new_session`/`switch_session` 都不清 widget | 见 §5 实测                                        |
| 单一 widget 槽改成按 key 的 map                | 否则任何扩展清自己的 widget 会连带抹掉别人的               | `overlays.ts:42,108-115`                          |

**与被删实现的关键差异**（`43c8cc0^:pi-extensions/todo.ts`）：它把状态存在**工具结果 details**里（注释称"branch 时自动正确"），契约是**增量动作**（`action: list/add/toggle/clear` + `nextId`）。这两点都要换掉：历史派生过不了 compaction，增量动作在换会话后没有合并基准。

## 4. 架构与数据流

```
模型调用 todo 工具
   └─ pi-extensions/todo.ts
        ├─ 更新扩展内存态（当前会话）
        ├─ ctx.ui.setWidget("pi-todo", [JSON.stringify({items, updatedAt})])
        └─ 返回 { content: 摘要, details: {items, total, completed} }
                                  │
   widget ── pi stdout(JSONL) ────┘                └─ 转写稿那行（历史）
        │
   host: chat-session.ts:840  →  {type:"widget", widgetKey, widgetLines}
        │
   webview: useHostLink.ts:219 → overlays.applyWidget(key, lines)
        │
   TodoPill.vue（读 widgets["pi-todo"]）→ 胶囊 + 悬停浮层
```

两条消费者**同源**（都来自那一次工具调用）：widget 是实时态，details 是历史行。互不同步，也就不存在不一致。

## 5. 实测结论（spike，2026-09-26）

用一个 30 行探针扩展（`-e` 注入、只写文件日志）在 `pi --mode rpc` 下跑：

| 观察到                                                                                     | 结论                                           |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `session_start` 时 `setWidget("probe-todo", …)` 立刻到达客户端                             | host 转发链可用                                |
| prompt → `abort` 全程**零** widget 消息                                                    | **abort 不清 widget** → 需求 3 成立            |
| `new_session` / `switch_session` 也没有清空消息；只有扩展自己在新的 `session_start` 里重设 | **pi 不代劳清空**，清空必须由扩展做            |
| `subagent-async` 在每个生命周期被发 `undefined`                                            | 那是 pi-subagents 扩展**自己**在清（模式一致） |
| `session_start` 连发**两次**（new / resume 各两次）                                        | 清理与重设必须**幂等**                         |
| compaction 三次尝试均 `Nothing to compact (session too small)`                             | **未能实测**（见 §8）                          |

（spike 产物已删；它临时在用户会话目录留下的两个探针会话也已清掉。）

## 6. 详细设计

### 6.1 扩展与工具契约

新增：

- `pi-extensions/todo-model.ts` — 纯函数：参数校验 / 归一 / 摘要文案 / 上限截断。可单测，不依赖 pi。
- `pi-extensions/todo.ts` — pi 胶水：注册工具 + 发 widget + 生命周期处理。

工具（名字沿用被删那个）：

```ts
todo({
  items: [{ id: string; text: string; status: "pending" | "in_progress" | "completed" }]
})
```

- **`items` 是完整列表**，描述里写明"每次都必须提交完整列表"。
- **`id` 必填**、短、列表内唯一（建议 kebab-case，≤32 字符），模型跨调用保持不变。
- `items: []` 合法 = 清空。
- 返回：`content: [{type:"text", text: "待办已更新：1 进行中 · 2 待处理 · 4 已完成（共 7）"}]`
  - `details: { items, total, completed }`。
- **遵守黑名单**：与 `questionnaire` 同样读 `PI_VSCODE_DISABLED_TOOLS`（`questionnaire.ts:88-97`），命中 `todo` 时**完全不注册工具、也不发 widget**。

widget 载荷（`widgetLines[0]`）：

```json
{
  "items": [{ "id": "...", "text": "...", "status": "pending|in_progress|completed" }],
  "updatedAt": 1699999999999
}
```

- 每次成功调用后发布；`items` 为空时发 `undefined`（清空）。
- **校验失败不发布**（`status` 非法 / `text` 缺失 / `id` 重复）→ **从 `execute` 抛错**（pi 只有抛错才会把工具结果标成失败，返回值里带 `isError` 无效 —— `extensions.md:2120`），widget 不动，避免一次畸形调用把胶囊抹掉。
- `ctx.hasUI === false`（print/json 模式）→ 跳过 `setWidget`，仍返回结果。
- **列表上限 50 项**，超出截断并在摘要里写"…另有 N 项"。

### 6.2 状态与生命周期

状态 = 扩展模块内的一个变量，作用域是**当前会话运行时**（随 `session_start` 建立、随会话切换丢弃）。

| 事件                                         | 动作                                                     | 依据                        |
| -------------------------------------------- | -------------------------------------------------------- | --------------------------- |
| `session_start`（`startup`）                 | 清内存态 + `setWidget(KEY, undefined)`                   | 新进程不该带旧胶囊          |
| `session_start`（`new`/`resume`/`fork`）     | 同上                                                     | 实测：pi 不清，只有扩展能清 |
| `session_shutdown` / `session_before_switch` | 同上（双保险）                                           | 实测这两个事件在切换前发    |
| `session_compact`                            | **重设**一次 widget                                      | 兜底（见 §8）               |
| `todo` 调用                                  | 更新内存态 → 发全量 widget                               | §6.1                        |
| `abort`                                      | **什么都不做**                                           | 实测：abort 不影响 widget   |
| 全部完成                                     | 视图显示"全部完成"约 3s 后隐藏（本地计时），不动扩展状态 | 需求 2                      |

- **幂等**：`session_start` 连发两次（实测），清理/重设重复执行无害。
- **`fork`**：按新会话清空。代价：分叉不再继承历史 todo（不假装正确），与需求 5 一致。

### 6.3 webview：胶囊与浮层

- **位置（选定 A）**：新增居中浮空行 `.float-row { position:absolute; bottom:12px; left:50%; transform:translateX(-50%) }`，内含 `[TodoPill] [回到底部按钮]`，间距 8px。
  已知副作用：胶囊出现时，回到底部按钮不再是屏幕正中。
- **胶囊（内容选定 A）**：圆角胶囊 + 图标 + `任务 3/7`。照用户给的"步骤 0/5"样式。
- **浮层**：向上展开（`bottom: calc(100% + 8px)`），`max-height: 240px` 可滚；标题行 `待办 3/7` + 列表（状态图标 + 文本；已完成加删除线并降透明度；`in_progress` 复用现有纯 CSS 转圈）。
- **开合**：纯悬停。胶囊与浮层包在同一个 wrapper，绑 `mouseenter`/`mouseleave`，离开**延时约 120ms** 关闭（防止从胶囊移进浮层时闪断）。键盘 `Tab` 聚焦/失焦走同一条逻辑。
- **全部完成**：文案变"全部完成"，约 3s 后隐藏（组件本地计时）。
- **不渲染**：没有 `pi-todo` 载荷、载荷 parse 失败、列表为空。

### 6.4 widget 槽改 map

```ts
const widgets = ref<Record<string, string[]>>({});
function applyWidget(key, lines) {
  if (!key) return;
  if (!lines || lines.length === 0) {
    delete widgets.value[key];
    return;
  }
  widgets.value = { ...widgets.value, [key]: lines };
}
```

- `RewindWidget.vue` 改读 `overlays.widgets["rewind-files"]`；`TodoPill` 读 `widgets["pi-todo"]`。
- 删掉死导出 `widgetOpen`（全仓只有 store 自己用）。
- 这是**修 bug**：单槽下任何扩展发 `setWidget(k, undefined)` 会连带清掉别人的 widget。

### 6.5 落点清单

| 文件                                            | 动作                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pi-extensions/todo-model.ts`                   | 新增（纯函数）                                                                                       |
| `pi-extensions/todo.ts`                         | 新增（pi 胶水）                                                                                      |
| `src/utils/constants.ts`                        | 加 `TODO_EXTENSION_PATH`                                                                             |
| `src/services/pi/process.ts`                    | 在 `createPiShellArgs`(:89) 与 `createRpcShellArgs`(:136) 注入；顺手把这 4 条路径抽成共用常量        |
| `package.json`                                  | `pi-agent-chat.disabledTools` 的 enum 加 `"todo"`（现为 `vscode_get_diagnostics` / `questionnaire`） |
| `README.md:168`                                 | 那行 bundled tools 清单补 `todo`                                                                     |
| `webview-vue/src/stores/overlays.ts`            | widget 单槽 → map；删 `widgetOpen`                                                                   |
| `webview-vue/src/components/RewindWidget.vue`   | 改读新键                                                                                             |
| `webview-vue/src/components/TodoPill.vue`       | 新增                                                                                                 |
| `webview-vue/src/components/TranscriptView.vue` | 新增 `.float-row` 容器，放 TodoPill + 既有按钮                                                       |
| `webview-vue/src/styles/chat.css`               | `.float-row` / `.todo-pill` / `.todo-popover` 等                                                     |
| `webview-vue/src/locales/chat.zh-cn.json`       | 新增文案（待办 / 全部完成 / …）                                                                      |

### 6.6 测试

| 文件                                               | 覆盖                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `test/unit/pi-extensions/todo-model.test.ts`       | 校验 / 归一 / 摘要文案 / 50 项截断                                                                           |
| `webview-vue/test/stores/overlays.test.ts`         | 两个 key 并存；清 A 不影响 B；清空即删键                                                                     |
| `webview-vue/test/components/TodoPill.test.ts`     | 无载荷不渲染；有载荷 → `3/7`；hover → 浮层；离开+计时 → 关闭；全完成 → "全部完成" + 3s 后隐藏（fake timers） |
| `webview-vue/test/components/RewindWidget.test.ts` | 补一个最小的（改 store 会碰它，现无测试）                                                                    |

不做：pi 扩展的集成测试（questionnaire / permission-gate 同样没有）；TUI 渲染。

## 7. 已知取舍

1. 契约靠提示词，**没有运行时校验**——模型漏项无法检测（没有基准可比）；但泄漏会直接出现在卡片里，用户看得见。
2. `id` 必填增加模型负担；换来列表项身份稳定。
3. 位置 A 会让回到底部按钮在胶囊出现时偏离正中。
4. 列表上限 50，超出截断。
5. `fork` 出去的会话不继承 todo。

## 8. 待验证（实现期解决）

**compaction 是否清 widget 未实测**（三次都因 "session too small" 失败：小会话、调低 `compaction.keepRecentTokens` 的沙箱、三个回合的会话）。不阻塞，因为：

1. 机制上压缩只重写 message 条目，widget 是 UI 态；
2. 实测里**唯一**见过的清空都是扩展自己发的；

3. 兜底是 3 行：`session_compact` 时重设一次（探针已证明 `session_compact` / `session_compact_failed` 是活事件）。

实现时按"不依赖 pi 行为"来做（`session_compact` 重设写进去）；若日后真出现压缩后胶囊消失，那是兜底失效，可再查。
