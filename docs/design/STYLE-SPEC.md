# pi-agent-studio 样式规格说明（UI Style Spec）

> 适用范围：VS Code 扩展内 Webview 运行的 Agent 对话程序。
> 目标：与 WorkBuddy 对话交互风格保持一致，统一 Light / Dark 双主题。

---

## 一、设计原则

1. **统一风格**：所有界面共用同一套设计 Token（颜色、字体、圆角、间距），不随页面各写一套样式。
2. **双主题共用 Token**：Light 与 Dark 仅切换同一组变量的取值，页面结构、组件层级、状态逻辑完全不变。
3. **规范先行**：先定义 Token，再画页面；任何新组件必须先落在已有 Token 上，禁止在组件内硬编码颜色/字号。

---

## 二、如何使用（主题切换）

在 `:root` 定义 Light 变量，用 `[data-theme="dark"]` 覆盖 Dark 变量。切换主题时**只给根元素加 `data-theme` 属性**，无需改任何组件代码：

```css
:root {
  --bg-page: #ffffff;
  /* ...其余 Light 变量见下文 */
}

[data-theme="dark"] {
  --bg-page: #1e1e24;
  /* ...其余 Dark 变量见下文 */
}
```

```js
// 切换主题示例
document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
```

---

## 三、颜色 Token（CSS 变量块）

### Light — `:root`

```css
:root {
  /* 底色 / 表面 */
  --bg-page: #ffffff;
  --surface: #ffffff;
  --surface-hover: #f2f3f5;
  --surface-elevated: #f7f7f9;

  /* 描边 */
  --border: #e5e7eb;
  --border-strong: #d0d3d9;

  /* 文字 */
  --text-primary: #1f2329;
  --text-secondary: #6b7280;
  --text-meta: #9aa0a6;
  --text-disabled: rgba(31, 35, 41, 0.25);

  /* 品牌 / 选中 */
  --brand: #0052d9;
  --selected-bg: #eaf2ff;

  /* 警示 / 通过 */
  --danger: #d14343;
  --danger-bg: #fef2f2;

  /* 图标（双主题相同） */
  --icon-secondary: #8a9099;

  /* 发送按钮专用 */
  --send-bg: #111418;
  --send-icon: #ffffff;
  --send-bg-hover: #2b2f36;
  --send-bg-disabled: #f2f3f5;
  --send-icon-disabled: #c9cdd4;

  /* Plus 按钮专用 */
  --plus-bg: #f2f3f5;
  --plus-bg-hover: #e5e7eb;

  /* Approve 胶囊专用 */
  --approve-border: #f2b8b5;

  /* 条目悬停专用 */
  --item-hover: #f5f6f7;
}
```

### Dark — `[data-theme="dark"]`

```css
[data-theme="dark"] {
  /* 底色 / 表面 */
  --bg-page: #1e1e24;
  --surface: #26262e;
  --surface-hover: #2a2a31;
  --surface-elevated: #26262e;

  /* 描边 */
  --border: #2c2c34;
  --border-strong: #34343c;

  /* 文字 */
  --text-primary: #e7eaf0;
  --text-secondary: #9aa0a6;
  --text-meta: #6b727f;
  --text-disabled: rgba(231, 234, 240, 0.25);

  /* 品牌 / 选中 */
  --brand: #5b8ff9;
  --selected-bg: #16243a;

  /* 警示 / 通过 */
  --danger: #f0796f;
  --danger-bg: #3a1e1e;

  /* 图标（双主题相同） */
  --icon-secondary: #8a9099;

  /* 发送按钮专用 */
  --send-bg: #e6e7ea;
  --send-icon: #1e1e24;
  --send-bg-hover: #ffffff;
  --send-bg-disabled: #2a2a31;
  --send-icon-disabled: #6b7280;

  /* Plus 按钮专用 */
  --plus-bg: #2a2a31;
  --plus-bg-hover: #34343c;

  /* Approve 胶囊专用 */
  --approve-border: #6b2e2e;

  /* 条目悬停专用 */
  --item-hover: #26262e;
}
```

---

## 四、字体 Token

```css
:root {
  --font-ui: "Sarasa Gothic SC", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  /* 字号 */
  --text-xs: 12px;
  --text-sm: 13px;
  --text-md: 14px;
  --text-lg: 18px;

  /* 字重 */
  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;

  /* 行高 */
  --line-height-title: 1.4;
  --line-height-body: 1.5;
  --line-height-input: 24px;
}
```

| 变量                  | 取值                                      | 用途                      |
| --------------------- | ----------------------------------------- | ------------------------- |
| `--font-ui`           | "Sarasa Gothic SC", system-ui, sans-serif | 界面主字体                |
| `--font-mono`         | "JetBrains Mono", ui-monospace, monospace | 代码 / 等宽文本           |
| `--text-xs`           | 12px                                      | 副行、分组标签、来源 chip |
| `--text-sm`           | 13px                                      | 较小正文                  |
| `--text-md`           | 14px                                      | 默认正文、标题            |
| `--text-lg`           | 18px                                      | 大标题                    |
| `--weight-regular`    | 400                                       | Regular                   |
| `--weight-medium`     | 500                                       | Medium                    |
| `--weight-semibold`   | 600                                       | SemiBold                  |
| `--line-height-title` | 1.4                                       | 标题行高                  |
| `--line-height-body`  | 1.5                                       | 正文行高                  |
| `--line-height-input` | 24px                                      | 输入框行高                |

---

## 五、圆角 Token

```css
:root {
  --radius-sm: 6px; /* 图标按钮 */
  --radius-md: 8px; /* 胶囊 / 输入 / 色卡 */
  --radius-lg: 12px; /* 浮层 / 卡片 */
  --radius-xl: 16px; /* 输入区 / 外框 */
  --radius-round: 18px; /* 发送按钮圆形（或 50%） */
}
```

| 变量             | 取值        | 用途               |
| ---------------- | ----------- | ------------------ |
| `--radius-sm`    | 6px         | 图标按钮           |
| `--radius-md`    | 8px         | 胶囊 / 输入 / 色卡 |
| `--radius-lg`    | 12px        | 浮层 / 卡片        |
| `--radius-xl`    | 16px        | 输入区 / 外框      |
| `--radius-round` | 18px 或 50% | 发送按钮圆形       |

---

## 六、间距 Token（以 4 为基线）

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
}
```

| 变量        | 取值 | 用途          |
| ----------- | ---- | ------------- |
| `--space-1` | 4px  | 最小间距      |
| `--space-2` | 8px  | 组内小间距    |
| `--space-3` | 12px | 中等间距      |
| `--space-4` | 16px | 常规间距      |
| `--space-6` | 24px | 大间距 / 段落 |
| `--space-8` | 32px | 外边距 / 区块 |

---

## 七、组件状态表

> 列含义：状态 | 背景 | 描边 | 文字 | 图标
> 「—」表示不适用；颜色取值按前面 Token 映射（Light / Dark 以 `/` 分隔）。

### 1) 顶部面板 Top Bar

布局：高 52px，左右 padding 24 / 16，标题左、操作右，`SPACE_BETWEEN` 两端对齐。
会话标题：14px SemiBold，色 `--text-primary`，左对齐。

**图标按钮（History / More）** — hit 28×28，图标 20px，圆角 `--radius-sm`

| 状态 | 背景                                 | 描边 | 文字 | 图标                                |
| ---- | ------------------------------------ | ---- | ---- | ----------------------------------- |
| 默认 | 透明                                 | 无   | —    | #8A9099（--icon-secondary）         |
| 悬停 | #F2F3F5 / #2A2A31（--surface-hover） | 无   | —    | #1F2329 / #E7EAF0（--text-primary） |
| 选中 | #EAF2FF / #16243A（--selected-bg）   | 无   | —    | #0052D9 / #5B8FF9（--brand）        |
| 禁用 | 透明                                 | 无   | —    | rgba(text,0.25)（--text-disabled）  |

### 2) 输入区 Composer

容器：bg `--surface`，border `--border`，radius `--radius-xl` 16，padding 14 / 16，轻微投影。
输入框占位：15px，行高 `--line-height-input` 24，色 `--text-meta`。
分割线：1px `--border`，宽 fill。
控制条：横向 `SPACE_BETWEEN`，左组 = Plus + Model/Think/Approve 胶囊，右组 = 发送按钮，gap `--space-2` 8。

**Plus 按钮（30×30，圆角 --radius-md）**

| 状态 | 背景                                 | 描边 | 文字 | 图标                                |
| ---- | ------------------------------------ | ---- | ---- | ----------------------------------- |
| 默认 | #F2F3F5 / #2A2A31（--plus-bg）       | 无   | —    | #1F2329 / #E7EAF0（--text-primary） |
| 悬停 | #E5E7EB / #34343C（--plus-bg-hover） | 无   | —    | #1F2329 / #E7EAF0（--text-primary） |
| 禁用 | 透明                                 | 无   | —    | rgba(text,0.25)（--text-disabled）  |

**胶囊 Pill（Model / Think，radius 8，padding 6 / 10 / 12）**

| 状态 | 背景                                    | 描边                                 | 文字                                | 图标                                  |
| ---- | --------------------------------------- | ------------------------------------ | ----------------------------------- | ------------------------------------- |
| 默认 | #F7F7F9 / #26262E（--surface-elevated） | #E5E7EB / #34343C（--border）        | #1F2329 / #E7EAF0（--text-primary） | #6B7280 / #9AA0A6（--text-secondary） |
| 悬停 | #F7F7F9 / #26262E（--surface-elevated） | #D0D3D9 / #34343C（--border-strong） | #1F2329 / #E7EAF0（--text-primary） | #6B7280 / #9AA0A6（--text-secondary） |
| 选中 | #EAF2FF / #16243A（--selected-bg）      | #0052D9 / #5B8FF9（--brand）         | #1F2329 / #E7EAF0（--text-primary） | #6B7280 / #9AA0A6（--text-secondary） |
| 禁用 | #F7F7F9 / #26262E（--surface-elevated） | #E5E7EB / #34343C（--border）        | rgba(text,0.25)（--text-disabled）  | rgba(text,0.25)（--text-disabled）    |

**Approve 胶囊**

| 状态 | 背景                               | 描边                                  | 文字                               | 图标                               |
| ---- | ---------------------------------- | ------------------------------------- | ---------------------------------- | ---------------------------------- |
| 默认 | #FEF2F2 / #3A1E1E（--danger-bg）   | #F2B8B5 / #6B2E2E（--approve-border） | #D14343 / #F0796F（--danger）      | #D14343 / #F0796F（--danger）      |
| 悬停 | #FEF2F2 / #3A1E1E（--danger-bg）   | #D0D3D9 / #34343C（--border-strong）  | #D14343 / #F0796F（--danger）      | #D14343 / #F0796F（--danger）      |
| 选中 | #EAF2FF / #16243A（--selected-bg） | #0052D9 / #5B8FF9（--brand）          | #D14343 / #F0796F（--danger）      | #D14343 / #F0796F（--danger）      |
| 禁用 | #FEF2F2 / #3A1E1E（--danger-bg）   | #F2B8B5 / #6B2E2E（--approve-border） | rgba(text,0.25)（--text-disabled） | rgba(text,0.25)（--text-disabled） |

**发送按钮（36×36 圆形，radius 18）**

| 状态 | 背景                                    | 描边                         | 文字 | 图标                                      |
| ---- | --------------------------------------- | ---------------------------- | ---- | ----------------------------------------- |
| 默认 | #111418 / #E6E7EA（--send-bg）          | 无                           | —    | #FFFFFF / #1E1E24（--send-icon）          |
| 悬停 | #2B2F36 / #FFFFFF（--send-bg-hover）    | 无                           | —    | #FFFFFF / #1E1E24（--send-icon）          |
| 按下 | #2B2F36 / #FFFFFF（--send-bg-hover）    | 无（transform: scale(0.96)） | —    | #FFFFFF / #1E1E24（--send-icon）          |
| 禁用 | #F2F3F5 / #2A2A31（--send-bg-disabled） | 无                           | —    | #C9CDD4 / #6B7280（--send-icon-disabled） |

### 3) 设置侧边栏（主从布局，左侧列表 360）

分组标签：12px SemiBold，色 `--text-meta`，字距 0.5，左 padding 12，上 24 / 下 8，例 "AGENTS"。
条目：行高 44，radius 8，gap 12，左 padding 12。

- 图标：32×32 圆角 8 实底色头像，或 18 图标。
- 名称：14px Medium，--text-primary。
- 副行：12px，--text-meta，内容 "source · model"。
- 来源 chip：小胶囊，11px，"User"/"Project"，bg `--surface-hover`，色 `--text-secondary`，radius 6，padding 2 / 8。
- 分组层级：Group（标签）→ Item（图标+名称+副行）→ 可选 Sub-item（缩进 12、16 图标）；组间 1px `--border` 分割线。

**条目 Item**

| 状态 | 背景                                                        | 描边 | 文字                                                                            | 图标                                  |
| ---- | ----------------------------------------------------------- | ---- | ------------------------------------------------------------------------------- | ------------------------------------- |
| 默认 | 透明                                                        | 无   | 名称 #1F2329 / #E7EAF0（--text-primary）；副行 #9AA0A6 / #6B727F（--text-meta） | 头像实底色 / 18 图标 --text-secondary |
| 悬停 | #F5F6F7 / #26262E（--item-hover）                           | 无   | 同默认                                                                          | 同默认                                |
| 选中 | #EAF2FF / #16243A（--selected-bg），左侧 2px --brand 强调条 | 无   | 名称 #1F2329 / #E7EAF0（--text-primary）Medium                                  | 同默认                                |

### 4) 模型选择浮层 Model Picker

遮罩 scrim：黑色 0.45（Light）/ 0.6（Dark）覆盖所在区域。
浮层 modal：宽 460，bg `--surface`，border `--border`，radius 12，投影，padding 20，gap 16，居中。
头部：标题 16 SemiBold（左）+ 关闭（28×28，radius 6，悬停 bg `--surface-hover`，图标 #6B7280 / --text-secondary）。
搜索框：满宽，高 36，radius 8，bg `--surface-hover`，border `--border`，占位 `--text-meta`。
分组标签：12px SemiBold `--text-meta`，gap 4。

**选项 Option（36 高，radius 8，padding 12）**

| 状态 | 背景                                 | 描边 | 文字                                | 图标                              |
| ---- | ------------------------------------ | ---- | ----------------------------------- | --------------------------------- |
| 默认 | 透明                                 | 无   | #1F2329 / #E7EAF0（--text-primary） | —                                 |
| 悬停 | #F2F3F5 / #2A2A31（--surface-hover） | 无   | #1F2329 / #E7EAF0（--text-primary） | —                                 |
| 选中 | #EAF2FF / #16243A（--selected-bg）   | 无   | #0052D9 / #5B8FF9（--brand）        | 勾选 #0052D9 / #5B8FF9（--brand） |

**关闭按钮（28×28，radius 6）**

| 状态 | 背景                                 | 描边 | 文字 | 图标                                  |
| ---- | ------------------------------------ | ---- | ---- | ------------------------------------- |
| 默认 | 透明                                 | 无   | —    | #6B7280 / #9AA0A6（--text-secondary） |
| 悬停 | #F2F3F5 / #2A2A31（--surface-hover） | 无   | —    | #6B7280 / #9AA0A6（--text-secondary） |

---

## 八、一致性清单

### 共用 Token 的位置

- **底色**：页面用 `--bg-page`，卡片/输入/浮层用 `--surface`，悬停统一 `--surface-hover`，胶囊默认底用 `--surface-elevated`。
- **描边**：默认 `--border`，悬停/强调用 `--border-strong`（Approve 用 `--approve-border`）。
- **文字三档**：`--text-primary` / `--text-secondary` / `--text-meta`，禁用统一 `--text-disabled`，不另行取值。
- **品牌与选中**：所有选中态底统一 `--selected-bg`，强调色统一 `--brand`，左侧强调条、勾选、选中描边复用同一值。
- **警示**：Approve 与 danger 前景统一 `--danger`，底统一 `--danger-bg`。
- **次级图标**：`--icon-secondary: #8A9099` 双主题不变。
- **圆角/间距**：所有组件圆角取自 `--radius-*`、间距取自 `--space-*`，禁止散写数值。
- **字体**：字号取自 `--text-*`、字重取自 `--weight-*`、行高取自 `--line-height-*`。

### 双主题如何只切 Token 不切结构

1. Light 与 Dark **同名同义**变量一一对应，组件 CSS 只引用变量名，不写具体颜色。
2. 切换主题仅 `document.documentElement.dataset.theme = 'dark'`，组件 className、结构、状态逻辑零改动。
3. 双主题共用的非颜色项（`--icon-secondary`、`--font-*`、`--radius-*`、`--space-*`、`--text-* 字号`、`--weight-*`、`--line-height-*`）在 `:root` 定义一次即可，Dark 无需重复覆盖。
4. 仅颜色类变量在 `[data-theme="dark"]` 中覆盖；新增组件时若需新颜色，先补 Token 再使用，保持「规范先行」。

---

> 结尾：本文件为可落地规格，复制「颜色 Token / 字体 Token / 圆角 Token / 间距 Token」四段变量块即为代码样式基础，组件状态表直接驱动各组件 class 的状态样式。
