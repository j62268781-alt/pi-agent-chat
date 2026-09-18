# VS Code 端到端测试 harness 设计

日期：2026-09-18
状态：设计已确认，待写实施计划
适用范围：`pi-agent-chat`（VS Code 扩展 + Vue 3 webview + `pi --mode rpc` 子进程）

## 1. 背景与目标

仓库目前只有两个单测文件（`src/services/bridge/bind.test.ts`、`endpoint.test.ts`），
没有任何端到端测试设施。最近几个 commit 改的全是 webview UI 行为（权限对话框、
context chips、图片 lightbox 多步进、代码块渲染），恰恰是完全没被覆盖的部分。

目标：搭一套在**本地**运行的端到端测试，启动一个隔离的 VS Code 实例、加载真实构建
产物、跑**真实 pi**，对功能行为做结构化断言。

### 已锁定的决策

| 决策项             | 结论                                                                                |
| ------------------ | ----------------------------------------------------------------------------------- |
| 运行场所           | 本地手动运行，**不进 CI**（因此不需要 xvfb / `--no-sandbox`）                       |
| pi                 | **真 pi**，不用假 pi 桩                                                             |
| 模型               | pin `solar/qoder/qwen3.8-flash`                                                     |
| 断言策略           | **只断言结构，不断言文本** —— 不校验模型具体说了什么                                |
| VS Code 可执行文件 | 复用已安装的 `/Applications/Visual Studio Code.app`，零下载；钉版本下载留作可选开关 |
| 覆盖范围           | 全量功能面，分 M1–M4 四个里程碑                                                     |
| 技术路线           | `@vscode/test-electron` + Mocha（否决了 `extester`/WebDriver 方案）                 |

### 明确不做

- 不进 CI，不做 GitHub Actions 集成
- 不做视觉回归 / 截图像素比对
- 不引入假 pi 桩作为主路径（M3 之后**可能**作为补充层重新评估，见 §5.2）
- 不修 `package.json:45-46` 那两个坏掉的 npm script（`install-local`、`release` 指向的
  `scripts/*.mjs` 从不存在），那是独立问题

## 2. 已验证的事实

以下是设计所依赖的实测数据，不是推测。

> 本机专属路径已泛化：正文用 `~`，需要绝对路径的地方（如 `pi-agent-chat.path` 的示例）
> 用 `/Users/<you>/...`。数值与版本号均为实测原值。

### 2.1 pi 与模型可用性

- pi 位于 `~/.local/bin/pi`，版本 `0.85.1`，与依赖 `^0.85.1` 一致
- `pi auth check --provider solar --json` → `{"status":"ready","provider":"solar","authType":"api_key"}`
- `~/.pi/agent/models.json` 里 `providers.solar` 下的模型 id（注意带 `qoder/` 前缀）：
  `deepseek-v4.1-flash`、`glm-5.3-flash`、`qoder/deepseek-flash`、`qoder/glm-5.3`、
  `qoder/glm-5.3-flash`、`qoder/kimi-k2.8-preview`、`qoder/kimi-k3`、
  `qoder/qwen3.8-flash`、`qoder/qwen3.8-max`
- 实测可用性（`pi --model <m> --no-session --no-tools --print "reply with exactly: OK"`）：

  | 模型                        | 结果                                                                                                                         |
  | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
  | `solar/qoder/qwen3.8-max`   | ✗ `404 model_not_found`：_"is not supported by any configured account in this group"_ —— 目录里有该 id，但当前账号组未开权限 |
  | `solar/qoder/qwen3.8-flash` | ✓                                                                                                                            |
  | `solar/qoder/glm-5.3-flash` | ✓                                                                                                                            |
  | `solar/deepseek-v4.1-flash` | ✓                                                                                                                            |

- **延迟基线**：`solar/qoder/qwen3.8-flash` 回一句 `OK`，`--no-session --no-tools`，
  实测 **20.367s**。开启工具、给真实工作区只会更慢。这是整个套件时序预算的依据。

### 2.2 本机 VS Code

- `/Applications/Visual Studio Code.app`，版本 `1.138.0`，quality `stable`，commit `7debcd0e`，
  arm64，占 901MB。满足 `engines.vscode: ^1.100.0`
- `code` CLI **不在** PATH 上
- 仓库无 `.vscode-test/`，`.gitignore` 也没有该条目
- 已有 `.vscode/launch.json` 两个 `extensionHost` 配置（"Run Extension" 带
  `preLaunchTask: build`、"Run Extension (skip build)"）—— 与本方案同一机制

### 2.3 构建与测试现状

- `rolldown.config.ts`：入口 `src/extension.ts` → `dist/extension.cjs`，`format: "cjs"`、
  `platform: "node"`、`external: ["vscode"]`；自定义 `rawAssetPlugin`（`rolldown.config.ts:13-25`）
  实现 `?raw` 导入
- `?raw` 导入点：`src/providers/chat/webview-html.ts:4` → `../../../webview-vue/dist/chat/index.html?raw`；
  `src/providers/settings/webview-html.ts:1` → `dist/settings/index.html?raw`
- **硬构建顺序**：`pnpm build` = `build:webview && build:extension`。webview dist 不存在时
  rolldown 会失败 → e2e 运行前必须先构建 webview
- 无 vitest 配置文件（根目录和 `webview-vue/` 都没有），`test:unit` 就是裸 `vitest run`
- `jsdom` 是根 devDependency 但**全仓未被引用**
- CI：`.github/workflows/ci.yml`（ubuntu-latest、Node 24；`verify` job 跑
  lint → typecheck → test:unit → build；`package` job 出 vsix）+ `release.yml`
- 仓库内**无** AGENTS.md / CLAUDE.md / qoder.md

### 2.4 既有测试的房屋风格（新测试须遵循）

从 `bind.test.ts` / `endpoint.test.ts` 归纳：

- 命名 `<module>.test.ts`，与被测源码同目录
- 导入用显式 `.ts` 后缀（对应 tsconfig 的 `allowImportingTsExtensions`）
- 从 `"vitest"` 具名导入 `{ describe, expect, it, afterEach }`，不启用 globals
- **不用 mock**：零 `vi.mock` / `vi.fn`，一律用真实原语（真 `node:http`、真 fs、
  `mkdtempSync(join(tmpdir(), "pi-bridge-"))`）
- 平台差异通过**函数参数注入**而非 mock：`bindServer(..., "win32")`、
  `unlinkStaleSocket(socketPath, "win32")`
- 能力探测 + 跳过而非假设：顶层 `await` 探测在沙箱禁止 loopback listen 时跳过整个
  TCP suite（`bind.test.ts:11-17`）、`describe.skipIf(!posixOnly)`、
  容错错误码 `expect.stringMatching(/^(ENOENT|EACCES|EPERM)$/)`；每处 skip 都有注释说明原因
- 资源卫生：tracked `servers[]` 数组 + `newServer()` helper + `afterEach` 全关；
  `freePort()` helper 故意不进 tracked 数组
- 无假定时器，只用真实 async/promise
- 断言：纯函数用 `toEqual` 整体相等；副作用用 `toBe` / `toBeGreaterThan` / `rejects.toMatchObject`

## 3. 架构

### 3.1 目录布局

```
test/e2e/
  run.mjs                    # 外层：build webview → build extension → 生成 fixture → runTests → 清理
  rolldown.config.ts         # 把 suite 打成 CJS
  .build/suite.cjs           # 产物，gitignore
  fixture/                   # 每次运行在 tmpdir 生成，不进仓库
    workspace/.vscode/settings.json
  suite/
    index.ts                 # mocha 入口
    harness.ts               # 启动参数、等待器、临时目录生命周期
    pi.ts                    # 读 pi 会话文件做断言
    cases/
      m1-bootstrap.test.ts
      m2-turn.test.ts
      m3-render.test.ts
      m4-surfaces.test.ts
```

fixture 工作区**必须运行时生成**而非静态提交：`PI_CODING_AGENT_SESSION_DIR` 等路径
只有运行时才知道。

### 3.2 障碍①：测试文件怎么编译

仓库是 `type: "module"`、tsconfig 是 `noEmit`、现有测试用显式 `.ts` 后缀导入，
而 `@vscode/test-electron` 的 mocha runner 默认用 CJS `require()` 加载测试文件。

**方案：用 rolldown 把 `suite/index.ts` 打包成 CJS。**

- `format: "cjs"`、`platform: "node"`、`external: ["vscode", "mocha"]`
- 输出 `test/e2e/.build/suite.cjs`，该路径传给 `extensionTestsPath`
- rolldown 已是 devDependency，扩展本体就是这么打的，且能正确解析 `.ts` 后缀导入

不引入 esbuild / tsc emit（`allowImportingTsExtensions` 与 tsc emit 互斥）。

### 3.3 障碍②：pi 状态隔离

真 pi 默认读写 `~/.pi/agent/`（会话、快照、设置、凭据），那是与日常使用共享的状态。
另一方面，**扩展宿主侧是硬编码 `homedir()` 的**，不认 `PI_CODING_AGENT_DIR`：

- `src/services/models/auth-config.ts:34` → `~/.pi/agent/auth.json`
- `src/services/settings/settings-config.ts:58` → `~/.pi/agent/settings.json`
- `src/services/models/models-config.ts:6` → `~/.pi/agent/models.json`
- `src/providers/chat/rewind-provider.ts:25` → `~/.pi/snapshots/<session>/<hash>`
- `src/services/mcp/mcp-config.ts:39` → `~/.agents/mcp.json`
- `src/services/skills/skills-config.ts:32` → `~/.agents/skills`

pi 侧可用的隔离杠杆（来自 `pi --help`）：

- `PI_CODING_AGENT_DIR` —— 配置目录，默认 `~/.pi/agent`
- `PI_CODING_AGENT_SESSION_DIR` —— 会话存储目录（被 `--session-dir` 覆盖）
- `PI_OFFLINE=1` —— 禁用启动期网络操作
- flags：`--session-dir <dir>`、`--no-session`、`--provider`、`--model`、`--api-key`

**M1–M3 采用的方案：只重定向会话目录，不换 `HOME`。**
通过 fixture `settings.json` 的 `pi-agent-chat.env` 注入 `PI_CODING_AGENT_SESSION_DIR`。
理由：`createRpcEnvironment`（`src/services/rpc/process.ts:158-166`、`104-125`）会把
`pi-agent-chat.env` 合并进去，而 `PI_CODING_AGENT_SESSION_DIR` **不在**扩展自己注入的
那几个变量里（`PI_VSCODE_STATUS_BAR`、`PI_VSCODE_DISABLED_TOOLS`、`PI_VSCODE_PERMISSION`、
`PI_VSCODE_BRIDGE_TOKEN`、`PI_VSCODE_BRIDGE_SOCKET`/`URL`），所以不会被覆盖。
且它是普通用户设置，不是测试专用后门。

宿主侧仍读真实 `~/.pi/agent/` 的 models/settings（只读，无害）。
`~/.pi/agent/settings.json` 的**写入**只在设置面板保存时发生 → 推迟到 M4 处理（见 §5）。

### 3.4 障碍③：webview 内部怎么观测

VS Code 没有公开 API 能查询 webview DOM（独立 iframe）。宿主↔webview 是一对干净的
`postMessage` / `onDidReceiveMessage`，抽象在 `chat-session.ts:41-42` 的 `host` 接口后面。

**分两招，按里程碑递进：**

**M2 —— 零侵入：读 pi 会话文件。** pi 会把完整对话写进会话文件（即被重定向到 tmpdir
的那个）。直接读它即可验证 turn 真的发生、工具真的调用，完全不碰生产代码。

**M3 —— 受门控的探针命令。** 注册 `pi-agent-chat.__probe`，条件是
`context.extensionMode !== vscode.ExtensionMode.Production`。行为：向当前 chat webview
发 `{type: "__probe", requestId}`，webview 回 `{type: "__probeResult", requestId, snapshot}`。

`snapshot` 的内容以 **Pinia store 摘要为主**（消息列表结构、dialog 状态、chips、
lightbox 开关），辅以少量 DOM 事实（KaTeX / Mermaid 的 svg 是否存在、气泡元素计数）。
断言 store 结构比断言渲染文本稳定得多，正好匹配「只断言结构不断言文本」。

从 vsix 安装时 `extensionMode` 为 `Production`，故发布产物中该路径是死代码。
改动面：`src/protocol/messages.ts` 加一对消息类型、Vue 侧加一个 responder、
`src/extension.ts` 加一处受门控的注册。仓库当前**完全没有** `extensionMode` 的使用，
这是首次引入。

### 3.5 启动配置

```js
await runTests({
  vscodeExecutablePath: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
  extensionDevelopmentPath: repoRoot,
  extensionTestsPath: "test/e2e/.build/suite.cjs",
  launchArgs: [
    fixtureWorkspace,
    "--user-data-dir",
    tmpUserData,
    "--extensions-dir",
    tmpExtensions,
    "--disable-extensions",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--new-window",
  ],
  extensionTestsEnv: {
    PI_CODING_AGENT_SESSION_DIR: tmpSessions,
    PI_OFFLINE: "1",
  },
});
```

`--user-data-dir` / `--extensions-dir` 指向临时目录 ⇒ 不碰日常 VS Code 的配置、扩展、
登录态。VS Code 二进制本身无状态，所有状态都在这两个目录里，因此可以与日常 VS Code
同时运行（与 F5 起 Extension Development Host 同机制）。

生成的 fixture `.vscode/settings.json` 需包含：

```jsonc
{
  "pi-agent-chat.path": "/Users/<you>/.local/bin/pi",
  "pi-agent-chat.ui": "sidebar",
  "pi-agent-chat.args": ["--model", "solar/qoder/qwen3.8-flash"],
  "pi-agent-chat.env": {
    "PI_CODING_AGENT_SESSION_DIR": "<tmpdir>/sessions",
    "PI_OFFLINE": "1",
  },
  "pi-agent-chat.rpcTrace": true,
}
```

`path` 与 `args` **必须在激活前就位**：二进制路径解析结果有缓存，只在
`pi-agent-chat.path` 的配置变更事件里失效（`src/extension.ts:83`）。
`ensurePiBinary`（`process.ts:55-71`）要求文件可执行（`X_OK`），失败时**静默返回
`undefined`**、聊天面板悄悄不打开且不抛错 —— 所以「pi 没起来」的表现是无异常，
断言必须主动验证而不是等报错。

`rpcTrace: true` 会把 JSONL 镜像到输出通道 "Pi Chat RPC"，调试用。

### 3.6 时序预算

- 真 pi 一个 turn ≥ 20s（实测基线，最简情形）
- Mocha 默认超时 2s，必须显式放宽：hydration 30s、单个 prompt turn 120s
- **关键约束：一次 VS Code 启动跑完整个 suite**（`runTests` 本身开销大），
  pi 会话在用例间尽量复用，**不要每个用例 spawn 一次 pi**
- 注意 `ui: "sidebar"` 时侧边栏在 `resolveWebviewView` 里会**自动起会话**并恢复工作区
  最近一次会话（`chat-sidebar.ts:107-124`、`184-248`），且 `sidebarState` 是模块级的，
  关掉视图后 pi 进程仍存活
- 注意 `ui: "webview"` 时激活阶段就会恢复被跟踪的面板（`extension.ts:59`、`102-113`），
  可能在 activate 时就 spawn pi

### 3.7 RPC 协议参考（断言与 M3 探针都要用）

- spawn：`src/services/rpc/client.ts:41-49`；args 组装：`process.ts:128-155`，形如
  `[--session <file>] -e <ext>/pi-extensions/pi-vscode-bridge.js -e .../questionnaire.ts
-e .../permission-gate.ts -e .../rewind-code.ts --mode rpc <pi-agent-chat.args...>`
- 二进制解析：`binary.ts:25-84`，`pi-agent-chat.path` 优先且原样返回（`binary.ts:40-50`）
- 帧格式：双向换行分隔 JSON（`attachJsonlReader`，`client.ts:59-115`）；请求
  `{...command, id: randomUUID()}`；响应按 id 匹配；`type: "extension_ui_request"`
  路由到 handler；其余为事件；stderr 只进 trace 通道
- 关键类型：`RpcResponse`（`src/protocol/rpc.ts:87-94`）、`ExtensionUiRequest`
  （`rpc.ts:139-153`，method ∈ `select|confirm|input|editor|notify|setStatus|setWidget|
setTitle|set_editor_text`）、`RpcState`（`rpc.ts:66-77`）
- **hydration 突发**（`chat-session.ts:567-613`）：并行 `get_state`、
  `get_available_models`、`get_available_thinking_levels`、`get_commands`，
  随后 `get_messages`、`get_session_stats`。这些没回来 UI 就停在 splash
- postMessage 协议：`src/protocol/messages.ts:84-177`（`WebviewToExt` / `ExtToWebview`），
  事件清单在 `messages.ts:190-204`
- 对话框链路：pi 的 `extension_ui_request` → webview `dialog`，用户选择经
  `dialogResponse` → `extension_ui_response`（`chat-session.ts:952-958`）
- 权限门**在 pi 内部执行**，不在扩展宿主：`pi-extensions/permission-gate.ts` 读
  spawn 时注入的 `PI_VSCODE_PERMISSION`（`process.ts:112-117`），只对 `bash` 工具挂
  `tool_call` 钩子，通过 `ctx.ui.select` 提问 → 表现为 `extension_ui_request`。
  宿主只读 `permission.mode` 镜像给 UI（`chat-session.ts:584-589`），并把 `setPermission`
  当作 `/permission <mode>` slash 命令发出去（`chat-session.ts:1057-1061`）
- 编辑器 bridge：`src/services/bridge/server.ts:14-134`，单个 `POST /rpc` 端点，
  鉴权头 `x-pi-vscode-authorization: <token>`（randomUUID），body `{method, params}` →
  `{result}` 或 `{error}`；`bridgeSocket` 为空时用随机 TCP 端口（测试保持默认即可）

## 4. 里程碑

|        | 目标             | 碰生产代码   | 真 LLM 调用 |
| ------ | ---------------- | ------------ | ----------- |
| **M1** | harness 骨架跑通 | 否           | 否          |
| **M2** | 真 pi 完整 turn  | 否           | 是，少量    |
| **M3** | 探针 + 渲染层    | 是（受门控） | 是          |
| **M4** | 全量功能面       | 可能         | 是          |

### M1 —— harness 骨架

**交付物**：`@vscode/test-electron` + `@types/mocha` devDeps；`test/e2e/run.mjs`；
`test/e2e/rolldown.config.ts`；`suite/index.ts`、`suite/harness.ts`；`test:e2e` npm script；
`.gitignore` 加 `test/e2e/.build/`（若启用下载再加 `.vscode-test/`）。

**用例**（全部宿主侧可观测，不需要探针）：

1. 扩展激活：`vscode.extensions.get("johnny-zhao.pi-agent-chat").isActive === true`
2. `contributes.commands` 里 11 个命令全部注册（`vscode.commands.getCommands(true)`）：
   `open`、`openSettingsJson`、`openModelsJson`、`openSettings`、`openInNewWindow`、
   `openInFolder`、`openInSidebar`、`addSelectionToChat`、`addFileToChat`、
   `generateGitCommitMessage`、`abortGitCommitMessage`
3. `pi-agent-chat.openInSidebar` 后侧边栏视图可见
4. pi 子进程真的起来了 —— 证据是 `PI_CODING_AGENT_SESSION_DIR` 指向的 tmpdir 里出现会话文件
5. 收尾后无孤儿 pi 进程

**必须在 M1 打掉的不确定项**：

- `extensionTestsEnv` 是否真的传到扩展宿主进程（决定 M4 的 `HOME` 覆盖方案可行性）
- `PI_OFFLINE=1` 会不会连 LLM 请求一起挡掉（文档只说 "startup network operations"，未实测）
- `--disable-workspace-trust` 是否足以免掉信任弹窗
- 复用已装 VS Code 1.138.0 + `--extensions-dir` 指空目录，能否干净加载开发扩展
- pnpm 的 `onlyBuiltDependencies` 白名单（当前只有 `esbuild`）是否会拦掉
  `@vscode/test-electron` 的 postinstall 下载 —— 若改用 `vscodeExecutablePath` 复用本机
  VS Code 则不触发下载，可能绕过该问题

**通过标准**：干净 checkout 上 `pnpm test:e2e` 绿；跑完 `ps` 无残留 pi / VS Code 进程；
上述 5 个不确定项全部有书面结论。

### M2 —— 真 pi 一个完整 turn

**用例**：

1. 发一个最小 prompt，断言事件序列 `agent_start` → `message_start/update/end` → `agent_settled`
2. 断言 hydration 拿到非空的 `models` / `thinkingLevels` / `commands`
3. 断言流式中途 `abort` 真的返回 `{cancelled: true}`
4. 断言 `contextUsage` / session stats 到位

**断言数据来源**：pi 写的会话文件（`suite/pi.ts`）+ 宿主侧 RPC 事件。**不引入探针。**

**通过标准**：同一用例连跑 3 次不 flake。

### M3 —— 探针 + 渲染层

**交付物**：受门控的 `pi-agent-chat.__probe` 命令、`__probe` / `__probeResult`
消息类型、Vue 侧 snapshot responder。

**用例**（覆盖最近几个 commit 的行为）：

1. assistant 气泡进入 store
2. 代码块结构正确
3. KaTeX：数学 prompt 后 svg 存在
4. Mermaid：svg 存在 + 五主题切换（`default`/`neutral`/`dark`/`forest`/`base`）
5. 图片 lightbox 多图步进
6. context chips 渲染
7. **权限对话框**：真 pi + 触发 `bash` 工具调用的 prompt + `permission.mode: AskForApproval`，
   断言 `extension_ui_request` / `method: "select"` 变成了 webview 的 `dialog`，
   且 `dialogResponse` 能回成 `extension_ui_response`

**通过标准**：最近 5 个 commit 涉及的每个行为至少有一条结构断言。

### M4 —— 全量功能面

**用例域**：

- 会话生命周期：new / list / switch / delete / fork / rewind-revert
- 面板形态：`ui: "webview"` 编辑器面板、`openInNewWindow`、启动时面板恢复
- add-to-chat：选区、文件（命令 + context chips 联动）
- git commit：生成与中止（需要一个带暂存改动的 fixture git 仓库）
- 设置面板：tab 渲染、`models.json` 读取、保存往返
- bridge：`addSelectionToChat` 往返、`/rpc` 端点 token 鉴权
- 配置矩阵：`contributes.configuration` 全部 24 项 —— `language`(auto/en/zh-cn)、`path`、
  `bridgeSocket`、`env`、`args`、`commitLanguage`、`commitMessagePrompt`、`commitModel`、
  `ui`、`disabledTools`、`permission.mode`、`permission.dangerousPatterns`、`rpcTrace`、
  `chatFontSize`、`chatSendShortcut`、`chatRunningSendBehavior`、`chatCollapseWork`、
  `chatShowToolCallCount`、`chatExpandToolCalls`、`chatExpandThinking`、
  `chatKeepReadingAnchor`、`chatMermaidTheme`、`chatBackgroundImage`、`chatBackgroundOpacity`

**通过标准**：`contributes` 里每个命令与每个配置项都有用例，或被明确列为「不可测 + 原因」。

## 5. 待决问题

### 5.1 M4 的凭据隔离（需你拍板，我不替你定）

设置面板保存会写 `~/.pi/agent/settings.json`，而宿主侧硬编码 `homedir()`
（`settings-config.ts:58`），不认 `PI_CODING_AGENT_DIR`。要安全测试保存路径，
只能用 `extensionTestsEnv` 把整个 `HOME` 换成 fixture 目录 —— 而那意味着要把
`auth.json`（凭据）复制或软链进 fixture home。

三个选项：

1. **软链** `~/.pi/agent/auth.json` 进 fixture home —— 不复制凭据内容，但测试进程
   仍可读取；fixture home 需 `0700` 且运行后彻底删除
2. **复制** —— 更彻底隔离，但在磁盘上留了一份凭据副本
3. **跳过写入类用例** —— 设置面板只测读取与渲染，保存路径列为「不可测」

副带影响：换 `HOME` 也会改变 `binary.ts:27` 的 pi 查找路径、`~/.agents/mcp.json`、
`~/.agents/skills` 的解析结果，需要一并在 fixture 里准备好。

### 5.2 M3 之后是否补一层假 pi

真 pi 触发纯渲染行为（Mermaid 五主题、lightbox 多图步进、权限对话框各分支）既慢又碰运气。
一个说 JSONL 协议的假 pi（`pi-agent-chat.path` 指向可执行脚本，须 `chmod +x`）能做到
亚秒级、完全确定。代价是可能与真 pi 协议漂移，需靠「同一断言对两种 pi 都跑」的契约测试兜住。

M1–M3 不做。M3 落地后根据实际 flake 率与耗时再评估。

## 6. 风险

| 风险                                                    | 缓解                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 真 pi 慢导致套件耗时不可接受                            | 单次 VS Code 启动跑完全套；复用 pi 会话；M4 的配置矩阵尽量用不需要 prompt 的断言               |
| LLM 非确定性导致 flake                                  | 只断言结构不断言文本；通过标准里明确「连跑 3 次不 flake」                                      |
| `solar` 账号组权限变动使模型失效                        | 模型 id 集中在 fixture 生成逻辑一处；M1 加一条「模型可用」前置探测，失败时给出明确报错而非超时 |
| pi 静默失败（`ensurePiBinary` 返回 `undefined` 不抛错） | 断言主动验证会话文件出现，不依赖异常                                                           |
| 复用本机 VS Code 版本漂移                               | 保留「下载并钉版本」为可选开关                                                                 |
| 孤儿进程 / 临时目录残留                                 | harness 统一注册清理，`after` 钩子兜底；M1 通过标准包含 `ps` 检查                              |
| 探针钩子意外进入发布产物                                | `extensionMode !== Production` 门控 + M3 加一条断言验证 Production 模式下命令未注册            |
