// Fixture payloads for the settings preview — one per tab, shaped by
// `SettingsTabDataMap` so the compiler keeps them honest when the contract
// changes. The point is typography and layout review, so the content is the
// kind of thing a real install reports: a couple of providers, a few agents,
// paths that look like paths.
//
// The `settings` tab renders every field from its defaults when a key is
// missing (`initialValue`), so `values` only carries what should look *set* —
// including a couple of non-defaults, which is what lights the dirty dots.

import type { SettingsTabDataMap } from "@protocol/settings";

const USER = "/Users/joeson/.pi/agent";

export const SETTINGS_FIXTURES: SettingsTabDataMap = {
  models: {
    providers: [
      { id: "qoder", name: "Qoder 目录", type: "custom", modelCount: 11 },
      { id: "solar", name: "Solar 中转", type: "custom", modelCount: 4 },
    ],
    modelsJson: {
      providers: {
        qoder: {
          name: "Qoder 目录",
          baseUrl: "https://api.example.invalid/v1",
          api: "openai-completions",
          models: [
            { id: "glm-5.3-flash", name: "GLM 5.3 Flash", reasoning: true, contextWindow: 128000 },
            { id: "qwen-4-coder", name: "Qwen 4 Coder", contextWindow: 32768 },
          ],
        },
        solar: {
          name: "Solar 中转",
          baseUrl: "https://relay.example.invalid/v1",
          api: "anthropic-messages",
          models: [{ id: "claude-sonnet-5", name: "Claude Sonnet 5", reasoning: true }],
        },
      },
    },
    oauthStatuses: [
      { id: "anthropic", name: "Anthropic", connected: true },
      { id: "github", name: "GitHub Copilot", connected: false },
    ],
    apikeyStatuses: [
      { id: "openai", name: "OpenAI", configured: false, modelCount: 0 },
      { id: "deepseek", name: "DeepSeek", configured: true, modelCount: 2 },
    ],
  },

  agents: {
    hasWorkspace: true,
    agentsDir: `${USER}/agents`,
    models: ["qoder/glm-5.3-flash", "qoder/qwen-4-coder", "solar/claude-sonnet-5"],
    piSubagents: {
      name: "pi-subagents",
      installed: true,
      pkgDir: `${USER}/npm/node_modules/pi-subagents`,
      installCommand: "pi install npm:pi-subagents",
    },
    agents: [
      {
        name: "reviewer",
        description: "读 diff，按严重级别列问题，不改代码。",
        tools: ["read", "grep"],
        model: "qoder/glm-5.3-flash",
        systemPrompt: "You are a code reviewer.",
        disableModelInvocation: false,
        isBuiltin: false,
        hasOverride: true,
        source: "user",
        filePath: `${USER}/agents/reviewer.md`,
      },
      {
        name: "explore",
        description: "在陌生代码库里定位实现位置。",
        systemPrompt: "You are an explorer.",
        disableModelInvocation: false,
        isBuiltin: true,
        hasOverride: false,
        source: "builtin",
        filePath: "/opt/pi/agents/explore.md",
      },
    ],
  },

  prompts: {
    hasWorkspace: true,
    prompts: [
      {
        name: "commit",
        description: "按仓库风格生成提交信息",
        argumentHint: "[scope]",
        content: "Summarize the staged diff in one imperative line.",
        filePath: `${USER}/prompts/commit.md`,
        scope: "user",
        origin: "file",
        source: "user",
        editable: true,
        sourceLabel: "User",
      },
      {
        name: "translate",
        description: "把选中文案译成简体中文",
        argumentHint: null,
        content: "Translate the following to zh-CN.",
        filePath: "/Users/joeson/Documents/pi-agent-chat/.pi/prompts/translate.md",
        scope: "project",
        origin: "file",
        source: "project",
        editable: true,
        sourceLabel: "Project",
      },
    ],
  },

  skills: {
    hasWorkspace: true,
    skills: [
      {
        name: "release-notes",
        description: "从两个 ref 之间的提交起草发布说明。",
        disableModelInvocation: false,
        body: "Group commits by scope, then write the notes.",
        filePath: `${USER}/skills/release-notes/SKILL.md`,
        baseDir: `${USER}/skills/release-notes`,
        scope: "user",
        sourceLabel: "User",
        editable: true,
      },
    ],
  },

  mcp: {
    hasWorkspace: true,
    userPath: `${USER}/mcp.json`,
    projectPath: "/Users/joeson/Documents/pi-agent-chat/.pi/mcp.json",
    mcpAdapter: {
      name: "pi-mcp-adapter",
      installed: false,
      pkgDir: `${USER}/npm/node_modules/pi-mcp-adapter`,
      installCommand: "pi install npm:pi-mcp-adapter",
    },
    servers: [
      {
        name: "github",
        source: "user",
        entry: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
      },
      {
        name: "internal-docs",
        source: "project",
        entry: { url: "https://docs.example.invalid/mcp", disabled: true },
      },
    ],
  },

  commit: {
    commitModel: "qoder/qwen-4-coder",
    commitLanguage: "简体中文",
    commitMessagePrompt: "用一行祈使句概括暂存区改动，正文解释为什么改，不超过 72 列。",
    languages: ["English", "简体中文", "日本語"],
    models: ["qoder/glm-5.3-flash", "qoder/qwen-4-coder", "solar/claude-sonnet-5"],
  },

  sysprompt: {
    systemPrompt: {
      content: "You are pi, a coding agent. Prefer editing existing files.",
    },
    appendSystemPrompt: {
      content: "回答一律使用简体中文，代码注释保留英文。",
    },
  },

  general: {
    values: {
      chatRunningSendBehavior: "steer",
    },
  },

  settings: {
    values: {
      defaultProvider: "qoder",
      defaultModel: "glm-5.3-flash",
      defaultThinkingLevel: "medium",
      theme: "dark",
      quietStartup: true,
      "compaction.enabled": true,
      "compaction.keepRecentTokens": 12000,
      "branchSummary.reserveTokens": 8000,
      "retry.maxRetries": 4,
      "images.autoResize": true,
      "markdown.mermaid": true,
      shellCommandPrefix: "set -a; . ~/.pi/env; set +a",
    },
  },
};
