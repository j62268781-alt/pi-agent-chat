# Pi Agent Studio — UI 重构设计方案

> ⚠️ **已作废，别照做（2026-09-20 起）。** 这份方案的前提是 TDesign 自有调色板 +
> 手写 light/dark 两套，而实际方向已经改成**颜色与几何全部跟随 VS Code 主题**
> （见 `STYLE-SPEC.md`）。文中的 `--td-*` 令牌、14px 正文、TDesign 圆角与配色表
> 都没有进过代码或已被替换；保留它只为了留下"为什么放弃品牌化"的判断过程。
> 唯一仍然有效的是 §三 的范式结论（agent 输出不套气泡）与各处功能清单。

> 目标：解决现有 Webview 界面「视觉风格不佳、信息层级混乱」的问题，重做**对话内容展示区**与 **Agents 设置界面**，并给出一套可落地的设计规范与组件实现映射。
>
> 设计体系：**TDesign（腾讯企业级设计体系）· Dark 主题**
> 交付物：`01-chat-transcript.png`（对话界面）、`02-agents-settings.png`（Agents 设置界面）

---

## 一、现状架构分析

`pi-agent-studio` 是运行在 VS Code Webview 中的 Agent 对话界面，本质是**双进程（宿主 + 渲染器）**架构：

| 层                    | 位置                                                                  | 职责                                                                                                             |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **宿主进程（Node）**  | `src/`                                                                | 扩展生命周期、会话管理、RPC 分发、设置读写                                                                       |
| ├ 会话入口            | `src/extension.ts`                                                    | 注册 Webview、命令、视图；`pi-agent-studio.ui` 决定承载位置                                                      |
| ├ 对话会话            | `src/chat/chat-session.ts`                                            | 启动/托管 `pi` 子进程，转发 `get_state` / 事件流；`mcpOpen` 直通 `/mcp status`                                   |
| ├ 设置面板            | `src/settings/settings-panel.ts`                                      | `buildTabData("agents")` → `listAgents()`；处理 `createAgent/updateAgent/deleteAgent/resetBuiltin/openAgentFile` |
| ├ 设置注入            | `src/settings/settings-webview.ts`                                    | 向 `settings-dist.html` 注入 `chatFontSize` / `lang`                                                             |
| └ MCP                 | `src/mcp/mcp-config.ts`                                               | 读写 `~/.agents/mcp.json` / `<folder>/.mcp.json`（外部 `pi-mcp-adapter`）                                        |
| **渲染器（Webview）** | `pi-chat/`、`pi-settings/`                                            | 纯前端 SPA，通过 `vscode.postMessage` / `onDidReceiveMessage` 与宿主通信                                         |
| ├ 对话渲染            | `pi-chat/src/main.ts`、`composer.ts`、`messages.ts`、`style.css`      | 消息渲染、输入器、状态栏                                                                                         |
| └ 设置渲染            | `pi-settings/src/main.ts`、`tabs/agents.ts`、`tabs/*.ts`、`style.css` | 单页设置：models/agents/prompts/skills/mcp/commit/sysprompt/settings                                             |

**关键约束（来自 fork 现状，直接影响 UI）**

1. `disabledTools.default = ["subagent"]`：内置 `subagent` 被禁用，`subagent` 工具由外部 **`pi-subagents`** 提供 → UI 必须能渲染 pi-subagents 的结果结构。
2. `pi-chat/src/messages.ts` 已做兼容：`isFailedSubagent()` 需额外识别 `error / interrupted / timedOut`；`renderAgentBody()` 读取 `r.errorMessage || r.error`。**设计上必须把「子代理失败/中断/超时」作为一等状态可视化**，否则错误会静默。
3. UI 承载位置默认为 **sidebar（≈300px 宽）**，因此对话区必须**窄容器优先**设计，不能依赖宽屏双栏。
4. `bridge/agents/` 已失效（指向 `agents.retired`），Agents 列表真实来源只有 **project / user** 两级 → 设置界面的来源标签只保留这两类 + 外部包。

---

## 二、现状问题诊断

| 区域       | 问题                                               | 影响                                                                                                                               |
| ---------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **对话区** | 早期方案给整段对话套 IM 气泡（左右分栏、圆角气泡） | **范式错误（限 agent 输出）** —— Agent 对话不是人与人聊天，气泡割裂了代码块 / 工具调用 / 推理的连续阅读流；用户轮不受此限，见 §5.1 |
|            | 工具调用、子代理、推理过程**无结构化呈现**         | 用户无法快速判断「Agent 做了什么、卡在哪」                                                                                         |
|            | 代码块、工具结果、推理同一字重/色阶                | 信息层级扁平，长会话无法扫读                                                                                                       |
|            | 输入器控件在 300px 侧栏被媒体查询隐藏              | 主 UI（sidebar）下模型/思考/权限选择器**不可见**                                                                                   |
| **设置区** | Agents 以「列表 ⇄ 全屏表单」toggle 切换            | 改一个 Agent 要整屏跳转，无法边看列表边改                                                                                          |
|            | `builtin` 来源标签与实际来源不符                   | 误导用户（fork 中 built-in 已失效）                                                                                                |
|            | 无搜索 / 无来源筛选                                | Agent 一多就找不到                                                                                                                 |

---

## 三、设计目标与原则

1. **转写稿（transcript）而非聊天**：agent 输出左对齐、单列阅读流，像「终端 + 文档」的混合体，而非 IM；用户轮右对齐（见 §5.1）。
2. **过程可读**：把 Agent 的每一步（读/改/跑/搜/推理/子代理）变成**结构化时间线**，而非一段纯文本。
3. **状态即颜色语义**：运行中 / 成功 / 失败 / 中断 / 超时 有固定色，且不依赖颜色单一表达（配图标 + 文本）。
4. **窄容器优先**：以 300–470px 为第一适配目标，宽屏为增强项。
5. **Token 驱动**：颜色/字号/间距/圆角全部映射 TDesign 语义 Token，禁止散落硬编码色值。

---

## 四、设计 Token 体系（TDesign · Dark）

### 4.1 颜色（语义映射）

| 用途      | TDesign Token                  | Dark 值                 | 本项目用法                                              |
| --------- | ------------------------------ | ----------------------- | ------------------------------------------------------- |
| 页面底    | `--td-bg-color-page`           | `#181818`               | 对话/设置画布底（实现取 `#171A1F` 微调冷调）            |
| 容器/面板 | `--td-bg-color-container`      | `#242424`               | 工具栏、设置侧栏、详情面板                              |
| 组件底    | `--td-bg-color-component`      | `#393939`               | 悬挂卡片、输入控件（实现用更深的 `#101318` 以拉开对比） |
| 主文字    | `--td-text-color-primary`      | `rgba(255,255,255,90%)` | 正文、标题                                              |
| 次要文字  | `--td-text-color-secondary`    | `rgba(255,255,255,55%)` | 副标题、元信息                                          |
| 占位/说明 | `--td-text-color-placeholder`  | `rgba(255,255,255,35%)` | 占位符、分组标签                                        |
| 反色文字  | `--td-text-color-anti`         | `#fff`                  | **彩色实心底上的文字（硬性规则）**                      |
| 品牌      | `--td-brand-color`（=brand-8） | `#4582E6`               | 主按钮、选中态、链接（实现取 `#4C8DFF`）                |
| 成功      | `--td-success-color`           | `#059465`               | 工具成功、通过                                          |
| 告警      | `--td-warning-color`           | `#CF6E2D`               | 工具运行中 / 编辑类操作                                 |
| 错误      | `--td-error-color`             | `#C64751`               | 失败 / 超时                                             |
| 推理      | 自定义（紫）                   | `#B392F0`               | Reasoning 折叠块专属色                                  |
| 子代理    | 自定义（青）                   | `#4EC9B0`               | 子代理线程专属色                                        |
| 边框      | `--td-component-border`        | `#5E5E5E`               | 输入框描边                                              |
| 分割      | `--td-component-stroke`        | `#393939`               | 时间线分隔、日期分割线                                  |

> **硬性规则**：任何**饱和实心底**（品牌/成功/告警/错误）上的文字与图标前景，一律用 `--td-text-color-anti`（`#fff`），禁止用 `--td-text-color-primary/secondary` 叠加。Avatar 缩写字同规则。

### 4.2 字体与字号

| 角色              | Token                             | 值                                               |
| ----------------- | --------------------------------- | ------------------------------------------------ |
| 界面字族          | `--td-font-family`                | `PingFang SC, Microsoft YaHei, Inter, Arial`     |
| 代码字族          | —                                 | `JetBrains Mono / SF Mono / Consolas, monospace` |
| 正文              | `--td-font-size-body-medium`      | 14px                                             |
| 次要/元信息       | `--td-font-size-body-small`       | 12px                                             |
| 标题（面板/轮次） | `--td-font-size-title-large`      | 18px                                             |
| 页面标题          | `--td-font-size-title-extraLarge` | 20px                                             |

行高遵循 `line-height ≈ font-size + 8`（正文 14 → 22；代码 13 → 20）。

### 4.3 间距与圆角

- **8px 栅格**：间距取 4 / 8 / 12 / 16 / 24；轮次纵向间距 16，时间线行距 8。
- **圆角**：`--td-radius-default` 3px（输入/小控件）、`--td-radius-medium` 6px（卡片/按钮）、`--td-radius-extraLarge` 12px（浮层）、`--td-radius-round` 999px（筛选 chip）。

---

## 五、对话界面重构（核心）

### 5.1 范式：从「IM 气泡」到「Agent 转写稿」

**废弃**：头像 + 气泡尾巴；给 **agent 输出**套气泡 —— 那会割裂代码块 / 工具调用 / 推理的连续阅读流。
**采用**：agent 输出走单列、左对齐、全宽阅读列；**用户轮单独右对齐**，以气泡呈现，宽度随内容增长、上限为整列宽。**每一轮 = 一条带 gutter 的记录**。

> **2026-09-19 修订**：本条款原先一刀切地「废弃按发送方对齐」。实测下来，用户轮贴左会让「我说了什么」和「agent 做了什么」在视觉上同级，长会话里很难找回自己的输入。禁令因此收窄为**只约束 agent 输出**。
>
> 同期另改两处，下面的 ASCII 图按此理解：① 过程折叠**不再套卡片、不再画竖轨**（图中的 `│` 竖轨、「紫色弱卡片」等表述只描述层级，不描述边框），只留缩进与展开箭头；② **最终回答默认全展开** —— 原 360px 截断 + 「展开/收起」开关已移除，被截掉的恰好是承载结论的最后一段。

```
┌─ 顶部工具栏：π 标识 · 会话标题 · 操作（菜单/新建/重载/设置）
│
├─ 日期分割线（Today · 14:02）           —— 弱色居中，「会话阶段」锚点
│
├─ ▸ 用户轮（User turn）                                        ⟶ 右对齐
│     ▏指令正文（气泡，宽度随内容，上限为整列）    ⧉ · 14:02
│
├─ ▸ 助手轮（Assistant turn）
│     [π] Pi · Claude Sonnet 4 · 14:02      ⧉ ↻ ⌄（hover 才出现的操作条）
│     │  ## 标题
│     │  正文段落
│     │  ┌ 代码块（深底、行内高亮、右上角复制）
│     │  └
│     │
│     │  ● read  · src/bridge/endpoint.ts · 12ms     ← 工具活动时间线（带竖轨）
│     │  ● edit  · src/bridge/endpoint.ts · 8ms   （下方展开 Diff 卡片，见 §5.5）
│     │  ● bash  · npm test            ✓ passed
│     │
│     │  ◆ Reasoning（可折叠，紫色弱卡片）
│     │    先定位 endpoint.ts 的副作用，再决定纯函数边界。
│     │
│     └ ● explore · Searching config  ⟨running⟩     ← 子代理嵌套线程（青色轨）
│
└─ 输入器（Composer）
      [给 Pi 发消息…]                    （多行自适应，min-height 40px）
      [Claude Sonnet 4 ▾] [thinking: medium ▾] [⛨ Smart]        [＋] [➤]
```

### 5.2 组件拆解

| 组件                         | 说明                                                                       | 设计要点                                                                     |
| ---------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **轮次头（Turn header）**    | 头像 28px + 名 + 模型 + 时间                                               | 用户轮用中性底色头像，助手轮用品牌色 π；模型名次要色                         |
| **hover 操作条**             | ⧉ 复制 ↻ 重试 ⌄ 折叠                                                       | 默认隐藏，hover 轮次时淡入；避免常驻噪声                                     |
| **正文排版**                 | 标题 / 段落 / 列表 / 引用                                                  | 阅读列宽 = 容器 − 32；代码与正文区分字族                                     |
| **代码块**                   | 深底 `#0B0E13`、圆角 8、可滚动                                             | 关键字高亮；右上角复制按钮；语言徽标                                         |
| **工具活动时间线**           | 每行：状态点 + 工具名 + 参数摘要 + 耗时/结果                               | 左侧 2px 竖轨串联；状态色语义（见 4.1）；失败/超时用错误色 + 图标            |
| **Reasoning 折叠块**         | 紫色弱底卡片，默认折叠为一行                                               | 展开显示完整思考；与正文用色/底区分                                          |
| **子代理线程**               | 缩进 + 青色轨，显示 `agent · 任务 状态`                                    | 嵌套深度最多 2 层；`error/timedOut/interrupted` 映射为对应状态色             |
| **代码修改对比（Diff）卡片** | `edit`/`write`/`patch` 工具行下方内联展开：`文件名 +N −M` 头 + 红/绿增删行 | 深底 `#101218`、圆角 8、1px 边框；默认展开，折叠态保留 `+N −M` 摘要；见 §5.5 |
| **流式指示**                 | 三点打字动画 + 当前动作文本                                                | 放在轮次尾部；结束后替换为最终内容                                           |
| **日期/阶段分割线**          | 居中弱色胶囊                                                               | 长会话锚点                                                                   |

### 5.3 输入器与选择器（修复 300px 侧栏不可见问题）

- 输入区：`min-height` 40px，自适应增高（`autoGrow()` 与 CSS `min-height` **必须同步**，见 AGENTS.md §6）。
- 控件条：`[模型 ▾] [thinking ▾] [权限 ⛨]` 三个 chip + 附件 `＋` + 发送 `➤`。
- **关键修复**：移除 `@media (max-width:640px/420px)` 的隐藏规则，改为 `min-width:0; flex-shrink:1`，让 chip 自行省略号截断（AGENTS.md §5）。
- **模型选择器浮层**（见 `01-chat-transcript.png` 下方独立组件）：分组（Anthropic / OpenAI / Google）+ 搜索框 + 选中态（品牌淡底 + 勾选）；`--td-shadow-2` 投影，圆角 12。

### 5.4 状态语义（映射 `messages.ts` 兼容逻辑）

| 状态        | 色             | 表达                              |
| ----------- | -------------- | --------------------------------- |
| running     | 告警橙         | 动画点 + 「running」              |
| success     | 成功绿         | 实心点 + ✓ + 结果摘要             |
| failed      | 错误红         | 实心点 + ✕ + `error/errorMessage` |
| interrupted | 错误红(降饱和) | 「已中断」                        |
| timedOut    | 错误红(降饱和) | 「超时」                          |

### 5.5 代码修改对比（Diff）渲染

**触发条件**：工具类型为 `edit` / `write` / `patch` 且产生代码增删时，对应工具行下方**必须**内联展开 Diff 卡片——禁止只显示「✓ Nms」单行状态。这是用户明确要求的修正：「如果是修改代码块的话要有修改对比的效果那才对的」。

**结构（mockup 节点 `2:304` · `Diff Card · edit`）**

| 层       | 设计                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 卡片容器 | 深底 `#101218`、圆角 8、1px 边框 `#2E3340`、`fill_container` 宽；位于工具列内、对应工具行正下方，与工具行共享左侧竖轨                                  |
| 头部     | 文件名（JetBrains Mono 12，次要色 `#9BA1AB`）左对齐；右侧 `+N −M` 统计：`+` 用成功绿 `#3FB950`、`−` 用错误红 `#F85149`，Medium 字重                    |
| 代码区   | 等宽 12px（JetBrains Mono）；删除行红字 `#F85149` + 红色弱底（`#F85149` @ 12%）；新增行绿字 `#3FB950` + 绿色弱底（`#3FB950` @ 12%）；行首 `+`/`−` 前缀 |

**统计一致性**：`+N −M` 与渲染行数严格一致（本项目示例 `+5 −2` = 5 新增 / 2 删除）。`+` 或 `−` 行数为 0 时隐藏对应数字。

**状态语义与色阶**：Diff 的绿/红取**代码深底可读优先**的 GitHub-dark 风格（`#3FB950` / `#F85149`），而非 4.1 的 TDesign 默认 success/error（`#059465` / `#C64751`）——前者在 `#101218` 上对比更稳，可视为 `--td-success-color` / `--td-error-color` 的「代码面衍生 token」。

**折叠**：mockup 展示态默认展开；真实实现可折叠，折叠态保留 `+N −M` 统计作为一行摘要，点击展开完整 diff。

**理由**：Agent 改代码是高风险动作，单行「✓ 8ms」无法让用户判断「到底改了什么」。内联 diff 让用户**不离开对话即可 review**，直接对齐 WorkBuddy 自身对话流（用户参照截图）的既定范式。

---

## 六、Agents 设置界面重构

### 6.1 范式：从「列表 ⇄ 全屏表单」到「主从（Master–Detail）」

左侧固定 360px 列表 + 右侧 480px 详情/编辑，**同屏完成选择与编辑**，避免跳转。

### 6.2 结构

```
┌ 页面头：Agents 标题 · [搜索 agents…] · [＋ New Agent]
│ 作用域筛选： (All) User Project Built-in        ← round chip，选中为品牌淡底
├───────────────┬─────────────────────────────────
│ Agent 列表     │ 详情 / 编辑面板
│ ● explore     │  [ex] explore      [Edit][Reset]
│   User · CS4  │       User agent · pi-subagents
│ ● general     │  ───────────────────────────────
│   User · GPT5 │  Name      [ explore                 ]
│ ● code-review │  Description [ 多行文本 ]
│   Project·Opus│  Model     [ Claude Sonnet 4      ▾ ]
│ ● doc-writer  │  System Prompt [ 大文本域 ]
│   Built-in    │  Tools     [ read, grep, find, ls, bash ]
│               │  ☐ Disable model invocation
│               │  [Cancel]              [Save Changes]
└───────────────┴─────────────────────────────────
```

### 6.3 列表行（item-row）

- 32px 头像（按 name 哈希取品牌色系，缩写字前景固定 `--td-text-color-anti`）。
- 主行：Agent 名（14 SemiBold）；副行：`来源 · 模型`（12 次要色，**单行省略**）。
- 右侧 `›` 指示；选中行 = 品牌淡底（`--td-brand-color-8` @ 16%）。
- 行宽 `fill_container`（**不是** hug）——否则副行会折行、`›` 不靠右。

### 6.4 详情表单字段（映射 `pi-settings/src/tabs/agents.ts`）

| 字段                     | 控件                       | 数据键                   |
| ------------------------ | -------------------------- | ------------------------ |
| Name                     | 单行输入                   | `name`                   |
| Description              | 多行输入                   | `description`            |
| Model                    | 下拉（复用模型选择器）     | `model`                  |
| System Prompt            | 大文本域（≥120px，可滚动） | `systemPrompt`           |
| Tools                    | 输入 / chip 列表           | `tools`                  |
| Disable model invocation | 勾选框                     | `disableModelInvocation` |

底部操作：`Cancel`（幽灵按钮）+ `Save Changes`（品牌实心，前景 `--td-text-color-anti`）。
头部操作：`Edit` / `Reset`（幽灵小按钮，对应 `openAgentFile` / `resetBuiltin`）。

### 6.5 来源标签语义（修正 fork 现状）

| 标签      | 含义                        | 说明                                                |
| --------- | --------------------------- | --------------------------------------------------- |
| `User`    | `~/.pi/agent/agents/`       | pi-subagents 原生定义（explore/general 的真实来源） |
| `Project` | `<workspace>/.pi/agent(s)/` | 项目级覆盖                                          |
| `Package` | 外部包提供                  | 如 pi-subagents 自带                                |

> **删除 `Built-in` 语义的误导**：fork 中 `bridge/agents/` 已失效，设置面板不应再把它标为「内置」。建议在 `settings-panel.ts` 移除 builtin 源，或仅在 `agents.retired` 不存在时隐藏。

---

## 七、交互与状态规范

| 场景       | 规范                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| 轮次 hover | 操作条淡入（opacity 0→1，120ms），移出淡出                              |
| 折叠/展开  | Reasoning、工具时间线、子代理线程均可折叠；折叠态保留一行摘要           |
| 键盘       | `chatSendShortcut` 支持 enter / ctrlEnter；列表 ↑↓ 切换、Enter 打开详情 |
| 空状态     | 列表空 → 引导「＋ New Agent」；详情空 → 占位说明                        |
| 加载       | 骨架行（列表）/ 按钮 loading（保存）                                    |
| 无障碍     | 状态不只靠颜色（点 + 图标 + 文本）；焦点环可见；对比度 ≥ 4.5:1          |
| 窄容器     | < 640px 时设置页 nav 收起为图标栏；对话区控件条压缩不隐藏               |

---

## 八、组件 → 代码落点映射

| 设计组件              | 建议实现位置                                                                     |
| --------------------- | -------------------------------------------------------------------------------- |
| 对话轮次容器 / 转写稿 | `pi-chat/src/messages.ts`（重构 `renderAgentBody`/`isFailedSubagent` 的渲染层）  |
| 工具活动时间线        | `pi-chat/src/messages.ts` + `style.css` 新增 `.tool-timeline` / `.tool-row`      |
| Reasoning 折叠块      | `pi-chat/src/messages.ts` + `.reasoning-block`                                   |
| 子代理嵌套线程        | `pi-chat/src/messages.ts`（消费 `details.results[]`）+ `.subagent-thread`        |
| 输入器 / 选择器       | `pi-chat/src/composer.ts`（chip 组、模型浮层）                                   |
| 对话 Token            | `pi-chat/src/style.css` 的 `:root` 变量层                                        |
| 设置主从布局          | `pi-settings/src/main.ts` + `pi-settings/src/tabs/agents.ts`                     |
| Agent 行 / 详情表单   | `pi-settings/src/tabs/agents.ts`（`item-row` / `editor-card` 改造）+ `style.css` |
| 来源标签              | `src/settings/settings-panel.ts` `listAgents()` 返回值语义收敛                   |

---

## 九、落地路径（建议顺序）

1. **Token 层**：在 `pi-chat` 与 `pi-settings` 的 `style.css` 建立 `--td-*` 变量映射，统一现有散色值。
2. **对话区**：先替换消息渲染为转写稿结构（轮次头 → 正文 → 代码块），再接工具时间线 / 推理 / 子代理三级组件。
3. **输入器**：修复窄侧栏控件隐藏，接入模型浮层。
4. **设置区**：`agents.ts` 改主从布局，补搜索/筛选；`settings-panel.ts` 收敛来源语义。
5. **回归**：`chatFontSize`、`chatSendShortcut`、`chatMermaidTheme` 等既有设置项需在新样式下验证。

---

_本方案基于对 `src/`、`pi-chat/`、`pi-settings/` 实际源码的通读，遵循 TDesign Dark 语义 Token；配套效果图见同目录两张 PNG。_
