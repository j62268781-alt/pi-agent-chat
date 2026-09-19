# 交接文档 — pi-agent-chat 会话流 UI 改造（2026-09-19）

接手人：qwen3.8。本文是 2026-09-19 上午的状态快照，读完应该能直接开工。

---

## 1. 现状一眼

| 项             | 值                                                                            |
| -------------- | ----------------------------------------------------------------------------- |
| 仓库           | `d:\项目\pi-agent-chat`（VSCode 扩展 + Vue3 webview）                         |
| 分支           | `main`，与 `origin/main` **同步**（ahead/behind = 0/0）                       |
| 最后一个提交   | `cfe7067 feat(chat): give the boot splash a deadline and a retry loop`        |
| **未提交改动** | 5 个文件，见 §3（已 build 过，**未 commit**）                                 |
| 远端           | `https://github.com/j62268781-alt/pi-agent-chat.git`（gh 已认证为仓库所有者） |

改造目标：把会话流做成「参考 Qoder CN 的过程折叠 + 可配置显示行为 + 客户端自有排队/插话 UI」。
四个改造项（显示配置项 / 会话流呈现 / 队列 UI / 首页入口）**代码层面已完成**，剩下的是**真机复验 + 收尾**。

---

## 2. 环境硬事实（先看这条，能省很多时间）

1. **PATH 是坏的，必须显式合并注册表**。直接继承的 PATH 里找不到 `node`/`pnpm`/`git`。每条命令前加：

   ```powershell
   $env:PATH="D:\软件\nodejs;$env:APPDATA\npm;D:\软件\Git\cmd;$env:PATH"
   ```

   启动开发宿主时必须用**完整注册表 PATH**（否则 pi 起不来）：

   ```powershell
   $reg=(Get-ItemProperty 'HKCU:\Environment' -Name Path).Path
   $mach=(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' -Name Path).Path
   $env:PATH = (@($mach, $reg, 'D:\软件\nodejs', "$env:APPDATA\npm") -join ';')
   & 'D:\软件\Microsoft VS Code\bin\code.cmd' --extensionDevelopmentPath=d:\项目\pi-agent-chat d:\项目\pi-agent-chat --new-window
   ```

2. **PowerShell 脚本策略已修**：`CurrentUser` = `RemoteSigned`（原来是 `Restricted`，`pnpm.ps1` 直接被拒）。若某天又报"禁止运行脚本"，用 `.cmd` shim 绕过：`& "$env:APPDATA\npm\pnpm.cmd" run build`。

3. **校验流水线**（每改一次都要跑）：

   ```powershell
   pnpm run fmt      # 必须先跑，CI 的 oxfmt --check 会挂
   pnpm run lint
   pnpm run typecheck
   pnpm run test     # = lint + typecheck + vitest（当前 33 passed / 10 skipped）
   pnpm run build    # webview 两个单文件 HTML + rolldown 扩展包
   ```

   GitHub CI（`.github/workflows/ci.yml`）只跑 lint / typecheck / test:unit / build，**不含 e2e**。

4. **`test/e2e` harness 本机跑不了**：`test/e2e/runner.cjs` 第一步 `runningProcesses()` 调 `ps -Awwo`（macOS/Linux 专用），Windows 直接 `spawnSync ps ENOENT` 退出。它是 2026-09-18 在 Mac 上做的 M1/M2 阶段产物。要用得先补一个 Windows 进程枚举分支（`Get-CimInstance Win32_Process`）。

5. **"卡在加载页"的真因已定位（有实测数据）**：pi 启动时会先把 `~/.pi/agent/settings.json` 里 `packages` 声明的包做**全局 npm 安装**，装完才应答 RPC。独立复现（同参数 spawn `pi --mode rpc` + `get_state`）：

   ```
   +2096ms  child process: cmd.exe        ← pi 自己 spawn 的 npm
   stderr: added 140 packages in 12s
           added 262 packages in 28s
           added 265 packages in 26s
           added 174 packages in 18s
   +90026ms timeout 90s                   ← 90 秒内没有任何 RPC 响应
   ```

   即：**每次启动固定 ~85s+ 的安装**，期间扩展侧拿不到任何东西 → 启动页永远转圈。
   缓解建议（未执行，属用户机器配置）：精简 `~/.pi/agent/settings.json` 的 `packages`；或把 `~/.npmrc` 从 `registry.npmmirror.com` 换成官方源（该镜像滞后，见 `test/e2e/FINDINGS.md` §9.1）。

6. **工具调用默认被拒**：`~/.pi/agent` 装了 `pi-permission-system`。要真跑工具，得在弹出的权限对话框点「允许」，或改它自己的配置（`~/.pi/agent/extensions/pi-permission-system/config.json`，默认不存在）。用户全局设置里 `pi-agent-chat.permission.mode` 已是 `FullAccess`，但仍需过权限对话框。

7. **webview 加载机制（不要改）**：Vite `vite-plugin-singlefile` 出单文件 HTML → rolldown 自定义 `?raw` 插件内联进 `dist/extension.cjs` → 宿主替换 `PI_*_PLACEHOLDER`。**改了前端必须 `pnpm run build` 再在开发宿主 `Ctrl+R`（Reload Window）**，否则看到的还是旧 UI。`index.html` 里 `window.__PI__` 含 `display`（JSON 字符串，`lib/injected.ts` 解析，占位符未替换时回落默认值）。

8. **`chat.css` 的 codicon 是手工子集**：新增图标前先在 `webview-vue/src/styles/chat.css` 里搜有没有对应的 `::before` 规则（踩过：`codicon-reply` 不存在，见提交 `7bf60fb`）。settings 侧用 `settings.css`（另一套子集），两边独立。需要"转圈"这类状态时优先用纯 CSS（`.row-state.is-running` 就是纯 CSS 圆环，没依赖字形）。

9. **行尾已固定 LF**（`.gitattributes`：`* text=auto eol=lf` + 二进制排除）。若又出现"一堆 `M` 但 `git diff` 为空"，那是索引 stat 陈旧，`git add .` 刷新一次即可（`.gitattributes` 之前的原因不同：当时索引记的是 CRLF 尺寸）。

10. **本机模型**：provider `turing`，默认 `deepseek-v4-flash-vision-exp`，可真跑流式与工具调用（不要用 mock）。

---

## 3. 未提交的改动（5 个文件）——复验时重点看这里

这一轮修了三个问题，都已 build 进 `dist/`，但**还没 commit**：

| 文件                                            | 改了什么                                                                                                                           | 为什么                                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webview-vue/src/stores/transcript.ts`          | 折叠规则对所有消息**统一**：删掉"流式中不折叠、全部摊开"的分支（`isStreamingTail` 与 `splice` 那段）                               | 旧规则导致**流式期间这条回合根本没有折叠**，所以「正在执行中 · Ns」这个运行中折叠头永远不会出现（上一轮实测确认"未观察到"）                               |
| `webview-vue/src/components/TranscriptView.vue` | `v-for` 带 index，给 `TurnBlock` 传 `:is-last`                                                                                     | 供运行态判定                                                                                                                                              |
| `webview-vue/src/components/TurnBlock.vue`      | ① `running` 改为 `props.isLast && session.isStreaming`（**不再用 `stopReason`**）② 运行中折叠 `:open="running"`，settle 后自动收拢 | ① 带工具的回合是**多条 assistant 消息**，第一条 `message_end` 一落地 `stopReason` 就有值 → 回合中途就被判成「已处理」（真实 bug）② 折叠头要在运行期间可见 |
| `webview-vue/src/components/BootSplash.vue`     | 失败卡片补类名 `.boot-error-msg` / `.boot-retry`                                                                                   | 模板原来只给了 `id`，而 CSS 挂的是**类名** → 按钮一直是浏览器默认样式（上一轮截图实锤）                                                                   |
| `webview-vue/src/styles/chat.css`               | 追加 `#boot-error` / `#boot-error-msg` / `#boot-retry` 规则：左右 24px 留白、文案居中限宽 420px、按钮 pill 圆角 + brand 底色       | 用户要求"左右留点间距 + 按钮圆角大点 + 文案居中"                                                                                                          |

> 注意：`cfe7067` 已提交的看门狗（30s 超时 → 失败卡片 → 点重试回加载页并重新计时）与上面这 5 个文件是配套的，复验时把两者一起看。

---

## 4. 待复验清单（我正要交给 computer_use 复验，被打断了）

上一轮实测（`3836e4f` 那一版）的结论，以及**这一版需要重新确认的点**：

| #   | 项           | 上一轮结果                                                                                                                                                           | 这一版要确认                                                                                                 |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A   | 启动失败卡片 | PASS：文案居中、有留白、pill 按钮；点重试卡片消失                                                                                                                    | 按钮样式（类名修复后）、重试后是否回到加载页                                                                 |
| B   | 空状态       | PASS：标语 + 一行引导 + 3 个键帽                                                                                                                                     | 不变                                                                                                         |
| C   | 输入器工具栏 | PASS：`+`、模型、权限、「排队」pill、上下文环、发送；**无 `/` `@` 按钮**                                                                                             | 不变                                                                                                         |
| D   | `/` 下拉     | 高度 ~3 行、每行单行省略 PASS；`/压缩` 搜不到                                                                                                                        | **`/toggle` 应能搜到 `/autocompact`**（pi 的描述是英文，中文关键词天然搜不到——这不是 bug，但要在报告里说清） |
| E   | 运行中呈现   | **FAIL**：只有工具栏「正在工作…」，没有折叠头                                                                                                                        | 折叠头应为「**正在执行中 · Ns**」（秒数递增）、折叠体**默认展开**、底部有「深度思考中/正在回复中」实时状态行 |
| F   | 结束后呈现   | 部分 PASS：行首状态字形 ✓、`已思考 · <首行>` ✓、`终端命令 已运行 · <命令>` ✓、`读取文件 <file>` ✓、收尾状态行 ✓；**「已处理」折叠头与「执行工具 N 次」分组头未出现** | 本轮修复后应出现：head = 「已处理」、settle 自动收拢、展开后连续工具调用嵌在「执行工具 N 次」下              |
| G   | 排队卡片     | PASS：↩ 图标 + 预览 + 「排队中」标签 + 时间 + 插话/删除；删除后卡片消失且未发送                                                                                      | 不变                                                                                                         |
| H   | 设置页滚动   | 无法用自动化滚动（"scroll/PageDown/拖动滚动条均无效"），列表有滚动条                                                                                                 | 试键盘 PageDown / 中键拖拽；若仍无法滚动，**如实记为"自动化限制"而不是 FAIL**                                |
| I   | 回到底部按钮 | **FAIL**（未观察到）                                                                                                                                                 | 大概率是同一个滚动限制导致的观察不到；需换手段（点进 transcript 再 PageUp）                                  |
| J   | 控制台       | PASS：无 Vue warn / 未捕获异常 / 失败请求（只有 VS Code webview 固有的性能与 iframe sandbox 提示）                                                                   | 每次复验都看一眼                                                                                             |

复验手段：`computer_use` 子代理（带视觉），prompt 模板见 §6。**不要**用 `browser_use` 去开 dev host —— 那是桌面应用。

---

## 5. 已完成的功能与关键文件

- **显示配置项（改造项1）**：`src/providers/chat/display-settings.ts`（读配置 / 组装 / `affectsLiveDisplaySettings` / `affectsBakedHtml`）、`webview-vue/src/stores/display.ts`（CSS 变量镜像）。6 个 `pi-agent-chat.chat*` 开关 + 字号/背景都走 `onDidChangeConfiguration → postMessage({type:"displaySettings"})` **热更新**；只有 `language` / `chatMermaidTheme` 仍然重设 `webview.html`。
- **会话流呈现（改造项2）**：`TurnBlock.vue`（折叠头 / 工具分段 / 状态行）、`ThinkingBlockView.vue`（`思考中/已思考 · <首行>`，正文限高 220px 内部滚动）、`ToolCallView.vue`（行首状态字形 + bash/read 专属正文）、`TranscriptView.vue`（底部实时状态行、空状态）。
- **客户端队列（改造项3）**：`webview-vue/src/stores/pending.ts`（自建队列，**有 id 才能单条插话/删除**）、`QueuePanel.vue`、`Composer.vue`（按 `chatRunningSendBehavior` 分流）、`useHostLink.ts`（`agent_settled` → `flushNext()`）；持久化走 webview 的 `setState`（不用宿主 `workspaceState`）。
- **宿主 RPC 补全（改造项3h）**：`src/services/rpc/client.ts` + `src/protocol/rpc.ts` 补 `steer`/`followUp`/`setSteeringMode`/`setFollowUpMode`（**裸 `steer` 命令刻意不用**：pi 不准它带扩展命令 `/…`，统一走 `prompt` + `streamingBehavior`）。
- **契约唯一来源**：`src/protocol/{messages,rpc,settings}.ts`。改一处必须同步两侧（webview 通过 `@protocol/` 别名引用同一份文件）。
- **懒加载纪律**：`src/extension.ts` 用 `await import()` 保主 chunk（当前 `dist/extension.cjs` ≈ 26.7 kB，改动后不要让它膨胀）。

---

## 6. 常用命令 / 复验 prompt 模板

```powershell
# 全量校验
$env:PATH="D:\软件\nodejs;$env:APPDATA\npm;D:\软件\Git\cmd;$env:PATH"
pnpm run fmt; pnpm run test; pnpm run build

# 提交（commit message 用英文 conventional commits，正文写"为什么"）
git add <具体文件>; git commit -m "..."; git push
```

交复验时给 `computer_use` 子代理的要点（简短版）：窗口是 Extension Development Host，UI 在**左侧边栏**（Pi 图标 / 命令 `pi-agent-chat.openInSidebar`）；**pi 启动要装包 60–120s**，期间会出现 30s 超时的失败卡片 → 点「重试」直到加载完成；要跑工具就得在权限对话框点「允许」；禁止改文件/跑 git。

---

## 7. 已知风险与建议

1. **pi 每次启动 ~85s 装包**（§2.5）是当前最大的体验问题，属用户机器配置，扩展侧只能兜底（看门狗 + 重试）。建议在报告里给出精简 `packages` / 换 registry 的具体做法。
2. **命令描述是英文**：`/` 下拉的"按描述搜索"只对英文关键词有效（`/toggle` → `/autocompact`）。要支持中文得自建翻译表，不建议现在做。
3. **e2e harness 是 macOS 专用的**（§2.4）。若要让 CI/本机能自动验回归，需要补 Windows 分支；现有 macOS 用例（12 条）是可参考的骨架。
4. **`hasWorkToFold`（`stores/transcript.ts`）是死代码**（只有定义和 return，没有消费方），可随下次清理删掉。
5. 提交时注意：`pnpm run fmt` 之后若 `git status` 出现大量 `M` 而 `git diff --numstat` 为空，**不要提交那些文件**（见 §2.9）。
