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
2. **几何也只有一个来源：VS Code 的尺寸令牌。** 宿主下发的 `styles` 里除了
   颜色，还有一整张**尺寸令牌表**（`getWebviewThemeData()` 把颜色注册表与尺寸
   注册表合并），因此 `--vscode-cornerRadius-*`、`--vscode-spacing-size*`、
   `--vscode-codiconFontSize*`、`--vscode-strokeThickness` 在 webview 里可直接
   读。圆角、间距、图标尺寸、描边宽度一律走它们，组件样式表里不许再出现
   `border-radius: 12px` 这类字面值。
3. **回退链是设计的一部分。** VS Code 并非在每套主题里都定义每个色号：
   `widget.border` 在 Dark Modern / Light Modern 下是 null，只在对比度主题里
   存在；`charts.red` / `charts.yellow` 由调色板常量算出、可能缺席。尺寸令牌
   同理——较老的宿主整个不发。所以每个 `--pi-*` 都要以"链尾一定存在"的值收尾
   （尺寸令牌用 VS Code 1.138 的现值兜底，老宿主与纯浏览器预览因此长得一样）。
4. **字号五档语义化。** 由 `pi-agent-chat.chatFontSize` 单一基准按比例派生
   （默认 13，即 VS Code 自己的界面字号），不再有九个数字档位和散落的硬编码 px。
5. **图标跟随 VS Code 规格且不缩放。** codicon 16（chrome）/ 12（chat 输入区
   compact）两档固定；字号设置管的是阅读，不是齿轮图标多大。
6. **双主题 = 主题自己切。** 不再有 `[data-theme="dark"]` 与手写 Dark 变量块，
   也不再有 `body.vscode-dark` 覆盖。高对比度因此免费获得。
7. **唯一不跟宿主的是控件高度。** `--pi-h-*`（工具栏 48、控件 32/36/28、行 40）
   是面板的布局骨架，动它等于重做布局；chat 输入区原本照抄 VS Code 的 22px 行
   （`--chat-input-control-height`），**现在比它高一档到 26px**——22px 的控件配 13px
   标签，整排读起来都像小字（彬哥 2026-09-21），它现在是自己的一档。

---

## 二、主题如何生效

| 机制             | 说明                                                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 色值注入         | VS Code 把当前主题的色值作为 `--vscode-<color-id>`（`.` 换成 `-`）注入 webview，无需任何代码                                                                                                                |
| 尺寸令牌注入     | 同一份 `styles` 里还有尺寸令牌（`cornerRadius.*`、`spacing.size*`、`codiconFontSize`、`strokeThickness`…），同样 `--vscode-*`。宿主侧由 `getWebviewThemeData()` 合并颜色与尺寸两张注册表得出                |
| 明暗判定         | VS Code 在 `<body>` 上加 `vscode-light` / `vscode-dark` / `vscode-high-contrast` / `vscode-high-contrast-light`。mermaid 主题选择读这个类                                                                   |
| 停靠位置         | 宿主通过 `display.surface`（`sidebar` \| `editor`）告知面板停在哪；store 据此切 `body.pi-surface-sidebar`，`tokens.css` 据此把 `--pi-bg-page` 指到 `sideBar.background` 或 `editor.background`              |
| 字体             | `--vscode-font-family` / `--vscode-font-size`（界面）、`--vscode-editor-font-family` / `--vscode-editor-font-size`（代码）由宿主注入                                                                        |
| 运行中换主题     | webview 不重载。mermaid 图监听 body class 变化后重绘；其余样式靠 CSS 变量自动生效                                                                                                                           |
| 无宿主的本地开发 | `webview-vue/preview/`（`pnpm --filter @pi-agent-chat/webview-vue dev`）：聊天页 `/preview.html`、设置页 `/preview/settings.html`（假宿主回灌 `init`/`tabData`），可选 8 套内置主题、真实字号与真实尺寸令牌 |

---

## 三、颜色 Token（`webview-vue/src/tokens.css`）

左列是本项目变量，右列是它取的 VS Code 色号（`var()` 链，只列首要项）。

### 表面

| 变量                                    | 主题色号                                             | 用途                                                               |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| `--pi-bg-page`                          | `editor.background`（侧栏态走 `sideBar.background`） | 页面底                                                             |
| `--pi-bg-raised`                        | `editorWidget.background`                            | 悬浮卡片、弹层                                                     |
| `--pi-bg-surface`                       | `sideBar.background`                                 | 次级面                                                             |
| `--pi-bg-subtle`                        | `input.background`                                   | 输入框、内嵌面                                                     |
| `--pi-bg-hover`                         | `list.hoverBackground`                               | 行悬停                                                             |
| `--pi-bg-selected`                      | `list.activeSelectionBackground`                     | 选中行                                                             |
| `--pi-bg-bubble` / `--pi-border-bubble` | `chat.requestBackground` / `chat.requestBorder`      | 发送方气泡（唯一不作卡片的「面」，见下）                           |
| `--pi-bg-card`                          | `list.inactiveSelectionBackground`                   | 会话流唯一的「面」：引用、围栏代码、思考卡、参数卡、终端卡、问答卡 |
| `--pi-bg-control`                       | `foreground` 12% 混进 `sideBar.background`           | 控制条 chip（`+`、选择器、待命的发送钮）                           |
| `--pi-bg-control-hover`                 | 同上取 20%                                           | 上述 chip 悬停                                                     |
| `--pi-bg-think`                         | `textBlockQuote.background`                          | 思考块底                                                           |
| `--pi-bg-code-inline`                   | `textPreformat.background`                           | 行内代码                                                           |
| `--pi-code-bg`                          | `textCodeBlock.background`                           | 代码块 / mermaid 画布                                              |
| `--pi-bg-overlay`                       | 无对应色号，固定 `rgba(0,0,0,.45)`                   | 模态遮罩（主题无关）                                               |

### 文字与图标

| 变量                                      | 主题色号                                                                      | 用途           |
| ----------------------------------------- | ----------------------------------------------------------------------------- | -------------- |
| `--pi-text`                               | `foreground`                                                                  | 正文           |
| `--pi-text-secondary` / `--pi-text-muted` | `foreground` 的 70%（VS Code 注册表公式，不取主题的 `descriptionForeground`） | 次要、元信息   |
| `--pi-text-faint`                         | `foreground` 的 55%                                                           | 最弱信息       |
| `--pi-text-disabled`                      | `disabledForeground`                                                          | 禁用           |
| `--pi-text-brand`                         | `textLink.foreground`                                                         | 链接、可点文字 |
| `--pi-icon`                               | `icon.foreground`                                                             | 图标默认色     |

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
/* tokens.css —— 全部由 --chat-fs 按比例派生；比例取 VS Code chat 自己的字阶 */
--pi-fs-micro: calc(var(--chat-fs) * 10 / 13); /* 10px @ 13 = label3 */
--pi-fs-meta: calc(var(--chat-fs) * 12 / 13); /* 12px @ 13 = body-s */
--pi-fs-body: var(--chat-fs); /* 13px @ 13 = body-m */
--pi-fs-title: calc(var(--chat-fs) * 16 / 13); /* 16px @ 13 = body-xl */
--pi-fs-display: calc(var(--chat-fs) * 20 / 13); /* 20px @ 13 = body-xxl */
--pi-fs-code: var(--vscode-editor-font-size, var(--pi-fs-meta));
```

比例抄的是 VS Code chat 面板自己的字号阶梯（`--vscode-chat-font-size-body-*`，一套
以 13px 界面字号为基准的 em 阶梯：`.846 / .923 / 1 / 1.077 / 1.231 / 1.538`），
所以正文字号与 VS Code 的对话正文一致。markdown 的 h2/h3 也落在它的档上
（16 = body-xl，正文 = body-m）。

| 档位      | 默认       | 用在哪                               |
| --------- | ---------- | ------------------------------------ |
| `micro`   | 10px       | 徽标、计数、gutter 元信息            |
| `meta`    | 12px       | 工具行、时间戳、次要说明             |
| `body`    | 13px       | 正文、按钮、输入                     |
| `title`   | 16px       | 轮次头、对话框标题、工具栏标题       |
| `display` | 20px       | 空态标题、markdown h1                |
| `code`    | 编辑器字号 | 代码块与行内代码（字族取编辑器字族） |

规则：

1. **新代码只准用语义档。** 不许写 `font-size: 13px` / `0.92em` 之类的字面值。
   检查手段：`node webview-vue/preview/derive-style-layer.mjs` 扫一遍，应报 0 处。
2. **数字别名已经删掉了。** `--chat-fs-8…16`、`--fs-10…16` 曾是九档压五档的过渡层，
   所有调用点已改成语义档、定义随之删除；`--fs`（设置面板基准）与 `--chat-fs`
   （聊天基准）保留，由宿主注入。
3. 界面字族取 `--vscode-font-family`，代码字族取 `--vscode-editor-font-family`——
   用户在 VS Code 里改字体，面板跟着变。
4. 行高按用途分开：正文 1.5，元信息 1.4，标题 1.3。

### 基础层：三条重置，且只从 normalize.css 取两行

两份样式表（聊天 / 设置）各自带一层基础重置，两边都必须有这三条：`* { box-sizing: border-box }`、
`html, body` 的 `margin/padding: 0`、以及**表单控件的字体继承**——`button, input, optgroup,
select, textarea { font-family: inherit; font-size: 100% }`。

第三条不是装饰：Chromium 会给裸 `button` 一个它自己的 `13.3333px Arial`，不写它，凡是没有显式
设字体的控件都会以另一种字族、另一号字出现（实测聊天面板 28 个控件里 25 个中招，`.queue-action`
的「引导」还带中文，走的是 Arial 的 CJK 回落）。

**不引 normalize.css 这个包**：它的前提是"一份样式要在多个引擎里一致"，而 webview 只跑 VS Code
的 Chromium；它的 `line-height: 1.15` 与 `margin: 0` 会把本面板手工钉住的基线（药丸的 `text-box`
cap 带、26px 控件行）重新推一遍，`summary { display: list-item }` 还会碰工作折叠与压缩分隔线的
`<details>`。契约在 `test/styles/base-layer.test.ts`。

### 设置面板的文字层级（照 VS Code 自己的设置编辑器）

VS Code 设置编辑器的做法是：**标签 = 界面字号 + 600 字重 + 实色**，只有描述是弱化的
（`foreground` 90%）。本面板此前正好相反（标签 12px@70%、描述 10px@70%），所以读起来
"处处偏小"。现在的阶梯：

| 元素                                               | 档           | 字重 / 墨色                 | VS Code 对应                     |
| -------------------------------------------------- | ------------ | --------------------------- | -------------------------------- |
| 折叠组头 `.cfg-group-header`                       | `title` 16px | 600 / `--pi-text`           | 组标题 18/22/26 + 600            |
| 设置标签 `.field-label` / `.check-label`           | `body` 13px  | 600 / `--pi-text`           | `.setting-item-label`            |
| 说明 `.cfg-desc` / `.item-desc` / `.hint` / `.dim` | `meta` 12px  | 400 / `--pi-text-secondary` | `.setting-item-description`      |
| 错误 / 警告条 `.error` / `.msg-warn`               | `body` 13px  | —                           | 校验消息 13px                    |
| 徽标 `.badge`                                      | `micro` 10px | —                           | `modern-ui` 的 `fontSize-label3` |
| 表单小标题 `.form-section-title`                   | `body` 13px  | 600 / `--pi-text-secondary` | —                                |

节奏：一个组内两条设置之间的间距只由 `.cfg-field` 的下边距负责（标签不再加上边距），
末行的下边距归零，由 `.cfg-group-body` 的内距收尾——之前两层叠加，组头下面会空出 32px。

### 左侧导航：分组 + 组头

`stores/settings.ts` 的 `tabDescriptors()` 是**顺序与分组的唯一来源**：每项带
`group`，`SettingsPage.vue` 把相邻同组的项折成一个 `.nav-group` 小节。顺序是
**常规 → 设置**（两个配置页在前）→ 模型 / Agents / 提示词模板 / Skills / MCP 服务器
→ 提交消息 / 系统提示词；组头 12px、`--pi-text-faint`、不可点（VS Code 的 pane 标题同理）。
新增标签只要写 `group`，漏写会破坏 `test/stores/settings.test.ts` 的连续性断言。
头部那枚刷新钮**贴着标题放**（`gap: --pi-sp-1`），不用 `space-between` 推到侧栏右缘
——侧栏只有 240px，推过去就是 126px 的空档。

---

## 五、图标

| 项   | 规格                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| 字体 | `@vscode/codicons`（subset，`lib/codicon-font.ts` 注册 `@font-face`，两个入口共用）                               |
| 尺寸 | `--pi-icon-lg: 16px`、`--pi-icon-sm: 12px`（取宿主的 `codiconFontSize` / `-compact`），**固定**，不随字号设置缩放 |
| 基线 | `.codicon` 统一 `line-height: 1`、`vertical-align: middle`、`flex: none`                                          |
| 颜色 | `--pi-icon` / `--pi-icon-muted` / `--pi-icon-brand` / `--pi-icon-disabled`                                        |
| 例外 | 品牌图形与上下文占用环是 SVG 图形，不是图标，不参与替换                                                           |
| 例外 | 压缩分割线（`正在压缩` / `已完成压缩`）是**纯文字标签**夹在两条细线之间，不带字形                                 |

---

## 六、圆角 / 间距 / 控件高度 / 阴影

圆角与间距是**宿主尺度的投影**，不是自选数字。左列是本项目变量，中列是它取的
尺寸令牌（`tokens.css`），右列是 VS Code 1.138 的现值（也是链尾兜底值）。

| 变量                                    | 尺寸令牌                                      | 现值                |
| --------------------------------------- | --------------------------------------------- | ------------------- |
| `--pi-r-xs` / `sm` / `md` / `lg` / `xl` | `cornerRadius.xSmall…xLarge`                  | 2 / 4 / 6 / 8 / 12  |
| `--pi-r-full`                           | `cornerRadius.circle`                         | 9999                |
| `--pi-sp-1` / `-2` / `-3` / `-4` / `-5` | `spacing.size40…size120`                      | 4 / 6 / 8 / 10 / 12 |
| `--pi-sp-7`…`-10`                       | `spacing.size160…size320`                     | 16 / 20 / 24 / 32   |
| `--pi-stroke`                           | `strokeThickness`                             | 1px                 |
| `--pi-icon-lg` / `sm`                   | `codiconFontSize` / `codiconFontSize.compact` | 16 / 12             |

角色分工（沿用原设计，只是值整体跟着宿主缩了一档）：卡片与弹层 `lg`、控件 `md`、
小片 `sm`、徽标 `xs`、正圆 `full`。

- **间距的 14px 那一档取消了**：VS Code 的间距梯子没有 14。编号是稳定 id 不是序号，
  所以留空不重排。
- 图标只有这两档，**面板里画字形的地方一律用 16**（设置行、两个弹窗的列表、控制条都在内）。
  控制条试过自己小一档（`--pi-icon-md` = 14px），代价是那条规则必须点名它的四个控件——两个
  弹窗在 DOM 里就挂在控制条内部，用后代选择器会把弹窗里的图标一起压小；两种尺寸摆在一起比较后
  取了 16（彬哥 2026-09-21），token 与规则一起删掉。
- 控件高度仍是自己的：工具栏 48、控件 32 / 36 / 28、行 40。**chat 输入区也归到
  自己这边**：`--pi-h-chat-control` = 26px，比宿主的 22px 输入行高一档，见下。
- 阴影：`--pi-shadow-popup` / `-menu` / `-modal`（主题无关，沿用原值）。

### 聊天输入区：跟 VS Code 的输入区一致（高度除外）

VS Code 把它自己的 chat 输入区写死了规格。跟它的部分：

| 项         | 值                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 输入容器   | 圆角 `--pi-r-lg`（`cornerRadius-large`）                                                                                                                                      |
| 控件行     | 高 `--pi-h-chat-control` = **26px**（自己的一档，比宿主的 22px 输入行高一档）                                                                                                 |
| 纯图标控件 | `+` 与发送钮都是 **26×26 圆角方**（`--pi-r-md`，和药丸同一个圆角），不是 VS Code 的正圆——这一排本来一直是圆角方，token 那一遍误改成了圆                                       |
| 字形       | **16px**——和设置行、两个弹窗的列表同一档（`.icon-btn .codicon` 同时定字号与盒宽高）。控制条不比别处小；它一度用过 14px 自己一档，两种尺寸并排比较后取了 16（彬哥 2026-09-21） |
| 占用环     | 框 28px（数字要放进环孔），**外径仍是 26px**——`r 11.75 + stroke 2.5`（28 的 viewBox），跟同排圆钮对齐；环内是 10px 的整数读数，`%` 只在 `aria-label` 与悬停卡                 |

**故意不跟的三处**（都是本面板已有的契约，见 `test/styles/control-bar.test.ts`）：
输入容器底色走 `--pi-bg-raised`（要给用户自定义背景图留透明度通道），不是 VS Code 的
`input.background`；描边用 `--pi-stroke` + `--pi-border`；`+` 与发送钮都保留一圈细
描边和填充——VS Code 的提交钮是无边框实心圆，但我们的空态发送钮一旦没描边就读不出
是个按钮（Dark Modern 的 `button.secondaryBackground` 是全透明）。

容器与输入框之间那条分隔细线也是本面板自己的决定，VS Code 没有。

**整排控件只认控制条自己的 `gap`**：宽时 `--pi-sp-3`（8px），≤300px 收成 1px——每一对
控件都走同一个值，任何控件都不自带边距（那枚发送钮在窄档一度多要 5px）。余量全部交给占用环
的 `margin-left: auto`：它曾由一个空 flex 项顶位，满行时那项 4px 的下限把环推到离权限药丸
20px（两个 gap 加下限），而别的对只有 8px（彬哥 2026-09-22：间距以第一个按钮右侧为准）。

**悬停卡照 VS Code 的 hover 卡**（`#ctx-tooltip`）：13px / `line-height: 1.5` / `4px 8px`
内边距 / `min-width: 200px`，即宿主 `.monaco-hover.workbench-hover` 与
`chat-context-usage-details` 的那组值；每行 label 与 value 由 `space-between` 分开。旧版
是一张 10px、用空格把列对出来的 `pre` 卡——比例字体里本来就对不齐，而 10px 在药丸旁边小一档。
回合的用量明细卡（`.usage-popup`，状态行那枚 chip 点开）与它**共用同一组选择器**：加第三处读数
就加进那组，别抄第二份。

**回合的结论写头上，明细留底下**：折叠头一行放「结论 · 耗时2分25秒」（跑时是「正在执行中 ·
耗时1分17秒」——耗时在两种状态下都带单位词，光一个 `5s` 得让人猜那是什么数），
状态行**只有三枚同尺寸图标加时间**：`复制结论 · 用量明细 · fork · 时间`（彬哥 2026-09-22
定的顺序与内容），耗时不在底部出现。没有折叠头的回合（关掉折叠、或本来没有 work）底行
形状不变，只有「失败」词会回落到行首——否则那个回合一个字都不提它失败过。
三枚图标同为 `.icon-btn.status-action`（20px 盒、16px 字形），明细那枚多一个 `.usage-action`
用于选中与「点开着」态；用量卡（`.usage-popup`）是点开它的那张明细。

**pi 的两个提问盖在输入框上，不压暗面板**（彬哥 2026-09-22）：权限门的 `ui.select` 与
问卷扩展的 `editor`（`prefill` 是表单定义）都由 composer 上的 ask 卡回答，其余请求仍走居中
模态。`.ask-dock` 钉在 `--pi-composer-pad` 上，所以卡的左右与下沿和 `.composer-box` 完全重合
（420px 宽实测：两者同为 `x=8 / width=404 / 下沿 712`），比输入框高时向上长；卡起来时
`.composer-box` 挂 `inert`（不吃焦点也不接鼠标），队列让位不画。**不压暗**是有意的：问的多半
是"要不要放行这条命令"，答的时候上面的正文得看得见。

皮照参考图：一行一个编号圆点 + 粗体选项 + 灰色说明 + 行尾 12px 箭头；选项与说明是**同一条
文本流**（两个 flex 栏各让一半，会把「还原掉」挤成一行一个字）。允许/拒绝只染圆点（成功色 /
危险色），行内正文保持中性——"放行"不该是看起来最默认的那一行。正文是 pi 自己的事实块
（`tool : bash` / `input : {...}`），一律等宽块。末行是自填（铅笔圆点 + `自己写…`）加推进钮，
推进钮与输入框那颗 send 同一组 token；末页它的 `title` 变「提交」。整卡 `max-height: 60vh`
卡内滚动。两种卡都有标题行右侧的 ✕：问卷的 ✕（和 `Esc`）是取消，**权限的 ✕ 与 `Esc` 都是拒绝**
（彬哥 2026-09-22）——回给 pi 的值取它自己那条拒绝项（`No`，`No, provide reason` 会再开一轮
追问所以不取），措辞里找不到拒绝项时按位置取最后一条；权限提示没有"不作答"这个状态，
所以不落成 `cancelled`。

**环里为什么没有 `%`**：10px 下量过——`100%` 宽 24.4px，环孔只有 21px；`100` 是
16.2px。所以孔里只放整数，单位交给 `aria-label`（`上下文用量 100%`）和悬停卡首行。

**读数被 `min(--pi-fs-micro, 10px)` 封顶**：环是固定 28px 的盒子，而 `--pi-fs-micro`
跟着 `chatFontSize` 缩放——`chatFontSize: 18` 时那一档是 13.8px，`100` 量到 22.4px，
数字会压到环的描边上。10px 是"任何字号下都放得下"的上限。

**字形盒要跟字号同尺寸**：`.icon-btn .codicon` 同时定字号与盒宽高（都是 16px），所以在控制条里
**不要去改它的字号**——只压字号会把行盒贴在盒的顶边，`+` 与发送箭头实测比控件中心高 1.5–2px
（而权限药丸的锁没被那条规则写过，正好居中）。要么一起改，要么别改；这一排现在选了别改。

**药丸标签按 cap 带居中**：单行文字用 flex 居中时，居中到的是**行盒**，可见墨迹会低约 2px
（Segoe UI 上行 1.079em / 下行 0.251em，上方留白远多于下方）。所以标签用
`text-box: trim-both cap alphabetic` 把盒截到 cap → 基线，让 cap 带落在控件中心上；再给
`--pi-sp-1` 上下内边距，替 g/p 的下伸部留位置——截线盒子正好停在基线上，而标签自己是
`overflow: hidden`（省略号），不留余量会把字尾切掉。内边距左右对称，不会挪动 cap 带。
（`text-box` 需 Chromium 133+；更老的宿主保持原对齐。）

（已知：字号设到 18 时，控制条那排 26px 药丸里的 18px 文字也会偏挤。控件高度是固定
骨架——宿主的 `--chat-input-control-height` 同样是固定 px——所以没跟着字号缩放。）

---

## 七、组件状态：用 token 组合，不列色值

色值随主题变，因此状态表只规定 token 组合。下表是唯一契约。

| 组件                     | 默认                                                                                                                       | 悬停                       | 选中 / 激活                                                | 禁用                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| 图标按钮                 | `--pi-icon` + 透明底                                                                                                       | 底 `--pi-bg-hover`         | 字 `--pi-text-brand`                                       | `--pi-icon-disabled`                                          |
| 发送按钮                 | 26×26 圆角方（`--pi-r-md`）、`--pi-stroke` `--pi-border`（与上传按钮同规格），纯图标，底 `--pi-send-bg`、字 `--pi-send-fg` | 底 `--pi-send-bg-hover`    | 停止态：底 `--pi-bg-control`、字 `--pi-danger`             | 底 `--pi-bg-control`、字 `--pi-text-disabled`，**不降透明度** |
| 控制条 chip（`+`）       | 26×26 圆角方（`--pi-r-md`）、`--pi-stroke` `--pi-border`，底 `--pi-bg-control`                                             | 底 `--pi-bg-control-hover` | —                                                          | 字 `--pi-text-disabled`，`opacity: .4`                        |
| 控制条 pill（选择器）    | 高 26px、圆角 `--pi-r-md`、`--pi-stroke` `--pi-border`，底 `--pi-bg-control`                                               | 底 `--pi-bg-control-hover` | 权限为 FullAccess 时整枚走危险软底                         | 字 `--pi-text-disabled`，`opacity: .4`                        |
| 行 / 列表项              | 透明                                                                                                                       | 底 `--pi-bg-hover`         | 底 `--pi-bg-selected`，字 `--pi-bg-selected-foreground`    | 字 `--pi-text-disabled`                                       |
| 输入框                   | 底 `--pi-bg-subtle`，描边 `--pi-border-input`                                                                              | —                          | **无焦点配色变化**：获得焦点时边框仍是 `--pi-border-input` | 字 `--pi-text-disabled`                                       |
| 危险操作                 | 字 / 描边 `--pi-danger`，软底 `--pi-danger-soft`                                                                           | 同左                       | 同左                                                       | `--pi-text-disabled`                                          |
| 状态点（成功/进行/失败） | `--pi-success` / `--pi-info` / `--pi-danger`                                                                               | —                          | —                                                          | `--pi-text-muted`                                             |

硬性规则：**饱和实心底上的前景一律用 `--pi-text-on-solid`**（即 `button.foreground`），
不许叠加半透明主文字色。

### 发送按钮的三个面

同一个按钮承担「发送 / 停止 / 带文案的发送」，切换条件是**输入框是否为空**，而不是会话是否在跑：

| 条件                 | 外观                                                                                        | 点击                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 空闲（没有会话在跑） | 图标 `codicon-arrow-up`；无内容时禁用                                                       | 发送                                                                               |
| 会话中 · 输入为空    | 图标 `codicon-debug-stop`，底 `--pi-bg-subtle`、字 `--pi-danger`，**不做动效**              | 停止当前轮次                                                                       |
| 会话中 · 有输入      | 图标 `codicon-arrow-up`，底 `--pi-send-bg`；投递方式写在悬停提示里（`引导：…` / `排队：…`） | 发送：引导=立即作为引导发出；排队=进入输入框上方的本地队列（可删除 / 编辑 / 引导） |

按钮上不再有独立的投递方式切换控件，按钮本身也保持纯图标（三种状态同一尺寸，控制行不会抖）：
投递方式只在悬停提示里说明。默认值在设置 `pi-agent-chat.chatRunningSendBehavior` 里改，
Alt+Enter 始终强制入队。

---

## 八、一致性清单

**新增或修改样式时：**

1. 颜色 → 只用 `--pi-*`；确实需要新色号时，先在 `tokens.css` 里加 `--vscode-*`
   映射（带回退链），不要在组件里写 `--vscode-*` 或 hex。
2. 字号 → 只用五档语义变量；跑一遍 `derive-style-layer.mjs` 确认没有字面值。
3. 圆角 / 间距 / 描边 → 只用 `--pi-r-*` / `--pi-sp-*` / `--pi-stroke`，不要写字面
   px（`50%` 和 `0` 除外，那是形状不是档位）。两张组件样式表都受此约束，契约测试：
   `webview-vue/test/styles/design-tokens.test.ts`（聊天）与
   `settings-typography.test.ts`（设置）会拦住回归。
4. 图标 → 用 codicon，尺寸取 `--pi-icon-*`；需要新字形时在 `chat.css` /
   `settings.css` 的码点表里补一行。
5. 主题相关行为（如随主题重绘）→ 读 `<body>` 的 `vscode-*` 类，不要自己判断明暗。
6. 会话流的「面」只有一种 → 所有展开卡（引用、围栏代码、思考、参数、终端、问答）
   共用 `--pi-bg-card` + 正文色 + `8px 12px` 内距 + `--pi-r-lg`，收敛规则写在
   `chat.css` 末尾。**新加一张卡不要再自己挑底色**（历史上每张卡各取一种，攒出了
   5 种灰、3 种字色、3 种内距）。唯一例外是**发送方气泡**：它不是卡片而是「请求」，
   取 VS Code 自己的 `chat.request*`（底 = 页面色 62% + 一圈细描边）。这样它的文字
   对比度反而更高（Dark Modern 7.4→10.3、Light 9.0→11.2），也不会读成「列表选中行」
   —— 卡片底那个色号的语义正是「失焦的选中行」。
7. 改完用 `webview-vue/preview/` 至少在 Dark Modern、Light Modern、Dark High
   Contrast 三套主题下看一眼 —— 聊天页与设置页各一张（设置页现在也有预览装置了）。

**验收不留截图**：`docs/design/preview/` 那批渲图已删除。仓库里没有生成它们的脚本，图就会随配色一改悄悄过期，比没有更误导 —— 需要看效果时直接跑预览：

```
pnpm --filter @pi-agent-chat/webview-vue dev
# 聊天页：http://localhost:5173/preview.html?theme=dark_modern&lang=zh-cn
#   `?surface=editor|sidebar` `?streaming=0` `?fs=20` `?bare=1` 可驱动整套矩阵
#   `?ask=permission|questionnaire` 把 pi 的两种提问挂到 composer 的 ask 卡上
# 设置页：http://localhost:5173/preview/settings.html?theme=dark_modern&lang=zh-cn&tab=settings
#   假宿主在 preview/settings-host.ts，数据是 preview/settings-fixtures.ts
```

`docs/design/01-*.png`、`_verify-*.png` 是上一版配色时期的截图，同样已过期。
