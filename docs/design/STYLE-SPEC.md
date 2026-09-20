# pi-agent-chat 样式规格说明（UI Style Spec）

> 适用范围：VS Code 扩展内 Webview 运行的聊天面板与设置面板。
> 目标：**与用户当前使用的 VS Code 主题融为一体**。
>
> 上一版以「与 WorkBuddy 对话交互风格保持一致」为目标，列了整套自维护的
> Light / Dark 色值表（`--bg-page` / `--text-primary` / `--surface-hover` …）。
> 那套变量从未进入代码，而硬编码的调色板让面板在任何非默认主题下都格格不入。
> 现方案改为：**颜色全部来自 VS Code 主题**，本文件因此只规定"用哪个主题色"，
> 不再规定"是什么颜色"——色值随主题变，写死即错。

---

## 一、设计原则

1. **颜色只有一个来源：VS Code 主题。** `tokens.css` 里每个 `--pi-*` 都映射到
   `--vscode-*`，宿主会把当前主题的全部色值注入 webview。任何组件、样式表都
   不得出现硬编码色值。
2. **回退链是设计的一部分。** VS Code 并非在每套主题里都定义每个色号：
   `widget.border` 在 Dark Modern / Light Modern 下是 null，只在对比度主题里
   存在；`charts.red` / `charts.yellow` 由调色板常量算出、可能缺席。所以每个
   `--pi-*` 都要以"链尾一定存在"的色号收尾，而不是随便写个 hex。
3. **字号五档语义化。** 由 `pi-agent-chat.chatFontSize` 单一基准按比例派生，
   不再有九个数字档位和散落的硬编码 px。
4. **图标跟随 VS Code 规格且不缩放。** codicon 16 / 14 / 12 固定；字号设置
   管的是阅读，不是齿轮图标多大。
5. **双主题 = 主题自己切。** 不再有 `[data-theme="dark"]` 与手写 Dark 变量块，
   也不再有 `body.vscode-dark` 覆盖。高对比度因此免费获得。
6. **布局与几何不随本次迁移改变。** 圆角、间距、控件高度、阴影保持原值。

---

## 二、主题如何生效

| 机制             | 说明                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 色值注入         | VS Code 把当前主题的色值作为 `--vscode-<color-id>`（`.` 换成 `-`）注入 webview，无需任何代码                                                                                                   |
| 明暗判定         | VS Code 在 `<body>` 上加 `vscode-light` / `vscode-dark` / `vscode-high-contrast` / `vscode-high-contrast-light`。mermaid 主题选择读这个类                                                      |
| 停靠位置         | 宿主通过 `display.surface`（`sidebar` \| `editor`）告知面板停在哪；store 据此切 `body.pi-surface-sidebar`，`tokens.css` 据此把 `--pi-bg-page` 指到 `sideBar.background` 或 `editor.background` |
| 字体             | `--vscode-font-family` / `--vscode-font-size`（界面）、`--vscode-editor-font-family` / `--vscode-editor-font-size`（代码）由宿主注入                                                           |
| 运行中换主题     | webview 不重载。mermaid 图监听 body class 变化后重绘；其余样式靠 CSS 变量自动生效                                                                                                              |
| 无宿主的本地开发 | `webview-vue/preview/`（`pnpm --filter @pi-agent-chat/webview-vue dev` 后访问 `/preview.html`），可选 8 套内置主题与真实字号                                                                   |

---

## 三、颜色 Token（`webview-vue/src/tokens.css`）

左列是本项目变量，右列是它取的 VS Code 色号（`var()` 链，只列首要项）。

### 表面

| 变量                  | 主题色号                                             | 用途                  |
| --------------------- | ---------------------------------------------------- | --------------------- |
| `--pi-bg-page`        | `editor.background`（侧栏态走 `sideBar.background`） | 页面底                |
| `--pi-bg-raised`      | `editorWidget.background`                            | 悬浮卡片、弹层        |
| `--pi-bg-surface`     | `sideBar.background`                                 | 次级面                |
| `--pi-bg-subtle`      | `input.background`                                   | 输入框、内嵌面        |
| `--pi-bg-hover`       | `list.hoverBackground`                               | 行悬停                |
| `--pi-bg-selected`    | `list.activeSelectionBackground`                     | 选中行                |
| `--pi-bg-bubble`      | `list.inactiveSelectionBackground`                   | 用户消息气泡          |
| `--pi-bg-card`        | = `--pi-bg-bubble`                                   | 会话流唯一的「面」：气泡、引用、围栏代码、思考卡、参数卡、终端卡、问答卡 |
| `--pi-bg-control`       | `foreground` 12% 混进 `sideBar.background`           | 控制条 chip（`+`、选择器、待命的发送钮） |
| `--pi-bg-control-hover` | 同上取 20%                                     | 上述 chip 悬停                  |
| `--pi-bg-think`       | `textBlockQuote.background`                          | 思考块底              |
| `--pi-bg-code-inline` | `textPreformat.background`                           | 行内代码              |
| `--pi-code-bg`        | `textCodeBlock.background`                           | 代码块 / mermaid 画布 |
| `--pi-bg-overlay`     | 无对应色号，固定 `rgba(0,0,0,.45)`                   | 模态遮罩（主题无关）  |

### 文字与图标

| 变量                                      | 主题色号                                                | 用途           |
| ----------------------------------------- | ------------------------------------------------------- | -------------- |
| `--pi-text`                               | `foreground`                                            | 正文           |
| `--pi-text-secondary` / `--pi-text-muted` | `descriptionForeground`（缺席时取 `foreground` 的 70%） | 次要、元信息   |
| `--pi-text-faint`                         | `foreground` 的 55%                                     | 最弱信息       |
| `--pi-text-disabled`                      | `disabledForeground`                                    | 禁用           |
| `--pi-text-brand`                         | `textLink.foreground`                                   | 链接、可点文字 |
| `--pi-icon`                               | `icon.foreground`                                       | 图标默认色     |

### 状态（四态齐全，软底由主色派生）

| 语义 | 主色                       | 软底                               |
| ---- | -------------------------- | ---------------------------------- |
| 成功 | `charts.green`             | `color-mix(主色 14%, transparent)` |
| 警告 | `editorWarning.foreground` | 同上                               |
| 危险 | `errorForeground`          | 同上                               |
| 信息 | `editorInfo.foreground`    | 同上                               |

### 交互与边框

| 变量                          | 主题色号                                |
| ----------------------------- | --------------------------------------- |
| `--pi-brand` / `--pi-send-bg` | `button.background`                     |
| `--pi-brand-hover`            | `button.hoverBackground`                |
| `--pi-border`                 | `panel.border`（HC 下 `widget.border`） |
| `--pi-border-input`           | `input.border`                          |
| `--pi-border-brand`           | `focusBorder`                           |
| `--pi-danger-pill-border`     | `inputValidation.errorBorder`           |

**控制条底色为什么是派生的，不是主题色号**：`badge.background` 在多数主题里是"计数徽标/品牌色"（2026-dark 是 `#307E9F`、hc_light 是 `#0F4A85`），拿它填 chip 会整条行变成蓝绿色块；`button.secondaryBackground` 在 Dark Modern 与 2026-dark 里被定义成**全透明 `#00000000`**，直接导致"输入框为空时发送按钮像没上颜色"。两个都不能用，所以 `--pi-bg-control` 从主题的 `foreground` × `sideBar.background` 派生——仍随主题，但任何主题下都有可见的中性底。

### Diff

| 变量                                                  | 主题色号                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `--pi-code-added-bg` / `--pi-code-removed-bg`         | `diffEditor.insertedTextBackground` / `removedTextBackground` |
| `--pi-code-added-gutter` / `--pi-code-removed-gutter` | `editorGutter.addedBackground` / `deletedBackground`          |

---

## 四、字体与字号

```css
/* tokens.css —— 全部由 --chat-fs 按比例派生 */
--pi-fs-micro: calc(var(--chat-fs) * 10 / 14); /* 10px @ 14 */
--pi-fs-meta: calc(var(--chat-fs) * 12 / 14); /* 12px @ 14 */
--pi-fs-body: var(--chat-fs); /* 14px @ 14 */
--pi-fs-title: calc(var(--chat-fs) * 16 / 14); /* 16px @ 14 */
--pi-fs-display: calc(var(--chat-fs) * 18 / 14); /* 18px @ 14 */
--pi-fs-code: var(--vscode-editor-font-size, var(--pi-fs-meta));
```

| 档位      | 默认       | 用在哪                               |
| --------- | ---------- | ------------------------------------ |
| `micro`   | 10px       | 徽标、计数、gutter 元信息            |
| `meta`    | 12px       | 工具行、时间戳、次要说明             |
| `body`    | 14px       | 正文、按钮、输入                     |
| `title`   | 16px       | 轮次头、对话框标题、工具栏标题       |
| `display` | 18px       | 空态标题、markdown h1                |
| `code`    | 编辑器字号 | 代码块与行内代码（字族取编辑器字族） |

规则：

1. **新代码只准用语义档。** 不许写 `font-size: 13px` / `0.92em` 之类的字面值。
   检查手段：`node webview-vue/preview/derive-style-layer.mjs` 扫一遍，应报 0 处。
2. **数字别名是过渡物**：`--chat-fs-8…16`、`--fs-10…16` 仍然存在并吸附到五个
   语义档，供尚未改名的老规则使用。改到哪算哪，别新增。
3. 界面字族取 `--vscode-font-family`，代码字族取 `--vscode-editor-font-family`——
   用户在 VS Code 里改字体，面板跟着变。
4. 行高按用途分开：正文 1.5，元信息 1.4，标题 1.3。

---

## 五、图标

| 项   | 规格                                                                                         |
| ---- | -------------------------------------------------------------------------------------------- |
| 字体 | `@vscode/codicons`（subset，`main.ts` 注册 `@font-face`）                                    |
| 尺寸 | `--pi-icon-lg: 16px`、`--pi-icon-md: 14px`、`--pi-icon-sm: 12px`，**固定**，不随字号设置缩放 |
| 基线 | `.codicon` 统一 `line-height: 1`、`vertical-align: middle`、`flex: none`                     |
| 颜色 | `--pi-icon` / `--pi-icon-muted` / `--pi-icon-brand` / `--pi-icon-disabled`                   |
| 例外 | 品牌图形与上下文占用环是 SVG 图形，不是图标，不参与替换                                      |

---

## 六、圆角 / 间距 / 控件高度 / 阴影

沿用原设计，未改动（`tokens.css`）：

- 圆角：`--pi-r-xs 4` / `sm 6` / `md 8` / `lg 12` / `xl 16` / `full 999`
- 间距（4 基线）：4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 / 32
- 控件高度：工具栏 48、控件 32 / 36 / 28、行 40
- 阴影：`--pi-shadow-popup` / `-menu` / `-modal`

---

## 七、组件状态：用 token 组合，不列色值

色值随主题变，因此状态表只规定 token 组合。下表是唯一契约。

| 组件                     | 默认                                                                                      | 悬停                    | 选中 / 激活                                                | 禁用                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| 图标按钮                 | `--pi-icon` + 透明底                                                                      | 底 `--pi-bg-hover`      | 字 `--pi-text-brand`                                       | `--pi-icon-disabled`                                   |
| 发送按钮                 | 30×30、圆角 `--pi-r-md`、1px `--pi-border`（与上传按钮同规格），纯图标，底 `--pi-send-bg`、字 `--pi-send-fg` | 底 `--pi-send-bg-hover` | 停止态：底 `--pi-bg-control`、字 `--pi-danger`              | 底 `--pi-bg-control`、字 `--pi-text-disabled`，**不降透明度** |
| 控制条 chip（`+` / 选择器） | 30×30（pill 同高）、圆角 `--pi-r-md`、1px `--pi-border`，底 `--pi-bg-control` | 底 `--pi-bg-control-hover` | 权限为 FullAccess 时整枚走危险软底 | 字 `--pi-text-disabled`，`opacity: .4` |
| 行 / 列表项              | 透明                                                                                      | 底 `--pi-bg-hover`      | 底 `--pi-bg-selected`，字 `--pi-bg-selected-foreground`    | 字 `--pi-text-disabled`                                |
| 输入框                   | 底 `--pi-bg-subtle`，描边 `--pi-border-input`                                             | —                       | **无焦点配色变化**：获得焦点时边框仍是 `--pi-border-input` | 字 `--pi-text-disabled`                                |
| 危险操作                 | 字 / 描边 `--pi-danger`，软底 `--pi-danger-soft`                                          | 同左                    | 同左                                                       | `--pi-text-disabled`                                   |
| 状态点（成功/进行/失败） | `--pi-success` / `--pi-info` / `--pi-danger`                                              | —                       | —                                                          | `--pi-text-muted`                                      |

硬性规则：**饱和实心底上的前景一律用 `--pi-text-on-solid`**（即 `button.foreground`），
不许叠加半透明主文字色。

### 发送按钮的三个面

同一个按钮承担「发送 / 停止 / 带文案的发送」，切换条件是**输入框是否为空**，而不是会话是否在跑：

| 条件                 | 外观                                                                                        | 点击                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 空闲（没有会话在跑） | 图标 `codicon-arrow-up`；无内容时禁用                                                       | 发送                                                                               |
| 会话中 · 输入为空    | 图标 `codicon-debug-stop`，底 `--pi-bg-subtle`、字 `--pi-danger`，**不做动效**              | 停止当前轮次                                                                       |
| 会话中 · 有输入      | 图标 `codicon-arrow-up`，底 `--pi-send-bg`；投递方式写在悬停提示里（`插话：…` / `排队：…`） | 发送：插话=立即作为引导发出；排队=进入输入框上方的本地队列（可删除 / 编辑 / 引导） |

按钮上不再有独立的投递方式切换控件，按钮本身也保持纯图标（三种状态同一尺寸，控制行不会抖）：
投递方式只在悬停提示里说明。默认值在设置 `pi-agent-chat.chatRunningSendBehavior` 里改，
Alt+Enter 始终强制入队。

---

## 八、一致性清单

**新增或修改样式时：**

1. 颜色 → 只用 `--pi-*`；确实需要新色号时，先在 `tokens.css` 里加 `--vscode-*`
   映射（带回退链），不要在组件里写 `--vscode-*` 或 hex。
2. 字号 → 只用五档语义变量；跑一遍 `derive-style-layer.mjs` 确认没有字面值。
3. 图标 → 用 codicon，尺寸取 `--pi-icon-*`；需要新字形时在 `chat.css` /
   `settings.css` 的码点表里补一行。
4. 主题相关行为（如随主题重绘）→ 读 `<body>` 的 `vscode-*` 类，不要自己判断明暗。
5. 会话流的「面」只有一种 → 气泡与所有展开卡（引用、围栏代码、思考、参数、终端、
   问答）共用 `--pi-bg-card` + 正文色 + `8px 12px` 内距 + `--pi-r-lg`，收敛规则写在
   `chat.css` 末尾。**新加一张卡不要再自己挑底色**（历史上每张卡各取一种，攒出了
   5 种灰、3 种字色、3 种内距）。
6. 改完用 `webview-vue/preview/` 至少在 Dark Modern、Light Modern、Dark High
   Contrast 三套主题下看一眼。

**验收不留截图**：`docs/design/preview/` 那批渲图已删除。仓库里没有生成它们的脚本，图就会随配色一改悄悄过期，比没有更误导 —— 需要看效果时直接跑预览：

```
pnpm --filter @pi-agent-chat/webview-vue dev
# 浏览器打开 http://localhost:5173/preview.html?theme=dark_modern&lang=zh-cn
# `?surface=editor|sidebar` `?streaming=0` `?fs=20` `?bare=1` 可驱动整套矩阵
```

`docs/design/01-*.png`、`_verify-*.png` 是上一版配色时期的截图，同样已过期。
