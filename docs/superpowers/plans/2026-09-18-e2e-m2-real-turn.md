# E2E 测试 harness — M2 真 pi 完整 turn 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 e2e 套件能对真实 pi 发出一个 prompt，并用宿主侧可读的结构化证据断言完整 turn 的事件序列、取消行为与会话落盘。

**Architecture:** 观测走 `pi-agent-chat.rpcTrace` 输出通道落盘的双向 JSONL 日志（`src/services/rpc/client.ts:132`/`:88`/`:114`），刺激走一个仅在非 Production 模式注册的受门控命令。进程级检测不再依赖 argv（pi 会重写进程标题），改为差分 PID。

**Tech Stack:** `@vscode/test-electron@3.1.0`、`mocha@12`、`rolldown`、`vitest@4`、真实 pi `0.85.1`（`node_modules/.bin/pi`）。

**Spec:** `docs/superpowers/specs/2026-09-18-vscode-e2e-test-harness-design.md`
**前置实测记录（必读）:** `test/e2e/FINDINGS.md`，尤其 §11（rpcTrace 可读性、pi 首响应 4.5s、进程标题重写、孤儿检查缺陷）

## Global Constraints

- 本地手动运行，**不进 CI**；不改 `.github/workflows/*`
- 真 pi，模型 pin **`solar/qoder/qwen3.8-flash`**（`qwen3.8-max` 账号组未开权限）
- **只断言结构，不断言文本** —— 不得断言模型回复的具体内容
- **所有 git commit 必须先征得用户同意**。用户已明确不提交，故本计划所有 commit 步骤默认跳过，改动留在工作树
- 本地一律用 `npm run <script>`（本机 pnpm 已装但仓库脚本用 `pnpm run`，两者皆可；M1 期间统一用 npm）
- 每步验证都要看**退出码**，不要用 `| tail` 掩盖它（M1 期间踩过：`${PIPESTATUS[0]}` 在 zsh 下为空）
- mocha 输出带 ANSI 色码，日志里 grep 不要用 `^` 锚定
- 时序：pi 首次 RPC 响应约 **4.5s**；单个真 prompt turn 预算 **120s**
- 改动生产代码是本计划**有意为之的偏离**，理由见 Self-Review §偏离说明

---

## File Structure

```
test/e2e/
  rpc-log.ts                    # 新建：定位并解析 "Pi Chat RPC" 日志
  rpc-log.test.ts               # 新建：解析器的 vitest 单测
  fixture.ts                    # 修改：进程匹配改成标题感知 + 暴露 PID
  fixture.test.ts               # 修改：同步匹配器单测
  runner.ts                     # 修改：传 PI_E2E_USER_DATA；孤儿检查改差分 PID
  suite/
    harness.ts                  # 修改：加 trace 等待器
    cases/
      m1-bootstrap.test.ts      # 修改：存活信号换成 trace
      m2-turn.test.ts           # 新建：M2 用例

src/
  commands/testing-gate.ts      # 新建：可单测的注册判定（不 import vscode）
  commands/testing-gate.test.ts # 新建：判定逻辑的 vitest 单测
  commands/testing.ts           # 新建：受门控的刺激命令
  commands/index.ts             # **不改**（见 Task 3 Step 7 的说明）
  providers/chat/chat-session.ts # 修改：ChatSession 增加 sendFromWebview
  extension.ts                  # 修改：按 extensionMode 注册刺激命令
```

**职责边界：** `rpc-log.ts` 只做「找文件 + 解析行」，不关心断言；`harness.ts` 在其上加等待语义；用例文件只写断言。`commands/testing-gate.ts` 刻意不 import `vscode`，这样判定逻辑能被 vitest 直接测到。

---

### Task 1: rpcTrace 日志解析器

**Files:**

- Create: `test/e2e/rpc-log.ts`
- Test: `test/e2e/rpc-log.test.ts`

**Interfaces:**

- Consumes: 无
- Produces（Task 4/5 依赖，签名必须一致）:
  - `interface RpcTraceEntry { tag: string; direction: "out" | "in" | "err"; raw: string; json?: unknown }`
  - `parseRpcTrace(text: string): RpcTraceEntry[]`
  - `findRpcLogPath(userDataDir: string): string | undefined`
  - `readRpcTrace(userDataDir: string): RpcTraceEntry[]`
  - `inboundResponses(entries: RpcTraceEntry[]): Array<{ command: string; success: boolean; data: unknown }>`
  - `inboundEvents(entries: RpcTraceEntry[]): string[]`（入站里 `type` 不是 `response` 也不是 `extension_ui_request` 的那些，返回其 `type`）
  - `inboundUiRequests(entries: RpcTraceEntry[]): Array<{ method: string }>`

- [ ] **Step 1: 写失败的单测 `test/e2e/rpc-log.test.ts`**

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findRpcLogPath,
  inboundEvents,
  inboundResponses,
  inboundUiRequests,
  parseRpcTrace,
} from "./rpc-log.ts";

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-rpclog-"));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

// Shapes copied verbatim from a real run (FINDINGS §11.1).
const SAMPLE = [
  '[sidebar] -> {"type":"get_state","id":"a1"}',
  '[sidebar] <- {"id":"a1","type":"response","command":"get_state","success":true,"data":{"messageCount":0}}',
  '[sidebar] <- {"type":"extension_ui_request","id":"u1","method":"setStatus","statusKey":"pi-lens-lsp"}',
  '[sidebar] <- {"type":"agent_start"}',
  '[sidebar] -> {"type":"prompt","id":"a2","message":"hi"}',
  '[sidebar] <- {"id":"a2","type":"response","command":"prompt","success":true}',
  "[sidebar] [err] some stderr noise",
].join("\n");

describe("parseRpcTrace", () => {
  it("splits tag, direction and raw payload", () => {
    const entries = parseRpcTrace(SAMPLE);
    expect(entries).toHaveLength(7);
    // Out lines are `JSON.stringify(command)` (src/services/rpc/client.ts:132),
    // so they carry a parsed `json` exactly like inbound lines do.
    expect(entries[0]).toEqual({
      tag: "sidebar",
      direction: "out",
      raw: '{"type":"get_state","id":"a1"}',
      json: { type: "get_state", id: "a1" },
    });
    expect(entries[2]?.direction).toBe("in");
    expect(entries[6]).toEqual({ tag: "sidebar", direction: "err", raw: "some stderr noise" });
  });

  it("parses JSON payloads and tolerates non-JSON", () => {
    const entries = parseRpcTrace(SAMPLE);
    expect(entries[1]?.json).toMatchObject({ type: "response", command: "get_state" });
    expect(entries[6]?.json).toBeUndefined();
  });

  it("ignores blank lines and trailing whitespace", () => {
    expect(parseRpcTrace("\n[sidebar] -> {}\n\n  \n")).toHaveLength(1);
  });

  it("accepts an untagged line without throwing", () => {
    // The channel can contain lines the extension did not format.
    expect(parseRpcTrace("just some text")).toEqual([
      { tag: "", direction: "err", raw: "just some text" },
    ]);
  });
});

describe("inbound selectors", () => {
  const entries = parseRpcTrace(SAMPLE);

  it("extracts successful responses with their command and data", () => {
    expect(inboundResponses(entries)).toEqual([
      { command: "get_state", success: true, data: { messageCount: 0 } },
      { command: "prompt", success: true, data: undefined },
    ]);
  });

  it("extracts agent events, excluding responses and ui requests", () => {
    expect(inboundEvents(entries)).toEqual(["agent_start"]);
  });

  it("extracts extension_ui_request methods", () => {
    expect(inboundUiRequests(entries)).toEqual([{ method: "setStatus" }]);
  });
});

describe("findRpcLogPath", () => {
  it("finds the channel log nested under logs/<ts>/window1/exthost/output_logging_<ts>", () => {
    const userData = tempDir();
    const dir = join(
      userData,
      "logs",
      "20260918T174115",
      "window1",
      "exthost",
      "output_logging_20260918T174117",
    );
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "1-Pi Chat RPC.log");
    writeFileSync(file, SAMPLE);

    expect(findRpcLogPath(userData)).toBe(file);
  });

  it("returns undefined when no log exists yet", () => {
    expect(findRpcLogPath(tempDir())).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/e2e/rpc-log.test.ts`
Expected: FAIL，`Cannot find module './rpc-log.ts'`

- [ ] **Step 3: 写 `test/e2e/rpc-log.ts`**

```ts
// Reader for the `pi-agent-chat.rpcTrace` output channel as it lands on disk.
//
// The channel mirrors every direction of the pi RPC conversation
// (src/services/rpc/client.ts:132 writes `out`, :88 writes each stdout line as
// `in`, :114 writes stderr as `[err]`), which makes this log the only
// host-side record of what the extension actually saw. It is also a better
// liveness signal than scanning processes: pi rewrites its own process title,
// so argv-based matching only works for a few hundred milliseconds after spawn
// (FINDINGS §11.4).
//
// Caveat that callers must respect: the channel is flushed asynchronously, so a
// run that exits quickly leaves a truncated file (FINDINGS §11.1).

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface RpcTraceEntry {
  tag: string;
  direction: "out" | "in" | "err";
  raw: string;
  json?: unknown;
}

const CHANNEL_SUFFIX = "Pi Chat RPC.log";
const LINE = /^\[([^\]]*)\]\s+(->|<-|\[err\])\s?(.*)$/;

export function parseRpcTrace(text: string): RpcTraceEntry[] {
  const entries: RpcTraceEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const match = LINE.exec(line);
    if (!match) {
      // Not one of ours (or an older format): keep it as an err-direction
      // entry so nothing is silently dropped.
      entries.push({ tag: "", direction: "err", raw: line });
      continue;
    }
    const [, tag = "", arrow = "", raw = ""] = match;
    const direction: RpcTraceEntry["direction"] =
      arrow === "->" ? "out" : arrow === "<-" ? "in" : "err";
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      // stderr and non-JSON payloads stay as raw text.
    }
    entries.push({ tag, direction, raw, ...(json === undefined ? {} : { json }) });
  }
  return entries;
}

/** Newest channel log under `<userDataDir>/logs`, or undefined before any write. */
export function findRpcLogPath(userDataDir: string): string | undefined {
  const logsRoot = join(userDataDir, "logs");
  if (!existsSync(logsRoot)) return undefined;

  let newest: { path: string; mtimeMs: number } | undefined;
  for (const session of readdirSync(logsRoot)) {
    for (const windowName of readdirSync(join(logsRoot, session))) {
      const exthost = join(logsRoot, session, windowName, "exthost");
      if (!existsSync(exthost)) continue;
      for (const outputDir of readdirSync(exthost)) {
        if (!outputDir.startsWith("output_logging_")) continue;
        const dir = join(exthost, outputDir);
        for (const name of readdirSync(dir)) {
          if (!name.endsWith(CHANNEL_SUFFIX)) continue;
          const path = join(dir, name);
          const mtimeMs = statSync(path).mtimeMs;
          if (!newest || mtimeMs > newest.mtimeMs) newest = { path, mtimeMs };
        }
      }
    }
  }
  return newest?.path;
}

export function readRpcTrace(userDataDir: string): RpcTraceEntry[] {
  const path = findRpcLogPath(userDataDir);
  if (!path) return [];
  return parseRpcTrace(readFileSync(path, "utf8"));
}

interface ResponseShape {
  type?: unknown;
  command?: unknown;
  success?: unknown;
  data?: unknown;
}

export function inboundResponses(
  entries: RpcTraceEntry[],
): Array<{ command: string; success: boolean; data: unknown }> {
  const found: Array<{ command: string; success: boolean; data: unknown }> = [];
  for (const entry of entries) {
    if (entry.direction !== "in") continue;
    const shape = entry.json as ResponseShape | undefined;
    if (!shape || shape.type !== "response") continue;
    found.push({
      command: String(shape.command ?? ""),
      success: shape.success === true,
      data: shape.data,
    });
  }
  return found;
}

/** Inbound lines that are neither a response nor a UI request: pi's agent events. */
export function inboundEvents(entries: RpcTraceEntry[]): string[] {
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.direction !== "in") continue;
    const type = (entry.json as { type?: unknown } | undefined)?.type;
    if (typeof type !== "string") continue;
    if (type === "response" || type === "extension_ui_request") continue;
    found.push(type);
  }
  return found;
}

export function inboundUiRequests(entries: RpcTraceEntry[]): Array<{ method: string }> {
  const found: Array<{ method: string }> = [];
  for (const entry of entries) {
    if (entry.direction !== "in") continue;
    const shape = entry.json as { type?: unknown; method?: unknown } | undefined;
    if (shape?.type !== "extension_ui_request") continue;
    found.push({ method: String(shape.method ?? "") });
  }
  return found;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/e2e/rpc-log.test.ts`
Expected: PASS，9 个用例全绿

- [ ] **Step 5: 静态检查**

Run: `npm run fmt && npm run lint`
Expected: 均退出码 0

---

### Task 2: 修进程匹配 + 孤儿检查 + 存活信号换成 rpcTrace

**Files:**

- Modify: `test/e2e/fixture.ts`
- Modify: `test/e2e/fixture.test.ts`
- Modify: `test/e2e/runner.ts`
- Modify: `test/e2e/suite/harness.ts`
- Modify: `test/e2e/suite/cases/m1-bootstrap.test.ts`

**Interfaces:**

- Consumes: `readRpcTrace` / `RpcTraceEntry`（Task 1）
- Produces（Task 4/5 依赖）:
  - `interface RunningProcess { pid: number; command: string }`
  - `runningProcesses(): RunningProcess[]`
  - `isPiProcess(command: string): boolean`
  - `piProcessPids(processes?: RunningProcess[]): number[]`
  - `userDataDir(): string`、`rpcEntries(): RpcTraceEntry[]`、
    `waitForRpc(predicate, { timeoutMs, intervalMs?, what? }): Promise<RpcTraceEntry[]>`（harness）
  - （删除 `runningCommandLines()` 与 `findTestPiProcesses()`；本任务之后任何文件都不得再引用）
  - runner 传入 `extensionTestsEnv.PI_E2E_USER_DATA`

- [ ] **Step 1: 更新 `test/e2e/fixture.test.ts` 的匹配器单测**

把原 `findTestPiProcesses` 的 describe 整块替换为：

```ts
describe("isPiProcess", () => {
  it("matches the transient launcher argv that carries the fixture args", () => {
    expect(
      isPiProcess(
        "node /repo/node_modules/.bin/pi -e /repo/pi-extensions/pi-vscode-bridge.js --mode rpc --model solar/qoder/qwen3.8-flash",
      ),
    ).toBe(true);
  });

  it("matches the bare title pi rewrites itself to (FINDINGS §11.4)", () => {
    // pi calls setproctitle, which overwrites the argv area and pads with
    // spaces. After that `ps` shows only `pi`, so the long-form match alone
    // would miss every steady-state process.
    expect(isPiProcess("pi")).toBe(true);
    expect(isPiProcess("pi             ")).toBe(true);
  });

  it("does not match unrelated commands that merely mention pi", () => {
    expect(isPiProcess("grep --color=auto pi")).toBe(false);
    expect(isPiProcess("/usr/bin/pipenv install")).toBe(false);
    expect(isPiProcess("node /repo/node_modules/.bin/pi-doctor")).toBe(false);
    expect(isPiProcess("")).toBe(false);
  });
});

describe("piProcessPids", () => {
  it("returns the pids of matching processes", () => {
    expect(
      piProcessPids([
        // `--mode rpc` on its own is not enough: the model check is what keeps
        // a pi the user started by hand out of this run's orphan set.
        { pid: 10, command: "/usr/bin/node --mode rpc" },
        { pid: 11, command: "pi   " },
        { pid: 12, command: "/sbin/launchd" },
      ]),
    ).toEqual([11]);
  });
});
```

同步更新 import：去掉 `findTestPiProcesses`，加入 `isPiProcess`、`piProcessPids`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/e2e/fixture.test.ts`
Expected: FAIL，`isPiProcess is not a function`（或导入解析错误）

- [ ] **Step 3: 改 `test/e2e/fixture.ts`**

删除 `runningCommandLines()` 与 `findTestPiProcesses()`，替换为：

```ts
export interface RunningProcess {
  pid: number;
  command: string;
}

/**
 * Every running process with its pid. `-ww` matters: without it macOS truncates
 * to the terminal width and `--model` sits at the very end of pi's argument
 * list. Longest line measured on this machine: 3151 chars.
 */
export function runningProcesses(): RunningProcess[] {
  return execFileSync("ps", ["-Awwo", "pid=,command="], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .map((line) => {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (!match) return undefined;
      const [, pid = "", command = ""] = match;
      return { pid: Number(pid), command };
    })
    .filter((entry): entry is RunningProcess => entry !== undefined);
}

/**
 * pi rewrites its own process title after startup, which wipes argv and leaves
 * `ps` showing a space-padded bare `pi` (FINDINGS §11.4). So a process counts as
 * pi either while it still carries the launcher argv — a window of a few hundred
 * milliseconds — or once it has collapsed to that bare title.
 */
export function isPiProcess(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed === "pi") return true;
  return trimmed.includes("--mode rpc") && trimmed.includes("--model solar/qoder/qwen3.8-flash");
}

export function piProcessPids(processes: RunningProcess[] = runningProcesses()): number[] {
  return processes.filter((p) => isPiProcess(p.command)).map((p) => p.pid);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/e2e/fixture.test.ts`
Expected: PASS，全部用例绿

- [ ] **Step 5: 改 `test/e2e/runner.ts` 的孤儿检查与 env**

三处改动。

(a) import 改为：

```ts
import {
  createFixture,
  disposeFixture,
  piProcessPids,
  resolveVsCodeExecutablePath,
  type Fixture,
} from "./fixture.ts";
```

(b) 在 `const fixture: Fixture = createFixture({ offline });` **之前**记录基线 PID：

```ts
// Differential orphan detection: pi's title rewrite makes argv matching
// unreliable, so instead of asking "is a pi running" afterwards we ask "did
// the set of pi pids grow and then fail to shrink". Baseline is captured
// before VS Code starts so a pi the user is running by hand is not mistaken
// for an orphan.
const piPidsBefore = new Set(piProcessPids());
```

(c) 把孤儿检查那段：

```ts
const orphans = findTestPiProcesses();
if (orphans.length > 0) {
  console.error(`[e2e] ${orphans.length} orphan pi process(es) survived teardown:`);
  for (const line of orphans) console.error(`[e2e]   ${line}`);
}
```

替换为：

```ts
const survivors = piProcessPids().filter((pid) => !piPidsBefore.has(pid));
if (survivors.length > 0) {
  console.error(
    `[e2e] ${survivors.length} pi process(es) started by this run survived teardown: ` +
      survivors.join(", "),
  );
}
```

并把后面所有 `orphans.length > 0` 的用法改成 `survivors.length > 0`。

(d) 在 `extensionTestsEnv` 里加一项（Task 4/5 读日志要用）：

```ts
        PI_E2E_USER_DATA: fixture.userDataDir,
```

- [ ] **Step 6: 给 `test/e2e/suite/harness.ts` 追加 trace 等待器**

在文件末尾追加。顶部 import 补 `import * as vscode from "vscode";`、
`import { readRpcTrace, type RpcTraceEntry } from "../rpc-log.ts";`：

```ts
export const userDataDir = (): string => env("PI_E2E_USER_DATA");

/** Snapshot of the RPC channel log as it currently exists on disk. */
export function rpcEntries(): RpcTraceEntry[] {
  return readRpcTrace(userDataDir());
}

/**
 * Polls the trace log until `predicate` holds, then returns that snapshot.
 *
 * This replaces the old `ps`-based liveness check: pi rewrites its process title
 * and wipes argv, so argv matching only works for a few hundred milliseconds
 * after spawn (FINDINGS §11.4). An inbound line in this log proves both that pi
 * is alive and that it is speaking the protocol.
 *
 * The channel is flushed asynchronously (FINDINGS §11.1), so every wait re-reads
 * rather than reading once. pi needs ~4.5s before its first response
 * (FINDINGS §11.2) — budget accordingly.
 */
export async function waitForRpc(
  predicate: (entries: RpcTraceEntry[]) => boolean,
  opts: { timeoutMs: number; intervalMs?: number; what?: string },
): Promise<RpcTraceEntry[]> {
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + opts.timeoutMs;
  let latest = rpcEntries();
  for (;;) {
    if (predicate(latest)) return latest;
    if (Date.now() > deadline) {
      const tail = latest
        .slice(-20)
        .map((e) => `${e.direction}:${e.raw.slice(0, 80)}`)
        .join("\n  ");
      throw new Error(
        `timed out after ${opts.timeoutMs}ms waiting for ${opts.what ?? "RPC condition"}. ` +
          `Trace had ${latest.length} line(s); last ${Math.min(latest.length, 20)}:\n  ${tail || "(none)"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    latest = rpcEntries();
  }
}
```

- [ ] **Step 7: 把 M1 用例的存活判据换成 trace**

在 `test/e2e/suite/cases/m1-bootstrap.test.ts` 里：

(a) 把 import 那两行改为（去掉 `findTestPiProcesses`，加入 `inboundResponses` 与 `waitForRpc`）：

```ts
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { EXTENSION_ID } from "../../fixture.ts";
import { inboundResponses } from "../../rpc-log.ts";
import { env, filesUnder, repoRoot, sessionsDir, waitForRpc, workspaceDir } from "../harness.ts";
```

> 注意：这里**刻意不导入 `E2E_MODEL`** —— 替换后的用例不再引用它（只把模型名写在注释和
> 失败信息里），导入会变成未使用而让 oxlint 失败。

(b) 把整条 `it("spawns the real pi subprocess with the fixture arguments", ...)` 替换为：

```ts
it("gets a live response out of the real pi subprocess", async () => {
  // Previously this matched the pi process through `ps`, which only works for
  // the few hundred milliseconds before pi rewrites its process title and
  // wipes argv (FINDINGS §11.4). An inbound RPC response is the stronger
  // signal: it proves pi is alive AND answering the protocol, and it does not
  // depend on argv. `--model solar/qoder/qwen3.8-flash` still arrives through
  // pi-agent-chat.args, so a hand-started pi cannot satisfy this.
  //
  // openSidebarChat bails silently in three places (chat-sidebar.ts:257-267)
  // and waitForView() has a hardcoded 5s timeout (chat-sidebar.ts:65-81), so
  // re-issue the command if nothing arrives; it is idempotent once
  // sidebarState.session exists.
  const deadline = Date.now() + 120_000;
  for (let attempt = 1; ; attempt += 1) {
    await vscode.commands.executeCommand("pi-agent-chat.openInSidebar");
    const answered = await waitForRpc(
      (entries) => inboundResponses(entries).some((r) => r.success),
      {
        timeoutMs: 30_000,
        what: `a successful RPC response from pi (attempt ${attempt})`,
      },
    )
      .then(() => true)
      .catch(() => false);
    if (answered) return;
    if (Date.now() > deadline) {
      assert.fail(
        `pi never answered an RPC request after ${attempt} openInSidebar attempts. ` +
          "Likely causes: ensurePiBinary returned undefined because pi-agent-chat.path " +
          "is not executable (src/services/rpc/process.ts:55-71 fails silently), or the " +
          "sidebar view never resolved. The runner keeps the fixture on failure — read " +
          "<fixture>/user-data/logs/**/output_logging_*/1-Pi Chat RPC.log.",
      );
    }
    console.log(`[m1] attempt ${attempt} produced no RPC response, retrying`);
  }
});
```

(c) 把 `it("points pi's session storage at the fixture directory", ...)` 里的注释首句改为：

```ts
// pi reports a sessionFile under our redirected directory in its
// get_session_stats response, but writes nothing until a prompt exists
// (FINDINGS §6, §11.3). M2 sends real prompts and asserts the file appears.
```

- [ ] **Step 8: typecheck 与 lint**

Run: `npx tsgo --noEmit -p test/e2e/tsconfig.json; echo "TSGO=$?"; npm run lint`
Expected: `TSGO=0`，lint 退出码 0

- [ ] **Step 9: 验证 M1 仍然通过（存活判据已换实现）**

Run: `npm run build:e2e && node test/e2e/.build/runner.cjs --skip-build`
Expected: `6 passing`，`Exit code: 0`。注意这一轮的 M1 会**明显变慢**（多等 pi 的首响应约 4.5s，
且每条用例都真在等 RPC），从约 0.4s 升到十几秒，属预期。

---

### Task 3: 受门控的 webview 消息刺激钩子

**Files:**

- Create: `src/commands/testing-gate.ts`
- Create: `src/commands/testing-gate.test.ts`
- Create: `src/commands/testing.ts`
- Modify: `src/commands/index.ts`
- Modify: `src/providers/chat/chat-session.ts`
- Modify: `src/extension.ts`

**Interfaces:**

- Consumes: `getSidebarSession()`（已由 `src/providers/chat/chat-sidebar.ts:27` 导出）
- Produces:
  - `EXTENSION_MODE_PRODUCTION: number`、`shouldRegisterTestingCommands(mode: number): boolean`
  - `registerTestingCommands(): vscode.Disposable[]`
  - `ChatSession.sendFromWebview(msg: WebviewToExt): Promise<void>`
  - 命令 `pi-agent-chat.__webviewMessage`，参数为一条消息的 JSON 字符串

- [ ] **Step 1: 写 `src/commands/testing-gate.test.ts`（失败的单测）**

```ts
import { describe, expect, it } from "vitest";
import { EXTENSION_MODE_PRODUCTION, shouldRegisterTestingCommands } from "./testing-gate.ts";

describe("shouldRegisterTestingCommands", () => {
  it("is false in Production so the shipped vsix has no stimulus surface", () => {
    expect(shouldRegisterTestingCommands(EXTENSION_MODE_PRODUCTION)).toBe(false);
  });

  it("is true in Development (2) and Test (3)", () => {
    // vscode.ExtensionMode is a stable numeric enum: Production=1,
    // Development=2, Test=3. The gate is duplicated here as numbers because
    // testing-gate.ts deliberately does not import `vscode` — that keeps this
    // unit test runnable under vitest.
    expect(shouldRegisterTestingCommands(2)).toBe(true);
    expect(shouldRegisterTestingCommands(3)).toBe(true);
  });

  it("is true for unknown modes rather than silently disabling the harness", () => {
    expect(shouldRegisterTestingCommands(99)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/commands/testing-gate.test.ts`
Expected: FAIL，`Cannot find module './testing-gate.ts'`

- [ ] **Step 3: 写 `src/commands/testing-gate.ts`**

```ts
// The e2e harness needs to stimulate the webview side of the chat — sending a
// prompt, aborting a run, answering a permission dialog. Test code runs in the
// extension host and VS Code exposes no API for injecting a message into a
// webview, so the stimulus has to live here, behind a gate.
//
// This module deliberately does not import `vscode`: the gate is the one piece
// worth unit-testing, and importing the vscode module would make that
// impossible under vitest.

/** `vscode.ExtensionMode.Production`. Numeric and stable in the public API. */
export const EXTENSION_MODE_PRODUCTION = 1;

export function shouldRegisterTestingCommands(mode: number): boolean {
  return mode !== EXTENSION_MODE_PRODUCTION;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/commands/testing-gate.test.ts`
Expected: PASS，3 个用例绿

- [ ] **Step 5: 给 `ChatSession` 加 `sendFromWebview`**

在 `src/providers/chat/chat-session.ts` 的 `ChatSession` 接口（`attach` / `sync` /
`switchTo` / `newSession` / `dispose` 那一组）里加一行：

```ts
  /** Dev-harness stimulus: dispatch a message exactly as the webview would. */
  sendFromWebview(msg: WebviewToExt): Promise<void>;
```

`WebviewToExt` 从 `../../protocol/messages.ts` 导入（该文件已被本模块导入，若未导入则加入
type import）。

在返回对象里，紧挨着 `attach: attachHost,` 之类的位置加上实现：

```ts
    sendFromWebview: (msg) => onMessage(msg as { type: string; [k: string]: unknown }),
```

- [ ] **Step 6: 写 `src/commands/testing.ts`**

```ts
// Dev-only stimulus surface for the e2e harness. Registered only when the
// extension is not installed from a vsix (see shouldRegisterTestingCommands),
// so nothing here exists in a shipped build.
//
// Observation does not need this file: the harness reads the "Pi Chat RPC"
// output channel instead. Only *stimulus* — making the extension send something
// — needs a host-side entry point.

import * as vscode from "vscode";
import type { WebviewToExt } from "../protocol/messages.ts";

const COMMAND_ID = "pi-agent-chat.__webviewMessage";

export function registerTestingCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMAND_ID, async (payload: unknown) => {
      if (typeof payload !== "string") {
        throw new Error(`${COMMAND_ID} expects a JSON string`);
      }
      const parsed: unknown = JSON.parse(payload);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof (parsed as { type?: unknown }).type !== "string"
      ) {
        throw new Error(`${COMMAND_ID} expects an object with a string \`type\``);
      }

      const { getSidebarSession } = await import("../providers/chat/chat-sidebar.ts");
      const session = getSidebarSession();
      if (!session) throw new Error("no sidebar chat session is running");
      await session.sendFromWebview(parsed as WebviewToExt);
    }),
  ];
}
```

- [ ] **Step 7: 不要在 `src/commands/index.ts` 里加 re-export**

本步原计划要加一行 `export { registerTestingCommands } from "./testing.ts";`。
**执行期已撤销这个做法**，理由是被审查发现它会抵消 `extension.ts` 里 `await import()` 的目的：

`extension.ts:9` 静态导入 `./commands/index.ts` 取 `registerCommands`，所以一旦 `index.ts`
静态 re-export 了 `testing.ts`，后者就进入静态激活图，`await import()` 变成装饰性的。
那行 re-export 没有任何消费者（`extension.ts` 直接导入模块本身）。

实测反事实：加 re-export 时 `grep -c __webviewMessage dist/extension.cjs` 为 1；删掉后为 0，
命令 id 只出现在懒加载的 `dist/chunks/testing-*.cjs` 里，而该 chunk 只在门控分支内被
`require`（`extension.ts:59-62`），Production 宿主根本不会解析它。

**所以本步什么都不做**，`src/commands/index.ts` 保持原样。若后续任务照旧版本计划操作，
会悄悄退回这个性质。

- [ ] **Step 8: 在 `src/extension.ts` 注册**

在 `registerCommands(context, {...});` 之后加：

```ts
const { shouldRegisterTestingCommands } = await import("./commands/testing-gate.ts");
if (shouldRegisterTestingCommands(context.extensionMode)) {
  const { registerTestingCommands } = await import("./commands/testing.ts");
  context.subscriptions.push(...registerTestingCommands());
}
```

（用 `await import()` 是为了不给激活路径增加静态依赖 —— 与文件顶部注释里
「implementation modules are reached through `await import()`」的既有约定一致。）

- [ ] **Step 9: 静态检查**

Run: `npm run fmt && npm run lint && npx tsgo --noEmit -p test/e2e/tsconfig.json; echo "TSGO=$?"`
Expected: lint 退出码 0；`TSGO=0`

- [ ] **Step 10: 建 `test/e2e/suite/cases/m2-turn.test.ts` 并验证命令真的注册了**

新文件，只放一条用例（Task 4/5 会往里追加）：

```ts
import { strict as assert } from "node:assert";
import * as vscode from "vscode";

describe("M2 — hydration and stimulus", () => {
  it("registers the dev-only stimulus command", async () => {
    // Proves the extensionMode gate let it through in Development. That is the
    // only half an automated test can reach: the test host is always
    // Development, so the Production half is covered by the pure unit test in
    // src/commands/testing-gate.test.ts.
    const registered = await vscode.commands.getCommands(true);
    assert.ok(registered.includes("pi-agent-chat.__webviewMessage"));
  });
});
```

Run: `npm run build:e2e && node test/e2e/.build/runner.cjs`
Expected: `7 passing`，`Exit code: 0` —— M1 的 6 条（Task 2 把其中一条换了实现，数量不变）
加本任务新增的 `registers the dev-only stimulus command`。

> **本步刻意不加 `--skip-build`**：这个任务改了 `src/`，而宿主加载的是
> `./dist/extension.cjs`（`package.json` 的 `main`）。`--skip-build` 跳过扩展 bundle 的构建，
> 于是跑的是**上一次构建的扩展**，新命令根本没被注册，结果是 `6 passing / 1 failing`。
> 执行期实测确认过这一点。后续只改 `test/e2e/**` 的任务（Task 4、Task 5）加 `--skip-build`
> 是安全的，因为扩展 bundle 不受影响。

---

### Task 4: M2 用例 —— hydration

**Files:**

- Modify: `test/e2e/suite/cases/m2-turn.test.ts`（Task 3 已建）
- Modify: `test/e2e/suite/harness.ts`

**Interfaces:**

- Consumes: `rpcEntries` / `waitForRpc`（Task 2）、`inboundResponses` / `inboundEvents` / `inboundUiRequests`（Task 1）、命令 `pi-agent-chat.__webviewMessage`（Task 3）
- Produces（Task 5 依赖）: `sendWebviewMessage(msg: unknown): Promise<void>`（harness）

- [ ] **Step 1: 给 `test/e2e/suite/harness.ts` 追加 `sendWebviewMessage`**

只在文件末尾追加下面这个函数。**`userDataDir` / `rpcEntries` / `waitForRpc` 已在
Task 2 Step 6 加过，不要重复添加**；`import * as vscode from "vscode";` 也已在 Task 2 Step 6
加过，**同样不要重复添加**。

```ts
/** Dev-harness stimulus: dispatch a message as if the webview had sent it. */
export async function sendWebviewMessage(msg: unknown): Promise<void> {
  await vscode.commands.executeCommand("pi-agent-chat.__webviewMessage", JSON.stringify(msg));
}
```

- [ ] **Step 2: 给 `test/e2e/suite/cases/m2-turn.test.ts` 追加两条用例**

在 Task 3 建好的 describe 块内追加。顶部 import 补
`inboundResponses, inboundUiRequests`（来自 `../../rpc-log.ts`）与
`rpcEntries, waitForRpc`（来自 `../harness.ts`）。

> `rpcEntries` 在第一条例的正文里没有被断言用到。**执行期处理**：用它加了一段
> 「等待前先打印已存在的 hydration 响应命令」的诊断（4 行），而不是把它从 import 里删掉。
> 理由是那条日志让「断言是被历史满足的还是真的等来的」每次运行都可观测 —— 首轮实跑中
> 四个 hydration 响应**确实已经在盘上**，`waitForRpc` 立即返回，轮询路径没有被走到。
> 若把 `rpcEntries` 从 import 里去掉，lint 会干净，但这个问题就只能靠推断。

```ts
it("hydrates models, thinking levels, commands and session stats from real pi", async () => {
  // The sidebar session starts on its own when the view resolves (M1 case 4),
  // so hydration requests are already in flight. pi needs ~4.5s to answer the
  // first one (FINDINGS §11.2), which is why this waits rather than reads once.
  const entries = await waitForRpc(
    (all) => {
      const commands = new Set(
        inboundResponses(all)
          .filter((r) => r.success)
          .map((r) => r.command),
      );
      return (
        commands.has("get_available_models") &&
        commands.has("get_available_thinking_levels") &&
        commands.has("get_commands") &&
        commands.has("get_session_stats")
      );
    },
    { timeoutMs: 60_000, what: "the four hydration responses" },
  );

  const byCommand = new Map(
    inboundResponses(entries)
      .filter((r) => r.success)
      .map((r) => [r.command, r.data] as const),
  );

  const models = (byCommand.get("get_available_models") as { models?: unknown[] } | undefined)
    ?.models;
  assert.ok(Array.isArray(models) && models.length > 0, "expected at least one model");

  const levels = (
    byCommand.get("get_available_thinking_levels") as { levels?: unknown[] } | undefined
  )?.levels;
  assert.ok(Array.isArray(levels) && levels.length > 0, "expected at least one thinking level");

  const piCommands = (byCommand.get("get_commands") as { commands?: unknown[] } | undefined)
    ?.commands;
  assert.ok(Array.isArray(piCommands) && piCommands.length > 0, "expected at least one pi command");

  const stats = byCommand.get("get_session_stats") as Record<string, unknown> | undefined;
  assert.ok(stats, "expected session stats");
  // `sessionFile` is the one field whose shape was verified by measurement
  // (FINDINGS §11.3). Print the real key set so Task 6 can record it and M3 can
  // assert on `contextUsage` with a known shape instead of a guess.
  console.log(`[m2 finding] get_session_stats keys: ${Object.keys(stats).sort().join(", ")}`);
  assert.ok(
    typeof stats.sessionFile === "string" && stats.sessionFile.length > 0,
    "expected a session file path",
  );
});

it("receives the unsolicited startup widgets and statuses", async () => {
  // pi pushes these before answering anything (FINDINGS §11.2), so any
  // assertion on "the first inbound message" would be wrong.
  const entries = await waitForRpc(
    (all) => inboundUiRequests(all).some((r) => r.method === "setStatus"),
    { timeoutMs: 60_000, what: "a setStatus ui request" },
  );
  const methods = new Set(inboundUiRequests(entries).map((r) => r.method));
  assert.ok(methods.has("setWidget"), `expected setWidget among ${[...methods].join(", ")}`);
  assert.ok(methods.has("setStatus"), `expected setStatus among ${[...methods].join(", ")}`);
});
```

（追加内容到此为止 —— 不要再补 describe 的闭合花括号，它是已存在的。）

- [ ] **Step 3: 打包并跑**

Run: `npm run build:e2e && node test/e2e/.build/runner.cjs --skip-build`
Expected: `9 passing`，`Exit code: 0` —— M1 的 6 条 + Task 3 的 1 条 + 本任务的 2 条。
本条用例会随包的加载自动被打进 `.build/suite/cases/`（rolldown 的 input 是扫描目录的）。

- [ ] **Step 4: 若失败，按此顺序诊断**

1. **`PI_E2E_USER_DATA is missing`** → Task 2 Step 5(d) 没生效，检查 `extensionTestsEnv`
2. **`timed out ... Trace lines seen (0)`** → 日志文件没找到。用 `--keep` 重跑，确认
   `<fixture>/user-data/logs/**/output_logging_*/1-Pi Chat RPC.log` 存在；若不存在说明
   `rpcTrace` 未开（fixture settings 里应为 `true`）
3. **`Trace lines seen (N)` 但条件不满足** → 看打印出来的行，判断是缺请求还是缺响应
4. **`the dev-only stimulus command is not registered`** → `context.extensionMode` 在该运行下
   被判定为 Production，检查 `shouldRegisterTestingCommands` 的调用点

---

### Task 5: M2 用例 —— 真 prompt 一个 turn 与 abort

**Files:**

- Modify: `test/e2e/suite/cases/m2-turn.test.ts`

**Interfaces:**

- Consumes: `rpcEntries` / `waitForRpc`（Task 2）、`sendWebviewMessage`（Task 4）、`inboundEvents` / `inboundResponses`（Task 1）、`filesUnder` / `sessionsDir`（M1 harness）
- Produces: 无

- [ ] **Step 1: 在 `test/e2e/suite/cases/m2-turn.test.ts` 末尾追加一个新的 describe 块**

import 补齐：`inboundEvents`（`../../rpc-log.ts`）、`filesUnder` / `sessionsDir` /
`sendWebviewMessage` / `rpcEntries` / `waitForRpc`（`../harness.ts`），以及 `RpcTraceEntry`
的类型导入（`../../rpc-log.ts`，`countDeltas` 的形参要用到）。

> 执行期修正：原计划此处只列了 `inboundEvents` / `filesUnder` / `sessionsDir`，
> **漏了 `sendWebviewMessage`**，而用例正文要调它 —— 照抄会得到 3 个 TS2304 并让
> `TSGO=0` 不可达。

```ts
describe("M2 — real turn", () => {
  it("completes a real turn and emits agent_start → message_* → agent_settled", async () => {
    const before = inboundEvents(rpcEntries()).length;
    await sendWebviewMessage({ type: "prompt", message: "Reply with the single word: ok" });

    const entries = await waitForRpc((all) => inboundEvents(all).includes("agent_settled"), {
      timeoutMs: 120_000,
      what: "agent_settled after a real prompt",
    });

    const events = inboundEvents(entries);
    const turn = events.slice(before);
    assert.ok(turn.includes("agent_start"), `expected agent_start in ${turn.join(", ")}`);
    assert.ok(
      turn.includes("message_start") && turn.includes("message_end"),
      `expected message_start and message_end in ${turn.join(", ")}`,
    );
    // Structural only: never assert on what the model said.
    //
    // Assert the ORDER by index rather than "the last element is agent_settled":
    // `waitForRpc` returns as soon as agent_settled appears, so further events
    // (queue_update, a later settle) can land between that poll and this slice,
    // and a last-element assertion would fail for a reason unrelated to the turn.
    const order = ["agent_start", "message_start", "message_end", "agent_settled"].map((name) =>
      turn.indexOf(name),
    );
    assert.ok(
      order.every((at, i) => at >= 0 && (i === 0 || at > (order[i - 1] ?? -1))),
      `expected agent_start < message_start < message_end < agent_settled, saw ${turn.join(", ")}`,
    );

    const prompts = inboundResponses(entries).filter((r) => r.command === "prompt");
    assert.ok(prompts.length > 0, "expected a prompt response");
    assert.ok(
      prompts.every((r) => r.success),
      "prompt should not report failures",
    );
  });

  it("writes the session to disk once a prompt exists", async () => {
    // Settles the M1 open question (§6 / §11.3): with no prompt pi reported a
    // sessionFile path but wrote nothing. After the case above there must be a
    // file.
    const files = filesUnder(sessionsDir());
    assert.ok(
      files.length > 0,
      `expected a session file under ${sessionsDir()} after a real prompt`,
    );
  });

  it("stops streaming when the turn is aborted", async () => {
    // Snapshot the delta count BEFORE this turn's prompt. The trace log is
    // shared across every case in the run, so a bare ">= 1 message_update"
    // predicate is satisfied instantly by the PREVIOUS turn's deltas — the abort
    // would then be sent before pi starts streaming and the cancellation
    // assertion below would hold trivially. Measured during execution: with the
    // naive predicate the abort went out ~40ms after the prompt and cancelled a
    // request that had not begun streaming.
    const countDeltas = (entries: RpcTraceEntry[]): number =>
      inboundEvents(entries).filter((e) => e === "message_update").length;
    const deltasBeforePrompt = countDeltas(rpcEntries());

    await sendWebviewMessage({
      type: "prompt",
      message: "Count from 1 to 400, one number per line, with no other text.",
    });

    // Now this genuinely waits for THIS turn to start streaming.
    await waitForRpc((all) => countDeltas(all) > deltasBeforePrompt, {
      timeoutMs: 120_000,
      what: "the first message_update delta of this turn",
    });

    await sendWebviewMessage({ type: "abort" });
    const entries = await waitForRpc(
      (all) => inboundResponses(all).some((r) => r.command === "abort"),
      { timeoutMs: 30_000, what: "the abort response" },
    );
    const abortResponse = inboundResponses(entries)
      .filter((r) => r.command === "abort")
      .at(-1);
    assert.ok(abortResponse?.success, "abort should succeed");

    // `abort` resolves with no data (src/services/rpc/client.ts:205), so
    // cancellation is shown structurally: the stream must have STOPPED. Sample
    // twice after the abort and require the count to be stable between the two
    // later samples rather than immediately after the response — a few in-flight
    // deltas can legitimately land after the abort is acknowledged, and asserting
    // no growth at all would flake on them.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const deltasSettled = countDeltas(rpcEntries());
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const deltasLater = countDeltas(rpcEntries());
    assert.equal(
      deltasLater,
      deltasSettled,
      `expected streaming to have stopped, but message_update kept growing: ${deltasSettled} → ${deltasLater}`,
    );
    assert.ok(
      deltasSettled > deltasBeforePrompt,
      "expected the aborted turn to have produced some deltas before the abort",
    );
  });
});
```

（末尾那个 `});` 是本任务新建的 describe 的闭合。）

- [ ] **Step 2: 打包并跑**

Run: `npm run build:e2e && node test/e2e/.build/runner.cjs --skip-build`
Expected: `12 passing`，`Exit code: 0` —— M1 的 6 条 + Task 3 的 1 条 + Task 4 的 2 条 +
本任务的 3 条。整轮耗时预期 3–5 分钟（两个真 turn，每个预算 120s）。

- [ ] **Step 3: 连跑三次确认不 flake**

Run:

```bash
for i in 1 2 3; do node test/e2e/.build/runner.cjs --skip-build >/tmp/m2-flake-$i.log 2>&1; echo "run $i exit=$?"; done
```

Expected: 三次 `exit=0`

- [ ] **Step 4: 静态检查**

Run: `npm run fmt && npm run lint && npx tsgo --noEmit -p test/e2e/tsconfig.json; echo "TSGO=$?"`
Expected: lint 0；`TSGO=0`

---

### Task 6: 结论落档

**Files:**

- Modify: `test/e2e/FINDINGS.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: Task 4/5 的实测输出
- Produces: M3 计划的输入

- [ ] **Step 1: 在 `test/e2e/FINDINGS.md` 追加 §12**

逐项填**实测**结果，不要填推测：

```markdown
## 12. M2 结论

### 12.1 受门控的刺激钩子

**命令：** `pi-agent-chat.__webviewMessage`，参数为消息 JSON 字符串。
**门控：** `shouldRegisterTestingCommands(context.extensionMode)`，Production 下不注册。
**自动化覆盖：** 门控判定有单测（`src/commands/testing-gate.test.ts`）；「开发模式下确实注册了」
有用例断言。**「Production 下未注册」没有自动化覆盖** —— 测试宿主恒为 Development，
无法在本 harness 内翻转。该半边依赖 `extensionMode` 这一平台保证 + 代码审查。

### 12.2 真 prompt turn 的实测

- 首个 `message_update` 出现耗时：<秒>
- 完整 turn（prompt → agent_settled）耗时：<秒>
- 事件序列实际观测到的顺序：<列表>
- 是否出现 `message_update` 之外的意外事件：<是/否 + 内容>

### 12.3 abort 的实测

- abort 响应耗时：<秒>
- abort 时流是否确实已在输出（本 turn 的 delta 数）：<数字>
- abort 后 `message_update` 是否停止增长：<是/否>
- abort 后是否收到 `agent_settled`：<是/否>

> **必须写明这个用例的因果边界，不得写成「证明了取消」。** 它的判据是「delta 计数停止增长」，
> 而计数无法区分「abort 取消了流」与「模型自己在采样窗口内停了」。它**能**证明的是：
> 流在 abort 时刻确实还活着（本 turn delta 数 > 0 的断言），以及 abort 之后计数冻结。
> 审查者明确要求 Task 6 不得把这条用例描述成 cancellation 的证明。
>
> 更强的证据已经存在但**尚未成为用例**：pi 写进会话文件的最后一条 assistant 消息带
> `stopReason: "aborted"`。把它记为一个待补的用例（M3），并说明它比计数冻结强在哪。

### 12.4 会话文件

有 prompt 之后 `PI_CODING_AGENT_SESSION_DIR` 下的文件：<数量与文件名>
（M1 时该目录为空 —— §6 / §11.3）

### 12.5 整轮耗时与 flake

- 含构建：<秒>
- `--skip-build`：<秒>
- 连跑 3 次结果：<全绿/有失败>
```

- [ ] **Step 2: 更新 README 的 End-to-end tests 段**

把耗时数字换成 M2 的实测值，并加一句说明刺激钩子的存在与门控：

```markdown
Cases that need the extension to _send_ something (a prompt, an abort) go through
`pi-agent-chat.__webviewMessage`, a dev-only command registered only when the extension is
not installed from a vsix. Observation needs no such hook: cases read the `Pi Chat RPC`
output channel, which `rpcTrace` mirrors to disk.
```

- [ ] **Step 3: 全量验证**

Run: `npm run fmt && npm run lint && npm run typecheck; echo "TC=$?"; npm run test:unit 2>&1 | tail -6`
Expected: lint 0；`TC=0`；`test:unit` 失败仍**恰好**是 M1 记录的那 2 个 macOS 既有用例

---

## Self-Review

**规格书 M2 覆盖检查：**

| 规格书 §4 M2 要求                                             | 对应 Task                                                                                             |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 发最小 prompt，断言 `agent_start → message_* → agent_settled` | Task 5 Step 1 用例 1                                                                                  |
| 断言 hydration 非空 models / thinkingLevels / commands        | Task 4 Step 2 用例 1                                                                                  |
| 断言 abort 真的取消                                           | Task 5 Step 1 用例 3                                                                                  |
| 断言 contextUsage / session stats 到位                        | Task 4 Step 2 用例 1（`get_session_stats` 的 `sessionFile`；`contextUsage` 形状未验证，故只记录键名） |
| 断言数据来源：会话文件 + 宿主侧 RPC 事件，**不引入探针**      | Task 1（trace 读取）+ Task 5 Step 1 用例 2（会话文件）；探针确实未引入                                |
| 通过标准：同一用例连跑 3 次不 flake                           | Task 5 Step 3                                                                                         |
| FINDINGS §11.4 要求：存活判据换信号、修孤儿检查               | Task 2                                                                                                |
| FINDINGS §11.1 要求：读日志前留足等待                         | Task 2 的 `waitForRpc` 每次重读 + 120s 预算                                                           |

**规格书的 M1 缺陷也必须由本计划修掉（不是新需求）：**

| FINDINGS §11.4 指出的缺陷                                    | 对应 Task                                            |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| `findTestPiProcesses()` 依赖 argv，只在 spawn 后几百毫秒有效 | Task 2 Step 3 换实现，Task 2 Step 7 换 M1 用例的判据 |
| runner 的孤儿检查会漏报真实孤儿                              | Task 2 Step 5(b)(c) 改差分 PID                       |
| M1 的稳定性是顺序运气                                        | Task 2 Step 9 + Task 5 Step 3 各验证一次             |

**规格书偏离（有意，逐条给理由）：**

1. **M2 动了生产代码 —— 与规格书「M2 不碰生产代码」直接冲突。**
   规格书说「断言数据来源是 pi 写的会话文件 + 宿主侧 RPC 事件，不需要探针」。这覆盖了
   **观测**，但漏了**刺激**：要让扩展发出 prompt，必须让 webview 发 `{type:"prompt"}`，
   而测试代码在扩展宿主里，VS Code 没有公开 API 能向 webview 注入消息。所以 M2 需要一个
   受门控的命令（Task 3）。观测侧仍保持零侵入（走 rpcTrace 日志），只有刺激侧加了钩子。
   钩子用**一个通用命令**而非 prompt/abort/dialogResponse 各一条，这样 M3、M4 的刺激需求
   都不必再改生产代码。

2. **abort 判据从 `{cancelled: true}` 改为「响应成功 + delta 数停止增长」。**
   规格书写「断言流式中途 abort 真的返回 `{cancelled: true}`」，但
   `abort: () => request<void>({ type: "abort" })`（`src/services/rpc/client.ts:205`）
   的响应没有 data —— `{cancelled}` 是 `new_session`/`switch_session`/`fork` 的返回值。
   改为结构性判据：abort 响应 `success: true`，且 `message_update` 计数在响应后不再增长。

3. **进程检测从「匹配带参数的长命令行」改为「长命令行 OR trim 后等于裸 `pi`」。**
   依据 FINDINGS §11.4：pi 会 `setproctitle` 重写标题、抹掉 argv，长匹配串只在 spawn 后
   几百毫秒内有效。这是修 M1 的既有缺陷，不是新增需求。

4. **孤儿检查从「有没有 pi 进程」改为「本次运行新起的 pi PID 是否还在」。**
   同样依据 §11.4：裸 `pi` 会与用户自己运行的 pi 混淆，所以用启动前基线做差分。

**占位符扫描：** 无 TBD / TODO / 「类似 Task N」/ 「在 Task N 里实现」。所有代码块都是可直接
粘贴的完整实现。Task 6 的 `<秒>` 是待填的实测值，其证据来源在 Step 1 中逐项指明。

**类型一致性核对：**

- `RpcTraceEntry` 的 4 个字段在 Task 1 定义，Task 2 的 `waitForRpc` 与 Task 4/5 的用例逐字使用 ✓
- `inboundResponses` 返回 `{command, success, data}`，Task 4/5 都按这三个字段取值 ✓
- `inboundEvents` 返回 `string[]`，Task 5 用 `.filter(e => e === "message_update")` 与 `.includes("agent_settled")` ✓
- `inboundUiRequests` 返回 `{method}[]`，Task 4 用 `.method` ✓
- `piProcessPids(processes?)` 在 Task 2 定义，runner 两处调用都不传参 ✓
- `isPiProcess` 在 Task 2 定义并被 `piProcessPids` 使用；单词测直接调它 ✓
- `shouldRegisterTestingCommands(mode: number)` 在 Task 3 定义，`extension.ts` 传
  `context.extensionMode`（numeric enum，可直接赋给 number）✓
- `sendFromWebview(msg: WebviewToExt)` 在 Task 3 定义，`testing.ts` 用
  `parsed as WebviewToExt` 调用 ✓
- `userDataDir` / `rpcEntries` / `waitForRpc` 在 **Task 2** Step 6 定义，Task 4 与 Task 5 使用；
  Task 4 Step 1 明确不得重复添加 ✓
- `sendWebviewMessage` 在 Task 4 Step 1 定义，Task 5 使用 ✓
- 命令 id `pi-agent-chat.__webviewMessage` 在 Task 3（定义）、Task 4（harness 调用 + 注册断言）
  两处字面一致 ✓
- `PI_E2E_USER_DATA` 在 Task 2 Step 5(d) 传入、Task 2 Step 6 经 `userDataDir()` 读取 ✓
- 用例总数可核对：M1 6（Task 2 换实现，数量不变）+ Task 3 的 1 + Task 4 的 2 + Task 5 的 3
  = **12**，与 Task 5 Step 2 的 Expected 一致 ✓
- `describe` 块归属：Task 3 建 `"M2 — hydration and stimulus"` 并含 1 条；Task 4 往里追加 2 条
  （不补闭合括号）；Task 5 新建 `"M2 — real turn"` 并自带闭合 ✓
- 事件名 `agent_start` / `message_start` / `message_end` / `agent_settled` / `message_update`
  全部取自 `src/protocol/messages.ts` 的 `AGENT_EVENT_TYPES` ✓
- abort 返回 `void`、prompt 返回 `void`（`src/services/rpc/client.ts:198-205`），
  故用例只断言响应的 `success` 与状态变化，不取 `data` ✓
