# UI 功能盘点与设计稿对应表

> 来源：对 `pi-chat/`、`pi-settings/`、`src/`、`package.json` 三份并行只读扫描的反推结果。
> 规范：沿用 `STYLE-SPEC.md` 的统一样式规范（配色 / 圆角 / 间距 / 字号 / 组件形态）。
> 口径：已确认存在统一主题 token，因此**设计稿只出 Light 单版本**，Dark 由 token 映射推导。
> 画布：Ardot `726160554760857`（每个模块一个隔离 page，互不覆盖）。

状态图例：`✅ 已完成`　`⏳ 待画`　`— 不适用`

---

## 一、功能盘点清单

### 1. 设置面板 · 左侧导航（`pi-settings/index.html:23-55`）

| 功能                                                                                                           | 代码依据                                | 代码实现 | 设计稿        | 位置              |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------- | ------------- | ----------------- |
| 8 项导航 Models / Agents / Prompt Templates / Skills / MCP Servers / Commit Message / System Prompt / Settings | `index.html:23-55`                      | 已实现   | ✅            | A-① 展开态        |
| 选中态 `.nav-tab.active`                                                                                       | `index.html:27`，切换 `main.ts:101-110` | 已实现   | ✅            | A-① Settings 选中 |
| 悬停态                                                                                                         | `style.css:241`                         | 已实现   | ✅            | A-③               |
| 禁用态                                                                                                         | 代码无                                  | 缺失     | ✅ 按规范补齐 | A-③               |
| 折叠态（仅图标，<640px 自动）                                                                                  | `style.css:282-296`、`main.ts:55,74-81` | 已实现   | ✅            | A-②               |
| 顶部标题 + Reload 按钮                                                                                         | `index.html:14-21`、`main.ts:94-99`     | 已实现   | ✅            | A-①/④             |
| 折叠切换 `#nav-toggle`                                                                                         | `main.ts:58-71`                         | 已实现   | ✅            | A-②               |

### 2. 设置面板 · 右侧内容页（`main.ts:174-183`，8 个 tab）

| 页面                                                                                                   | 关键内容                      | 代码实现 | 设计稿 | 位置   |
| ------------------------------------------------------------------------------------------------------ | ----------------------------- | -------- | ------ | ------ |
| Models · Providers / OAuth / API Keys 二级 tab                                                         | `models.ts:368-372`           | 已实现   | ✅     | B1-①   |
| Provider 编辑卡（Name/Base URL/API Key/Protocol/AuthHeader/Headers/Compatibility 29 项）               | `models.ts:93-149`            | 已实现   | ✅     | B1-②   |
| Model 编辑卡（Model ID 编辑时 readonly、成本 4 项、Cost Tiers）                                        | `models.ts:506`               | 已实现   | ✅     | B1-③   |
| OAuth 授权流 8 态（auth_url / device_code / prompt / select / progress / success / error / cancelled） | `models.ts:556-594`           | 已实现   | ✅     | B1-④~⑪ |
| API Keys 区（连接徽章 / Set · Remove / 密码卡）                                                        | `models.ts`                   | 已实现   | ✅     | B1-⑫   |
| 行内确认条 confirm-bar（删 Provider / 删 Model / 移除 API Key）                                        | `models.ts:405,451,609`       | 已实现   | ✅     | B1-⑬   |
| Agents（4 类来源徽章 + 模型 + 4 操作 + 编辑卡，Name 编辑时 disabled）                                  | `agents.ts:100`               | 已实现   | ✅     | B2-①   |
| Prompt Templates（Argument hint + Content 模板 `{{变量}}`）                                            | `prompts.ts:77`               | 已实现   | ✅     | B2-②   |
| Skills（Body Markdown + Disable checkbox）                                                             | `skills.ts:76`                | 已实现   | ✅     | B2-②   |
| MCP Servers（Transport 切换 → stdio/http 两套字段组）                                                  | `mcp.ts:59,138-145`           | 已实现   | ✅     | B2-③   |
| Commit Message（Model / Language 15 种 / Custom prompt）                                               | `commit.ts`                   | 已实现   | ✅     | B2-④   |
| System Prompt（追加区 + 覆盖区警示块 + dirty 未保存按钮变色）                                          | `sysprompt.ts:45`             | 已实现   | ✅     | B2-④   |
| Settings（搜索 + Save + settings.json 链接 + 14 分组折叠 + dirty 圆点 + 分组重置）                     | `settings.ts:463-467,554-566` | 已实现   | ✅     | B2-⑤   |

### 3. 对话 · 顶部面板（`pi-chat/index.html:25-50`）

| 功能                                        | 代码依据                | 代码实现 | 设计稿        | 位置 |
| ------------------------------------------- | ----------------------- | -------- | ------------- | ---- |
| 会话名 `#session-info`                      | `index.html:27`         | 已实现   | ✅            | D-①  |
| 状态文字 `#status`「正在加载历史…」         | `messages.ts:1472`      | 已实现   | ✅            | D-①  |
| 重命名 `#name-btn` codicon-edit             | `globals.ts:756-760`    | 已实现   | ✅            | D-①  |
| 会话信息 `#info-btn` codicon-info           | `globals.ts:762-768`    | 已实现   | ✅            | D-①  |
| 刷新 `#refresh-btn`（流式/无会话 disabled） | `globals.ts:378-380`    | 已实现   | ✅ 含禁用态   | D-①② |
| 会话列表 `#sessions-btn` codicon-server     | `composer.ts:738-742`   | 已实现   | ✅            | D-①  |
| 设置 `#settings-btn`                        | `globals.ts:779-785`    | 已实现   | ✅            | D-①  |
| 图标按钮四态（默认/悬停/选中/禁用）         | `style.css:823,826,841` | 部分实现 | ✅ 补齐选中态 | D-②  |
| Tooltip（重命名会话 / 会话信息 / 设置）     | `globals.ts:601-623`    | 已实现   | ✅            | D-⑤  |

### 4. 对话 · 会话列表弹窗（`composer.ts:601-742`）

| 功能                                                         | 代码依据                          | 代码实现 | 设计稿 | 位置 |
| ------------------------------------------------------------ | --------------------------------- | -------- | ------ | ---- |
| 弹窗本体 `#sessions-popup`（标题「会话」+ 列表，最多 30 条） | `composer.ts:715,844-880`         | 已实现   | ✅     | C-①  |
| 条目三行结构 title / preview（截断 90+…）/ meta              | `composer.ts:656,663-667,669-672` | 已实现   | ✅     | C-①② |
| 选中态 `.session-item-check`                                 | `composer.ts:675-679`             | 已实现   | ✅     | C-①  |
| 悬停态                                                       | `style.css:575`                   | 已实现   | ✅     | C-①  |
| 未命名自动名「会话 MM-DD hh:mm」                             | `composer.ts:640-641`             | 已实现   | ✅     | C-①  |
| 相对时间（刚刚 / N 分钟前 / 昨天 / MM-DD / YYYY-MM-DD）      | `composer.ts:614-629`             | 已实现   | ✅     | C-①  |
| 空态「暂无会话。」                                           | `composer.ts:649-651`             | 已实现   | ✅     | C-③  |
| 触发锚定关系（按钮下方浮出）                                 | —                                 | 已实现   | ✅     | C-④  |

### 5. 编辑会话标题（`globals.ts:734-800`）

| 功能                                                            | 代码依据             | 代码实现 | 设计稿          | 位置 |
| --------------------------------------------------------------- | -------------------- | -------- | --------------- | ---- |
| 行内 input 替换标题（`#session-info` ⇄ `#name-input` 互斥显隐） | `globals.ts:735-743` | 已实现   | ✅              | D-③  |
| focus + select 全选                                             | `globals.ts:735-743` | 已实现   | ✅              | D-③  |
| Enter 提交 / Esc 取消 / 失焦取消                                | `globals.ts:789-800` | 已实现   | ✅ 提示文案     | D-③  |
| 字数限制 / 错误态                                               | 代码无               | 缺失     | ➖ 按需求可不加 | —    |
| 提交后（postMessage `setSessionName`）                          | `globals.ts:745-754` | 已实现   | ✅              | D-④  |

### 6. 浮层族（`composer.ts`、`globals.ts`）

| 功能                                                         | 代码依据                    | 代码实现 | 设计稿 | 位置 |
| ------------------------------------------------------------ | --------------------------- | -------- | ------ | ---- |
| 思考强度下拉（off→max 7 档 + 描述）                          | `index.html`、`composer.ts` | 已实现   | ✅     | E-①  |
| 权限模式下拉（shield 需要审批 / unlock 完全访问）            | `index.html`                | 已实现   | ✅     | E-②  |
| 「/」命令自动补全浮层（`.ac-hl` / `.ac-desc`）               | `composer.ts:835-962`       | 已实现   | ✅     | E-③  |
| 「@」文件自动补全浮层（`.ac-source` 路径）                   | `composer.ts:835-962`       | 已实现   | ✅     | E-④  |
| 右键菜单 `#ctx-menu`（三态，含 disabled 项）                 | `composer.ts:1253-1288`     | 已实现   | ✅     | E-⑤  |
| Overlay 对话框族（confirm / select 危险命令 / input / 问卷） | `composer.ts:1416-1508`     | 已实现   | ✅     | E-⑥  |
| 信息面板 `.info-panel`                                       | `globals.ts:654-682`        | 已实现   | ✅     | E-⑦  |
| 附件缩略图预览条 + 移除                                      | `composer.ts:1184-1208`     | 已实现   | ✅     | E-⑧  |

### 7. 反馈态与挂件

| 功能                                                      | 代码依据                                 | 代码实现 | 设计稿 | 位置 |
| --------------------------------------------------------- | ---------------------------------------- | -------- | ------ | ---- |
| Toast 四态（info / success / error / persistent）         | `main.ts:112-124`、`composer.ts:628-641` | 已实现   | ✅     | F-①  |
| 字段级 error 条 + 三类提示条（danger/warning/success）    | `models.ts:960`、`settings.ts:635-639`   | 已实现   | ✅     | F-②  |
| 空状态页（logo + 快捷键 hint）                            | `globals.ts:159-210`                     | 已实现   | ✅     | F-③  |
| 上下文用量环 `#ctx-ring`（正常 / ≥50% warn / ≥80% error） | `globals.ts:408-409`                     | 已实现   | ✅     | F-④  |
| 待办挂件（n/total + 折叠 + 清空）                         | `globals.ts:447-531`                     | 已实现   | ✅     | F-⑤  |
| 排队区（Steering / Follow-up 徽章 + 清空）                | `globals.ts:551-572`                     | 已实现   | ✅     | F-⑥  |
| 回退挂件（文件行 + 全部接受 / 全部回退）                  | `rewind.ts:45-199`                       | 已实现   | ✅     | F-⑦  |
| 加载态 / spinner / 流式 `.is-streaming`                   | `messages.ts:656`                        | 已实现   | ✅     | F-⑧  |

### 8. 已实现但未接线的 UI（**需产品决策**）

| 功能                                                               | 代码依据                 | 状态                                                 | 设计稿  |
| ------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------- | ------- |
| 会话侧栏（目录下拉 + 搜索 + 行操作 + 空态/无匹配/加载中/删除确认） | `sessions-sidebar.ts:33` | 已实现、**从未 register**，package.json 无 view 声明 | ✅ G-①② |
| 设置侧栏（环境检查卡 + 链接组 + 版本过低态）                       | `settings-sidebar.ts:12` | 同上                                                 | ✅ G-③  |
| Pi 包市场侧栏（搜索 + 卡片 + Working… 遮罩 + Cancel）              | `packages.ts:8,119-137`  | 同上                                                 | ✅ G-④  |
| 侧栏聊天启动屏（logo + 三点动画 + 错误 + 重试）                    | `chat-sidebar.ts:99-178` | 同上                                                 | ✅ G-⑤  |

> 全仓仅 `extension.ts:328` 一处 `registerWebviewViewProvider`；nls 中的 `pi.view.sessions` / `pi.view.settings` 是孤儿键。
> 设计稿已补齐，但这三块**是否投产取决于接线决策**。

---

## 二、设计稿 ↔ 模块对应表（8/8 全部完成）

| 模块           | 画布 page | 根容器 id | 导出 PNG                    | 完成状态 |
| -------------- | --------- | --------- | --------------------------- | -------- |
| A 设置导航侧栏 | `2:726`   | `2:764`   | `09-A-settings-nav.png`     | ✅       |
| B1 设置-Models | `2:727`   | `2:734`   | `10-B1-settings-models.png` | ✅       |
| B2 设置-其余页 | `2:728`   | `2:1586`  | `11-B2-settings-other.png`  | ✅       |
| C 会话列表弹窗 | `2:729`   | `2:1432`  | `12-C-sessions-popup.png`   | ✅       |
| D 顶栏与重命名 | `2:730`   | `2:1504`  | `13-D-topbar-rename.png`    | ✅       |
| E 浮层族       | `2:731`   | `2:1865`  | `14-E-overlays.png`         | ✅       |
| F 反馈态与挂件 | `2:732`   | `2:2009`  | `15-F-feedback.png`         | ✅       |
| G 侧栏与启动屏 | `2:733`   | `2:2139`  | `16-G-sidebars.png`         | ✅       |

---

## 三、一致性校验结论

`capture_layout(problemsOnly:true)` 对全部八个根容器通过：**无 OVERFLOW / OVERLAP / CLIPPED**。
仅剩 `LARGE_EMPTY_AREA` 类警告，均为预期留白，不构成缺陷：

- 多行文本域固定高度 > 当前示例文本行数（文本域的应有形态）
- 状态样例行左对齐、容器满宽导致右侧留白
- 空态/启动屏的居中留白

统一约束的**唯一出处是 `STYLE-SPEC.md`**（颜色与几何都取自 VS Code 主题：色号
`--vscode-*`、尺寸令牌 `--vscode-cornerRadius-*` / `--vscode-spacing-size*` /
`--vscode-strokeThickness`，字号五档 10/12/13/16/20，界面与代码字族取编辑器的设置）——
数字不在这儿复述，那份清单已经在配色与尺度两次调整里过期过一回。
**布尔项一律原生 checkbox**（代码无 Switch，`.switch` 为死样式）。

---

## 四、仍需补充

1. **决策项**：三个未接线的 ViewProvider（会话侧栏 / 设置侧栏 / 包市场）是否纳入本期投产。
   这是唯一阻塞项 —— 设计稿已就绪，只差接线决定。
2. **可选增强**：行内重命名目前无字数限制与错误态，若产品侧需要，可补「超长/重名」错误态。
3. **Dark 主题**：本次只出 Light；如需视觉稿而非仅 token 映射，可批量按 STYLE-SPEC.md 的 Dark 取值派生。
4. **目检**：当前模型无法读图，导出 PNG 的观感需在编辑器中人工确认。
