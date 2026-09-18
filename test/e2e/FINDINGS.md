# M1 findings

规格书（`docs/superpowers/specs/2026-09-18-vscode-e2e-test-harness-design.md`）§4 要求 M1
关闭若干不确定项。以下结论全部来自实际运行，不是推测。执行日期 2026-09-18。

> 本机专属路径在发布前已泛化（`/Users/<user>` → `~`）。受影响的是两处日志摘录 ——
> §4 的 `Loading development extension at ...` 与 §11.4 的那条 `ps` 命令行：
> 它们除路径前缀外仍与运行日志逐字一致。

## 1. `extensionTestsEnv` 是否传到扩展宿主

**结论：是。**

**证据：** 用例 `propagates extensionTestsEnv into the extension host` 通过。它断言
`realpathSync(process.env.PI_E2E_WORKSPACE)` 等于
`realpathSync(vscode.workspace.workspaceFolders[0].uri.fsPath)`，并断言 `PI_E2E_SESSIONS`
非空。两侧都做 `realpathSync` 是必要的：macOS 把 `/var/folders/...` 解析成
`/private/var/folders/...`，直接字符串比较会假失败。

机制上也可解释：`@vscode/test-electron@3.1.0` 的 `out/runTest.js` 只是把
`extensionTestsPath` 当 CLI 参数传给 VS Code，并把 `extensionTestsEnv` 合进
`cp.spawn` 的 env，所以它作用于整个 VS Code 进程树。

**对 M2–M4 的影响：** 规格书 §5.1 设想的「用 `extensionTestsEnv` 覆盖 `HOME` 做凭据隔离」
在机制上可行。但 §5.1 的凭据处理决策（软链 / 复制 / 跳过写入类用例）仍待你拍板。

## 2. `PI_OFFLINE=1` 会不会挡掉 LLM 请求

**结论：不挡。** 已用独立实验测定（见 §11.2），M2 可以继续沿用 `PI_OFFLINE=1`。

带与不带 `PI_OFFLINE=1`，pi 在 `--mode rpc` 下行为几乎一致：都在约 4.5s 后对
`get_state` 回 `success: true`，model 正确解析为 `qoder/qwen3.8-flash`，8s 时进程仍存活。

**仍需 M2 验证的**是真正的模型调用（`prompt` 命令）—— 上述实验只发了 `get_state`，
没有触发 LLM 请求。所以「`PI_OFFLINE` 会不会阻断模型 API 调用」严格来说仍未测定，
只是启动与 RPC 层已确认无碍。

## 3. `--disable-workspace-trust` 是否足够

**结论：足够。**

**证据：** 5 次运行均未出现信任弹窗阻塞；6 个用例全部执行并通过。fixture settings 里
没有额外加 `security.workspace.trust.enabled: false`，也不需要。

## 4. 复用本机 VS Code 1.138.0 + 空 `--extensions-dir` 能否加载开发扩展

**结论：能。**

**证据：** 运行日志出现
`Loading development extension at ~/Documents/pi-agent-chat`，随后
`activates the extension under its manifest id` 与
`registers every command declared in contributes.commands` 两个用例通过（后者从
`package.json` 的 `contributes.commands` 读取全部 11 个命令名，与
`vscode.commands.getCommands(true)` 比对，零缺失）。

`[e2e] vscode` 行确认使用的是
`/Applications/Visual Studio Code.app/Contents/MacOS/Code`，未触发下载。

## 5. pnpm `onlyBuiltDependencies` 是否拦掉 postinstall 下载

**结论：不适用。**

`@vscode/test-electron@3.1.0` 的 `package.json` `scripts` 里没有 `install` /
`postinstall`，安装期不下载 VS Code。下载只发生在 `runTests()` 未拿到
`vscodeExecutablePath` 时。故 `pnpm-workspace.yaml` 的
`onlyBuiltDependencies: [esbuild]` 不构成阻碍。

## 6. pi 是否在无 prompt 时就写会话文件

**结论：否。**

**证据：** pi 进程已确认存活（见第 2 项），侧边栏会话已启动，但
`PI_CODING_AGENT_SESSION_DIR` 指向的目录在 30s 观察窗口内文件数为 **0**
（日志 `[m1 finding] files under PI_CODING_AGENT_SESSION_DIR: 0`）。

**对 M2 的影响：**

- 规格书原设想「M2 读 pi 会话文件做零侵入断言」**仍然成立，但必须先发一个 prompt**，
  否则没有文件可读。
- M1 对应用例已从「等 30s 看有没有文件」改为「断言重定向本身正确 + 记录文件数」。
  理由：结论既已测定，继续等待每次白烧 30s。这一改动把套件耗时从 30s 降到约 0.4s。

## 7. 实测耗时

| 场景                                                          | 墙钟      |
| ------------------------------------------------------------- | --------- |
| `npm run test:e2e`（含 webview vite ×2 + 扩展 rolldown 构建） | **9s**    |
| `node test/e2e/.build/runner.cjs --skip-build`                | **3s**    |
| mocha 套件本身（7 次运行）                                    | 292–404ms |
| `pi-agent-chat.openInSidebar` → pi 出现在 `ps`                | 283–338ms |

**flake 检查：** 修正 §8.1/§8.2 两个 bug 之后连续 **7 次**运行（含构建 3 次、
`--skip-build` 4 次），每次都是 `6 passing` / `Exit code: 0` / 孤儿 pi 进程 0 /
fixture 目录已删除 / `.vscode-test` 未被创建。

> **M1 覆盖范围的重要限制：** 套件 292–404ms 就跑完并关窗，而 pi 的首次 RPC 响应需要
> 约 4.5s（§11.2）。所以 **M1 从未观测到任何一条 pi 的响应** —— 它证明的是「VS Code
> 起来了、扩展激活了、命令全注册了、pi 带着正确参数 spawn 了」，**没有**证明 RPC 链路
> 可用。RPC 双向可用是 §11.1 用延长窗口的实验单独证明的。
>
> 另：规格书 §2.1 测得的「一句 `OK` 需 20.4s」是 `pi --print --no-session --no-tools`
> 的单发基线；M2 引入真 prompt 后，单个 turn 的用例耗时会显著上升，120s 超时预算仍适用。

## 8. 执行期发现并修掉的两个 bug

### 8.1 macOS 上 VS Code 的可执行文件名是 `Code`，不是 `Electron`

初版 `fixture.ts` 写成 `Contents/MacOS/Electron`，`existsSync` 因此为 false，
`resolveVsCodeExecutablePath()` 返回 undefined，`runTests()` 静默回落到下载 ——
**`.vscode-test/` 被创建了 914MB**。整个失败没有任何报错，只是慢和占盘。

已修为 `Contents/MacOS/Code`，并在 `fixture.test.ts` 加了回归断言（既断言解析出的
路径字面值，也断言该路径 `existsSync`）。该缓存目录已删除。

**教训：** 回落路径必须可观测。现在 runner 会打印
`[e2e] vscode  <path or "(download into .vscode-test/)">`，一眼能看出走了哪条。

### 8.2 `which pi` 的结果取决于调用方式

`npm run` / `pnpm run` 会把 `node_modules/.bin` 前置到 PATH，直接
`node test/e2e/.build/runner.cjs` 则不会。同一份代码在两种调用下会选中不同的 pi。

已改为显式解析：`PI_E2E_PI` → `<repoRoot>/node_modules/.bin/pi` → `which pi` →
`~/.local/bin/pi`，与扩展自身的探测顺序（`src/services/pi/binary.ts:60`）一致。
两个 pi 都是 0.85.1，`node_modules/.bin/pi` 指向
`@earendil-works/pi-coding-agent/dist/bundle/cli.js`，即扩展实际依赖的那一份，
用它测试比用全局的更贴近生产。

## 9. 环境层面的既有问题（非本计划引入）

### 9.1 npmmirror 镜像滞后会让任何 pnpm 重新解析失败

`~/.npmrc` 设了 `registry=https://registry.npmmirror.com`（用户级，仓库内无
`.npmrc`）。已提交的 `pnpm-lock.yaml` 里钉着 `@azure/msal-browser@5.22.0`
（经 `@vscode/vsce@3.9.2` → `@azure/identity@4.13.3`），而镜像上最新只有 5.21.0，
于是 `pnpm install --lockfile-only` 报
`ERR_PNPM_NO_MATCHING_VERSION`。

本次用的绕法（只需要元数据，不下载 tarball）：

```bash
pnpm install --lockfile-only --registry=https://registry.npmjs.org/
```

**CI 不受影响**：Actions 里没有这份 `.npmrc`，走默认源，且用 `--frozen-lockfile`
不重新解析。

锁文件改动已核验为良性：3 个包条目被移除（`debug@4.4.3`、`inherits@2.0.4`、
`util-deprecate@1.0.2`），但三者都仍存在于锁文件中 —— 被移除的是带
`optional: true` 的重复条目，pnpm 做了合并；另新增了 mocha 需要的
`debug@4.4.3(supports-color@8.1.1)` peer 变体。共 54 个新增包条目，
与 `package.json` 复检为 IN SYNC。

### 9.2 `node_modules` 曾整目录为 root 所有

`node_modules`、`webview-vue/node_modules`、以及两个 `package-lock.json` 都是
root:staff（上次 `sudo npm install` 的残留），当前用户无写权限，任何安装都会
EACCES。已由你执行 `sudo chown` 修复。`.git` 未受影响。

### 9.3 本机原本没有 pnpm

`~/.zshenv:11` 把 `$HOME/.workbuddy/binaries/node/shims` 加进 PATH，注释说那是
pnpm/pnpx 的 corepack shims，但 `~/.workbuddy/binaries/node` 整个目录不存在；
`~/Library/pnpm` 只有 `store`；`corepack` 也不在。后果是本地
`npm run build` / `npm test` / `npm run typecheck` 全都跑不了（它们内部调 `pnpm`）。
已由你执行 `sudo npm i -g pnpm@10.32.1` 修复，现 `npm run typecheck` 四段全通、
退出码 0。

### 9.4 `bind.test.ts` 有 2 个用例在 macOS 上失败

- `bindServer TCP > falls back to a random port when the fixed port is in use`
  （`expected undefined to be <port>`）
- `unlinkStaleSocket > unlinks a stale socket file when nothing is listening`
  （`expected true to be false`）

均为 macOS 与 Linux 的行为差异。后者的用例用普通文件伪造「陈旧 socket」，其注释自陈
"on real Linux this is what a closed server leaves behind"，而 macOS 对普通文件
`connect()` 的 errno 与 Linux 不同，故未触发 unlink。CI 跑 `ubuntu-latest`，
在 CI 上是绿的。**与本计划无关**：把 `vitest.config.ts` 移开后同样失败
（2 failed | 9 passed）。未修，超出 M1 范围。

## 10. 工具链细节（写代码时会撞到）

- **`moduleResolution: "node"` 在 tsgo 下已被移除**：报
  `TS5108: Option 'moduleResolution=node10' has been removed`。`test/e2e/tsconfig.json`
  因此不再覆盖 `module`/`moduleResolution`，直接继承根配置的 nodenext，只覆盖 `types`。
  产物仍是 CJS —— 那是 rolldown 的输出格式问题，与类型语义无关。
- **`mocha.loadFiles()` 在 mocha 12 的类型里是 `protected`**，不能外部调用。
  不需要调：`Mocha.prototype.run` 里有
  `if (this.files.length && !this._lazyLoadFiles) this.loadFiles()`，
  而 `_lazyLoadFiles` 默认 false，所以 `addFile` 之后直接 `run()` 即可。
- **`import { runTests } from "@vscode/test-electron"` 在 nodenext 下可以过 typecheck**，
  尽管该包是 CJS 且无 `exports` map。无需退化成默认导入再解构。
- **共享 chunk 只在有 2 个以上入口引用同一模块时才生成**。Task 3 阶段 runner 还是占位、
  只有 case 引用 `harness.ts`，故被内联、没有 `chunks/`；Task 4 runner 也 import
  `fixture.ts` 之后，`chunks/fixture-<hash>.cjs` 才出现。这是预期行为，不是配置错误。
- **mocha 输出带 ANSI 色码**（`color: true`），管道重定向到文件后仍在，
  `grep -oE '[0-9]+ passing'` 这类正则会匹配失败。用 `grep -E "passing"` 即可。
- **rolldown 的 input 已改为动态扫描 `test/e2e/suite/cases/*.test.ts`**，新增用例不需要再改
  `rolldown.config.ts`。原先是硬编码列表，M2 会不断加用例，那条路会很快变成维护陷阱。

## 11. M2 准备期的 spike 结论

M1 完成后、写 M2 计划前做的一次性实验。实验代码已删除（临时用例 `zz-spike.test.ts`
与 `/tmp/pi-rpc-spike.mjs`），结论保留在此。

### 11.1 rpcTrace 输出通道确实落盘且双向 —— M2 的零侵入断言通道成立

`pi-agent-chat.rpcTrace: true` 时，"Pi Chat RPC" 输出通道内容写到：

```
<fixture>/user-data/logs/<yyyymmddTHHMMSS>/window1/exthost/output_logging_<ts>/1-Pi Chat RPC.log
```

路径里有 `exthost/` 这一层（M1 期间写进断言消息的 `window*/output_logging_*/` 少了一层，
已修正）。每行格式为 `[<tag>] -> <json>` 或 `[<tag>] <- <json>`，stderr 为
`[<tag>] [err] <line>`。双向都记：`src/services/rpc/client.ts:132` 记 out、`:88` 对
stdout 每一行记 in、`:114` 记 stderr。

**这意味着 M2 不需要 M3 的探针，就能断言宿主侧看到的 RPC 事件序列。**

**必须处理的陷阱：输出通道是异步落盘的。** 窗口拉长到 12s 的那次运行留下 63 行
（28 out / 35 in / 0 err）；而 369ms 就关窗的 M1 运行只留下 12 行且**全是 out**。
M2 读日志前必须留足等待，且不能把关窗前的最后几行当可靠数据。

### 11.2 pi 首次 RPC 响应约需 4.5s；`PI_OFFLINE` 无影响

用与扩展完全相同的参数独立 spawn pi（四个 `-e` pi-extensions + `--mode rpc` +
`--model solar/qoder/qwen3.8-flash`，env 带 `PI_CODING_AGENT_SESSION_DIR`），保持 stdin 打开：

|                 | 首个 `setWidget` | `get_state` 响应 | 8s 时存活 |
| --------------- | ---------------- | ---------------- | --------- |
| `PI_OFFLINE=1`  | +1.38s           | **+4.70s**       | 是        |
| 无 `PI_OFFLINE` | +1.31s           | **+4.48s**       | 是        |

差异在噪声范围内。`get_state` 回 `success: true`，`data.model.id` 为
`qoder/qwen3.8-flash`，模型解析正确。

启动期 pi 还会**主动推**未经请求的 `extension_ui_request`，method 为 `setWidget`
（`rewind-files`、`subagent-async`）与 `setStatus`（`pi-lens-lsp`、`pi-permission-system`）。
M2 断言事件序列时要预期到这些，不能假设第一条入站消息就是响应。

### 11.3 会话重定向确认生效，但无 prompt 时磁盘上仍无文件

`get_session_stats` 响应里带 `data.sessionFile = <fixture>/pi-sessions/2...`，证明
`PI_CODING_AGENT_SESSION_DIR` 经 `pi-agent-chat.env` 确实传到了 pi。但 M1 观察窗口内该目录
文件数为 0（§6），即 pi 报告了路径但尚未落盘。**M2 发过 prompt 后应重新检查该文件。**

### 11.4 根因：pi 会重写自己的进程标题，`ps` 里只剩一个裸 `pi`

**结论：`findTestPiProcesses()` 的匹配串从根本上不可靠。pi 启动后会把进程标题改写成
裸 `pi` 并用空格填充，argv 全部消失，所以带参数的长匹配串只在启动后几百毫秒内有效。**
**M1 的孤儿进程检查（runner 收尾）同样受此影响，会漏报真实孤儿。**

排查过程（4 次实验，互相印证）：

1. **先怀疑会话被反复重启** —— 排除。`ensureSidebarSession`
   （`chat-sidebar.ts:126-148`）有会话就复用，否则 `pendingSession ??=` 共享同一 promise；
   `onDidDispose`（`:234-242`）明确保留后台会话。trace 里 hydration 重复 3–7 遍是
   `resolveWebviewView` 每次重设 `webview.html`（`:195`）导致 webview 文档重载 → 重新
   post `webviewReady` → 重新 hydrate（`chat-session.ts:689-693`）——**重载的是 UI，不是进程**。
2. **再怀疑 `attach` 杀进程** —— 排除。`attachHost`（`chat-session.ts:1107-1114`）只换
   host、重订阅、再 hydrate。
3. **再怀疑「宿主内 `ps` 看不见」** —— 排除。在 runner 里（扩展宿主**之外**）起了一个
   每秒采样的定时器，与套件内的采样同时跑：两边连续 30s 都是 `matched=0`，
   而同期 trace 有 36 条入站响应。**观测位置不是变量。**
4. **逐个候选子串统计，定位到 argv 消失** —— 决定性数据：

   ```
   [spike5 t=1s] total=529 --mode rpc=0 --model solar/qoder/qwen3.8-flash=0
                 pi-vscode-bridge=0 pi-coding-agent=0 pi-extensions=0 anyPi=1
   [spike5 t=1s]   pi
   ```

   连 `pi-extensions`、`pi-vscode-bridge` 这种来自 `-e` 参数的稳定子串都是 0，
   而宽松匹配命中的那一行内容是**带大量尾部空格的裸 `pi`** —— `setproctitle` 重写进程标题、
   用空格覆盖原 argv 区域的典型痕迹。

而运行 A 的 t=0 采样确实抓到过带完整 argv 的进程：

```
node ~/Documents/pi-agent-chat/node_modules/.bin/pi
  -e .../pi-extensions/pi-vscode-bridge.js -e .../questionnaire.ts
  -e .../permission-gate.ts -e .../rewind-code.ts ...   (matcher=1)
```

所以完整解释是：**`node .../.bin/pi <参数>` 只是一个短暂存在的启动进程；pi 随后重写标题，
之后 `ps` 里永远是裸 `pi`。** M1 能在 283–346ms 命中，是抓住了那个窗口；一旦有别的用例
先打开侧边栏把时序错开，窗口就被错过，于是出现「6 次重试全落空」——这也解释了为什么
加入临时用例后 M1 会变得顺序敏感，以及**为什么 §7 记录的 7 次稳定里，进程检测那部分是运气**。

**对 M2 的要求：**

- **存活/收发判据换成 rpcTrace 日志里的 `<-` 行**（§11.1 已确认可读）。它同时证明
  「进程活着」和「在按协议说话」，不依赖 argv。
- 若仍需要进程级判据（例如收尾的孤儿检查），匹配**去掉参数的裸 `pi`**（trim 后等于 `pi`），
  而不是现在的长串。当前 runner 的孤儿检查在这条修好之前**不能作为可信证据**。
- 本轮实验期间加入的临时用例会让 M1 套件变得不稳定（运行 B 里 M1 的 pi 用例失败）；
  删掉后连跑 3 次恢复 6 passing / exit 0。

## 12. M2 结论

M2（受门控的刺激钩子 + hydration + 真 prompt turn / abort）的实测记录，执行日期 2026-09-18。
套件共 **12** 条（M1 6 + 钩子 1 + hydration 2 + 真 turn 3），十次记录跑全部 `12 passing` /
`Exit code: 0`。本节数字取自当次运行的日志（`/private/tmp/m2-run1.log`、
`m2-flake-{1,2,3}.log`、`m2-keep.log`、`m2-fix-run1.log`、`m2-fix-flake-{1,2,3}.log`、
`m2-fix-keep.log`；用例耗时以日志里的 `✔ … (Nms)` 为准）。Task 6 是文档任务，没有重跑套件。

### 12.1 受门控的刺激钩子

**命令：** `pi-agent-chat.__webviewMessage`，参数为消息 JSON 字符串。是一个通用入口（不是
prompt / abort / dialogResponse 各一条），M3、M4 的刺激需求不必再改生产代码。
**门控：** `shouldRegisterTestingCommands(context.extensionMode)`（`src/commands/testing-gate.ts`，
`EXTENSION_MODE_PRODUCTION = 1`），Production 下不注册；调用点在 `src/extension.ts:58-61`，
且 `registerTestingCommands` 是 `await import()` 进来的。
**自动化覆盖：** 门控判定有单测（`src/commands/testing-gate.test.ts` 三条：Production 假、
Development(2)/Test(3) 真、未知模式(99) 真）；「非 Production 宿主下确实注册了」有用例断言
（`registers the dev-only stimulus command`：在 `vscode.commands.getCommands(true)` 里查到该 id）。
**「Production 下未注册」没有自动化覆盖** —— 本 harness 的测试宿主恒为 Test(3)（runner 传了
`extensionTestsPath`，见该用例注释），Production 无法在 harness 内翻转；这半边依赖
`extensionMode` 这一平台保证 + 代码审查。缓解措施（Task 3 fix 轮加的）：同一用例把
`EXTENSION_MODE_PRODUCTION` 钉在 `vscode.ExtensionMode.Production` 上，常量漂移会红 —— 但被
钉住的只是常量，**「Production 宿主里命令不注册」这一分支从未被执行过**。
产物层面（Task 3 fix 轮实测的反事实）：去掉 `commands/index.ts` 的静态 re-export 后，
`__webviewMessage` 已不在主包 `dist/extension.cjs`（`grep -c` 1 → 0），只出现在惰性加载的
`dist/chunks/testing-*.cjs`；vsix 仍会带上该 chunk，但 Production 宿主不会 `require` 它。

### 12.2 真 prompt turn 的实测

- 首个 `message_update` 出现耗时：**未单独打点**。可给的上界 **< 5.7s**（推导：修复后的 abort
  用例必须先看到本 turn 的 delta 才发 abort，而修复后的五次记录跑
  `m2-fix-run1` / `m2-fix-flake-{1,2,3}` / `m2-fix-keep` 全程 **10.1–12.7s**
  （10619 / 10623 / 10119 / 10629 / 12660 ms），其中 7s 是两次刻意采样，剩下的 3.1–5.7s
  覆盖 prompt → 首个 delta → abort → 响应）。**这个上界属于上面这五次记录跑，不是不变量**：
  Task 7 fix wave 的复测把同一用例又观测到 10.1–17.3s（见 §12.8）。参考量级：pi 启动后首个
  RPC 响应约 4.5s（§11.2），M1 的 `get_state` 用例实测 5.25–5.77s（十次记录）。
- 完整 turn（prompt → agent_settled）耗时：该用例在十次记录跑里实测
  **4.4s / 5.9s / 6.0s / 7.6s / 7.9s / 10.7s / 16.1s / 19.8s / 20.4s / 20.6s**。最快一次 **4.4s**，
  测量聚在 5.9–7.9s 一档，尾部慢到 20.6s；慢跑由模型首响延迟主导，不是 harness 开销（pi 的
  首次响应本身就要约 4.5s）。
- 事件序列实际观测到的顺序：`agent_start` → … → `message_start` → … → `message_end` → … →
  `agent_settled`。用例按索引断言这四个名字的先后（`agent_start` < `message_start` <
  `message_end` < `agent_settled`），刻意不写成「最后一个是 `agent_settled`」——
  `waitForRpc` 一到 `agent_settled` 就返回，其后落地的 `queue_update` 等事件会让末位断言假失败。
- 是否出现 `message_update` 之外的意外事件：**是，且不是噪声**。"Reply with the single word: ok"
  这一轮不是纯文本 turn：trace 里有 `tool_execution_start` → `tool_execution_update` ×2 →
  `tool_execution_end`，整轮由 3 个 `turn_start`/`turn_end` 周期与多组 `message_start` /
  `message_end` 组成。这组 trace 构成细节**记为 report-asserted**（来自 Task 5 报告对 `--keep`
  fixture 的分析；fixture 在审查前已被清理，运行日志只留用例结果与时长、不含完整 trace，审查者
  无法独立复核 —— 同 12.3）。索引断言在多消息、带工具的轮次里成立（`indexOf` 取首次出现），不是
  在「单条消息」假设下侥幸通过 —— 后人不该按单消息假设去「简化」它。

### 12.3 abort 的实测

- abort 响应耗时：**未单独打点**（用例只等它、只断言 `success: true`，30s 预算）。`abort` 的
  响应无 data（`src/services/rpc/client.ts:205`），所以「`{cancelled: true}`」不是这个命令的
  返回值。结构性观测：修复后的 trace 里 `response:abort` 排在 turn 收尾（`message_end`、
  `agent_settled`）之后 —— 「abort 响应到达」不是「流停止」的时刻。
- abort 时流是否确实已在输出（本 turn 的 delta 数）：**25**（介于本 turn 的 prompt 与 abort
  请求之间）。同一份共享日志里另有 **41** 条早于该 prompt 的 stale delta —— 这正是旧判据
  `>= 1` 会被历史立即满足的原因（缺陷版里 abort 在 prompt 后约 40ms 就发出、本 turn 0 条
  delta，该 40ms 由修复前的用例时长反推，非独立计时）。
- abort 后 `message_update` 是否停止增长：**是**。恰好 **1** 条 in-flight delta 落在 abort
  请求之后、响应之前；响应之后 **0** 条；两次采样（+3s、+7s）计数相等。
- abort 后是否收到 `agent_settled`：**是**（trace 里 `agent_settled` 出现在 abort 之后）。

**因果边界（不得读成「证明了取消」）：** 该用例的判据是「delta 计数停止增长」，而计数**不能**
区分「abort 取消了流」与「模型自己在 3s 采样窗口内停了」。它**能**证明的是：流在 abort 时刻
确实还活着（本 turn 的 25 条 delta 断言；缺陷版是 0 条，freeze 断言据此空洞通过），以及 abort
之后计数冻结。修复的价值是让这条用例真的等到流开始，不是把判据升格成 cancellation 的证明。

**更强的证据（Task 7 fix wave 已从「观测」升格为用例，不再留给 M3）：** pi 写进会话文件的最后
一条 assistant 消息带 `stopReason: "aborted"`。它比计数冻结强在：它是 pi 自己写给本次 turn 的
一等结构标记，能区分「被取消」与「模型自己停下」；计数冻结只说明「3s 里没有新 delta」，结论随
采样窗口长短摆动。abort 用例现在读会话文件并断言它（`filesUnder` / `sessionsDir` 给出路径），
与计数冻结并存；同一 wave 把会话文件用例从「文件数 > 0」升级为解码 JSONL 并断言存在 user /
assistant 记录且 assistant content 非空。新断言的反证（Task 7）：去掉 abort 发送后 freeze
断言照常通过、`stopReason` 断言以 `'stop' !== 'aborted'` 失败 —— 正是旧判据区分不了的那种情形
（`/private/tmp/m2-task7-falsify.log`，fixture 保留在运行日志所载路径）。

**证据强度声明：** 25 / 41 / 1 / 0 这组数字来自 Task 5 报告对一份 `--keep` fixture 的 trace
逐行分析加代码逻辑；该 fixture 在审查前已被清理，审查者无法独立复核 —— 按 Task 5 记录的
process lesson，这组数字记为 **report-asserted**，不是独立验证。（可独立复核的部分是：十份
运行日志各自的 `12 passing` / `Exit code: 0` / 用例时长。）

### 12.4 会话文件

有 prompt 之后 `PI_CODING_AGENT_SESSION_DIR` 下的文件：**1 个 `.jsonl`**，Task 5 记录的样本
文件名形如 `2026-09-18T10-50-18-701Z_01a0b423-….jsonl`（文件名由 pi 生成，报告里截断了 uuid；
用例不锁名字）。内容是真实会话而不是空壳：session 头、`model_change` / `thinking_level_change`、
以及 `message` 记录（`role` 为 `user` / `assistant`；`stopReason` 嵌在 `message` 里，不在记录
顶层）。Task 5 记录的样本共 9 行、含 `toolResult` 记录、被 abort 的 assistant 是 `content: []`；
Task 7 fix wave 的两份新观察（独立 RPC 复现 5 行 / 真实 harness `--keep` fixture 7 行）都没有
`toolResult` 记录，被 abort 的 assistant content 是一个 thinking 片段 —— **行数与 content 随
turn 内容变化，用例只锁 `stopReason`，不断言行数或 content 形态**。会话文件用例本身已升级为
解码 JSONL：断言每行可解析、存在 user / assistant 记录且 assistant content 非空（不再是
`files.length > 0` 的存在性判据，那对「会话创建时写下的空壳」也会通过）。（M1 时该目录为空 ——
§6 / §11.3；发了真 prompt 才有文件，该遗留项就此关闭。）

### 12.5 整轮耗时与 flake

口径：mocha 自报的套件时长（`12 passing (Ns)`），不含构建，也不是 shell 墙钟。

- 含构建：**完整路径未计时**。`pnpm run test:e2e` 会先跑 `build:e2e`（只重打测试包），再由 runner
  在不带 `--skip-build` 时跑 webview/扩展的完整构建；十次记录跑**没有一次走完这条路径**。记录跑里
  只有修复前/后的两次认证跑带了 `build:e2e` 这一步（命令形式
  `npm run build:e2e && node test/e2e/.build/runner.cjs --skip-build`），它们**只重打了测试包、
  不含 webview/扩展构建**；其套件时长为 **26s**（修复前）/ **36s**（修复后），与上面的口径一致
  （mocha 套件时长，不是含构建的墙钟）。
- `--skip-build`：**16s / 18s / 20s / 21s / 21s / 26s / 31s / 37s**（八次记录跑）。把十次记录跑
  放在一起看，套件时长范围 **16–37s**；慢跑由两个真 turn 的模型延迟主导。
- 连跑 3 次结果：**全绿**。abort 修复后连续 3 次 `12 passing` / `Exit code: 0`；加上修复后的
  认证跑与一次 `--keep` 复查，该状态共 **5 次**全绿。修复前也有 5 次全绿，但那时的 abort 判据
  是空洞的（见 12.3），所以「修复前全绿」不构成稳定性证据。

### 12.6 hydration 用例的实测载荷与覆盖边界

四个 hydration 响应的载荷（**记为 report-asserted**：来自 Task 4 报告对 `--keep` fixture 运行的
记录；该 fixture 在审查前已被清理，十份运行日志只留下 `[m2 finding]` 的键名行、不含这些载荷值，
审查者无法独立复核 —— 与 12.3 的 delta 计账同口径）：
`get_available_models` **73** 个模型；`get_available_thinking_levels` **6** 级；
`get_commands` **105** 条；`get_session_stats` **11** 个键（`assistantMessages, contextUsage,
cost, sessionFile, sessionId, tokens, toolCalls, toolResults, totalMessages, userMessages`），
其中 `contextUsage = {tokens, contextWindow, percent}`（`contextWindow` 991000）、`sessionFile`
是 fixture `pi-sessions/` 下的 `.jsonl` 路径。用例只断言四个响应存在且成功、models / levels /
commands 非空、`sessionFile` 是非空字符串；`contextUsage` 的形状只是本次记录，未进断言。

**覆盖边界（不得读成「等待逻辑已被证明」）：** 该用例**不可能**在没有真 hydration 的情况下
通过（日志按本次 run 定位、只解析入站行、只取 `success: true`），但在套件顺序上它**由历史
满足**：M1 的 pi 用例先打开会话并等过 pi 的首批响应，本用例开始时这四个响应已经在日志里 ——
每次运行打印的 `[m2 finding] hydration commands already logged` 都列着它们（还有
`get_messages`、`get_state`）。因此本用例的轮询路径、60s 预算与超时消息**从未执行**；它证明的
是「pi 答了什么、形状如何」，不是「等待会等」。要让轮询生效，需要一个强制重新 hydration 的
用例（例如让 webview `reload` 后再等一组新的响应计数）。

### 12.7 §11.4 遗留要求的收口

- 存活/收发判据已换成 rpcTrace 日志（§11.1 的通道）：所有等待都走 `waitForRpc`（每次重读、
  500ms 轮询，预算 60s/120s/30s），不再用 `ps` 匹配 argv。M1 的 pi 用例现在等的是「成功的
  `get_state` 响应里 pi 自报的模型 = 固定模型」——从「我们 spawn 的命令行」升级为「pi 自己说的」。
  Task 2 fix 轮的反证：临时清空 `pi-agent-chat.args` 的负跑 `exit 1`、`5 passing / 1 failing`，
  失败消息给出 pi 实际报告的模型（`/private/tmp/pi-e2e-fix-run-neg.log`）。
- 进程匹配（`isPiProcess`，`test/e2e/fixture.ts`）：长命令行分支保留，新增「trim 后等于裸 `pi`」
  分支；实测捕获到的进程标题正是 `pi` + 13 个空格，长分支在真实运行里从未命中 —— 与 §11.4 的
  根因一致。旧的 `findTestPiProcesses` 已由 `piProcessPids` 取代。
- 孤儿检查已是差分 PID：runner 启动前记基线，结束后只问「本次新起的 pid 是否还在」（有残留则
  exit 1），**基线里已有的**用户 pi 不会被误判。这只覆盖基线快照那一刻：pi 的进程标题恒为裸
  `pi`（§11.4），所以用户在运行期间新起的 pi 与 harness 孤儿无法区分，会被当作残留。
- 稳定性不再是顺序运气：Task 2 后 6 用例连跑 3 次全绿，M2 完成后 12 用例在修复后连续 3 次
  全绿（见 12.5）。这里收口的是 §11.4 那个**进程检测**窗口（`ps` 只在 pi 重写标题前的几百
  毫秒内命中带参数的 argv），它已随存活判据换成 rpcTrace 而消失；这不是说整套用例不再有
  顺序依赖 —— §12.6 记录的 hydration 用例仍由前序用例留下的历史响应满足。

### 12.8 Task 7 fix wave：abort / 会话文件断言升级 + 文档修正实测

Task 7 把 §12.3 里「已存在但尚未成为用例」的观测落成断言，并修正了 §12.2 / §12.4 / §12.7
的错误与过绝对表述。

**断言改动。** abort 用例在 freeze 断言之后追加：会话文件里**最后一条 assistant 记录的
`stopReason` 为 `"aborted"`**；abort 响应的等待改为计数增长（`abortsBefore`，与
`deltasBeforePrompt` 同法）。会话文件用例从「文件数 > 0」升级为解码 JSONL：断言每行可解析、
存在 user / assistant 记录、最后一条 assistant 的 content 非空。两处共用 harness 的
`readTranscripts`。

**读文件不需要额外等待（实测）。** 5ms 粒度下 pi 先写会话文件、再在 stdout 发 turn 收尾事件：
turn 1 文件 +28.210s 对 `message_end` +28.212s；turn 2（abort）文件 +31.498s 对 `message_end`
+31.499s。套件只在这些事件经扩展宿主落进 trace 之后才读文件，所以裸读不会与 pi 的写竞争。

**新断言的反证（`/private/tmp/m2-task7-falsify.log`，runner `Exit code: 1`）。** 临时改动两处：
(a) abort 用例不发 abort，改为等模型自己收尾；(b) 会话文件用例只读一个仅含 session 头的 stub。
结果 **10 passing / 2 failing**：freeze 断言照常通过，新 `stopReason` 断言以
`'stop' !== 'aborted'` 失败，stub 断言以 `expected a user record` 失败 —— 正是两条旧判据都会
放过的情形。该次失败的 fixture 被 runner 保留（路径见日志），其会话文件第 6 行是
`stopReason: "stop"`；反证改动的源码已还原（md5 与改动前一致）。

**修复后复测。** 命令 `npm run build:e2e && node test/e2e/.build/runner.cjs --skip-build`，exit
code 直接捕获，连跑三次全绿：

| 运行                | 日志                                      | 套件 | abort 用例 | 结果                  |
| ------------------- | ----------------------------------------- | ---- | ---------- | --------------------- |
| 基线（加 `--keep`） | `/private/tmp/m2-task7-baseline-keep.log` | 26s  | 10072ms    | `12 passing` / exit 0 |
| run 1               | `/private/tmp/m2-task7-run1.log`          | 41s  | 17274ms    | `12 passing` / exit 0 |
| run 2               | `/private/tmp/m2-task7-run2.log`          | 21s  | 10066ms    | `12 passing` / exit 0 |
| run 3               | `/private/tmp/m2-task7-run3.log`          | 22s  | 10578ms    | `12 passing` / exit 0 |

四次运行的收尾孤儿检查均无残留输出；`npm run lint`（含 `oxfmt --check .`）exit 0。这组复测也是
上面 §12.2 那条交叉引用与本节 10.1–17.3s 的来源。
