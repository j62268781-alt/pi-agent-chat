import http from "node:http";
import path from "node:path";

export default function (pi) {
  const bridgeUrl = process.env.PI_VSCODE_BRIDGE_URL;
  const bridgeSocket = process.env.PI_VSCODE_BRIDGE_SOCKET;
  const bridgeToken = process.env.PI_VSCODE_BRIDGE_TOKEN;

  if ((!bridgeUrl && !bridgeSocket) || !bridgeToken) return;

  const statusBarEnabled = process.env.PI_VSCODE_STATUS_BAR !== "0";
  const disabledTools = (() => {
    try {
      const parsed = JSON.parse(process.env.PI_VSCODE_DISABLED_TOOLS ?? "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const MAX_RESULT_BYTES = 50 * 1024;
  const MAX_RESULT_LINES = 2000;
  const STATUS_ID = "pi-vscode";
  const STATUS_REFRESH_MS = 1500;
  const MAX_STATUS_PATH_LENGTH = 48;
  let statusTimer;
  let statusRefreshInFlight = false;
  let statusGeneration = 0;
  let lastStatusKey;

  const callBridge = async (method, params = {}) => {
    const body = JSON.stringify({ method, params });
    const headers = {
      "content-type": "application/json",
      "x-pi-vscode-authorization": bridgeToken,
    };
    const requestOptions = { method: "POST", headers };
    const response = await new Promise((resolve, reject) => {
      // http.request with an options object as the FIRST argument takes the
      // callback as the SECOND argument — a separate options object there would
      // be misinterpreted as the callback and throw ERR_INVALID_ARG_TYPE.
      const req = bridgeSocket
        ? http.request({ socketPath: bridgeSocket, path: "/rpc", ...requestOptions }, resolve)
        : http.request(`${bridgeUrl}/rpc`, requestOptions, resolve);
      req.on("error", reject);
      req.end(body);
    });

    const chunks = [];
    for await (const chunk of response) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    let payload;
    try {
      payload = JSON.parse(text || "{}");
    } catch {
      payload = {};
    }
    if (response.statusCode !== 200) {
      const message = payload?.error || `Bridge request failed with status ${response.statusCode}`;
      throw new Error(message);
    }
    return payload?.result;
  };

  const truncateText = (text) => {
    const lines = text.split("\n");
    let output =
      lines.length > MAX_RESULT_LINES ? lines.slice(0, MAX_RESULT_LINES).join("\n") : text;
    if (Buffer.byteLength(output, "utf8") > MAX_RESULT_BYTES) {
      const buffer = Buffer.from(output, "utf8");
      output = buffer.subarray(0, MAX_RESULT_BYTES).toString("utf8");
    }
    return output;
  };

  const boundedJson = (value) => {
    const text = JSON.stringify(value) ?? "null";
    const lineCount = text.split("\n").length;
    const byteCount = Buffer.byteLength(text, "utf8");
    if (lineCount <= MAX_RESULT_LINES && byteCount <= MAX_RESULT_BYTES) return text;
    return JSON.stringify({
      truncated: true,
      message:
        "VS Code bridge result exceeded output limits. Re-run the tool with a narrower file/range/query if you need complete structured data.",
      originalBytes: byteCount,
      originalLines: lineCount,
      resultJsonPrefix: truncateText(text),
    });
  };

  const jsonResult = async (method, params) => ({
    content: [{ type: "text", text: boundedJson(await callBridge(method, params)) }],
    details: {},
  });

  const workspaceRelativePath = (filePath, workspaceFolders = []) => {
    if (!filePath) return "";
    const roots = [
      ...workspaceFolders.map((folder) => folder?.filePath).filter(Boolean),
      process.cwd(),
    ];

    let best = filePath;
    for (const root of roots) {
      const relative = path.relative(root, filePath);
      if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
        if (!relative) return path.basename(filePath);
        if (relative.length < best.length) best = relative;
      }
    }
    return best;
  };

  const shortenPath = (filePath) => {
    if (filePath.length <= MAX_STATUS_PATH_LENGTH) return filePath;
    const parts = filePath.split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 2) return `…${filePath.slice(-(MAX_STATUS_PATH_LENGTH - 1))}`;
    const shortened = `…/${parts.slice(-2).join("/")}`;
    if (shortened.length <= MAX_STATUS_PATH_LENGTH) return shortened;
    return `…${shortened.slice(-(MAX_STATUS_PATH_LENGTH - 1))}`;
  };

  const formatSelectionStatus = (selection) => {
    if (!selection) return "no selection";
    const startLine = selection.start.line + 1;
    const startCharacter = selection.start.character + 1;
    const endLine = selection.end.line + 1;
    const endCharacter = selection.end.character + 1;
    if (selection.isEmpty) return `Ln ${startLine}, Col ${startCharacter}`;

    const selectedCharacters = selection.selectedCharacterCount ?? selection.text?.length;
    if (startLine === endLine) {
      const size = selectedCharacters === undefined ? "" : ` ${selectedCharacters} chars`;
      return `sel${size} @ ${startLine}:${startCharacter}-${endCharacter}`;
    }
    return `sel ${selection.selectedLineCount ?? endLine - startLine + 1} lines @ ${startLine}-${endLine}`;
  };

  const diagnosticsStatus = (counts) => {
    const parts = [];
    if (counts.errors) parts.push(`E${counts.errors}`);
    if (counts.warnings) parts.push(`W${counts.warnings}`);
    if (counts.infos) parts.push(`I${counts.infos}`);
    if (counts.hints) parts.push(`H${counts.hints}`);
    return parts.length > 0 ? parts.join(" ") : "✓";
  };

  const formatStatus = (status, ctx) => {
    const theme = ctx.ui.theme;
    const prefix = theme.fg("accent", "VS Code");
    const activeEditor = status?.activeEditor;
    if (!activeEditor?.filePath) return `${prefix}: ${theme.fg("dim", "no active editor")}`;

    const relativePath = shortenPath(
      workspaceRelativePath(activeEditor.filePath, status.workspaceFolders),
    );
    const dirty = activeEditor.isDirty ? theme.fg("warning", "● ") : "";
    const language = activeEditor.languageId ? ` • ${activeEditor.languageId}` : "";
    const selectionText = formatSelectionStatus(status.selection);
    const diagnosticCounts = status.diagnostics ?? { errors: 0, warnings: 0, infos: 0, hints: 0 };
    const issueText = diagnosticsStatus(diagnosticCounts);
    const coloredIssues =
      diagnosticCounts.errors > 0
        ? theme.fg("error", issueText)
        : diagnosticCounts.warnings > 0
          ? theme.fg("warning", issueText)
          : theme.fg("success", issueText);

    return `${prefix}: ${dirty}${relativePath} • ${selectionText}${language} • ${coloredIssues}`;
  };

  const setStatus = (ctx, statusKey, statusText) => {
    if (!statusBarEnabled || !ctx?.hasUI) return;
    if (statusKey === lastStatusKey) return;
    lastStatusKey = statusKey;
    ctx.ui.setStatus(STATUS_ID, statusText);
  };

  const refreshStatus = async (ctx, generation = statusGeneration) => {
    if (
      !statusBarEnabled ||
      !ctx?.hasUI ||
      generation !== statusGeneration ||
      statusRefreshInFlight
    )
      return;
    statusRefreshInFlight = true;
    try {
      const status = await callBridge("getStatus");
      if (generation !== statusGeneration) return;
      const statusText = formatStatus(status, ctx);
      setStatus(ctx, statusText, statusText);
    } catch (error) {
      if (generation !== statusGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      const statusText = `${ctx.ui.theme.fg("accent", "VS Code")}: ${ctx.ui.theme.fg(
        "warning",
        `bridge unavailable (${message})`,
      )}`;
      setStatus(ctx, `error:${message}`, statusText);
    } finally {
      statusRefreshInFlight = false;
    }
  };

  const stopStatusUpdates = (ctx) => {
    if (!statusBarEnabled) return;
    if (statusTimer) {
      clearInterval(statusTimer);
      statusTimer = undefined;
    }
    statusGeneration++;
    lastStatusKey = undefined;
    if (ctx?.hasUI) ctx.ui.setStatus(STATUS_ID, undefined);
  };

  const startStatusUpdates = (ctx) => {
    if (!statusBarEnabled || !ctx?.hasUI) return;
    stopStatusUpdates(ctx);
    const generation = statusGeneration;
    void refreshStatus(ctx, generation);
    statusTimer = setInterval(() => {
      void refreshStatus(ctx, generation);
    }, STATUS_REFRESH_MS);
  };

  const reportTerminalSession = async (ctx) => {
    const terminalId = process.env.PI_VSCODE_TERMINAL_ID;
    if (!terminalId) return;
    const sessionFile = ctx?.sessionManager?.getSessionFile?.();
    if (!sessionFile) return;
    try {
      await callBridge("reportTerminalSession", { terminalId, sessionFile });
    } catch {}
  };

  const reportStatus = (status) => {
    const terminalId = process.env.PI_VSCODE_TERMINAL_ID;
    if (!terminalId) return;
    void callBridge("reportSessionStatus", { terminalId, status }).catch(() => {});
  };

  pi.on("session_start", async (_event, ctx) => {
    startStatusUpdates(ctx);
    await reportTerminalSession(ctx);
    reportStatus("idle");
  });

  pi.on("input", async (_event, ctx) => {
    void refreshStatus(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    void refreshStatus(ctx);
  });

  pi.on("agent_start", async (_event, _ctx) => {
    reportStatus("running");
  });

  pi.on("agent_settled", async (_event, _ctx) => {
    reportStatus("idle");
    void callBridge("showNotification", { message: "Pi: Task Completed!", type: "info" }).catch(
      () => {},
    );
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopStatusUpdates(ctx);
    reportStatus("closed");
  });

  // ── LLM tools (gated by PI_VSCODE_DISABLED_TOOLS blocklist) ──

  const registerToolIfEnabled = (definition) => {
    if (disabledTools.includes(definition.name)) return;
    pi.registerTool(definition);
  };

  registerToolIfEnabled({
    name: "vscode_get_diagnostics",
    label: "VS Code Diagnostics",
    description:
      "Get VS Code diagnostics (LSP, lint, or type errors) for a file or the full workspace.",
    promptSnippet: "Read current VS Code diagnostics for a file or the workspace.",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Optional absolute or workspace-relative file path",
        },
      },
      additionalProperties: false,
    },
    execute: async (_toolCallId, params) => jsonResult("getDiagnostics", params),
  });

  // ── IDE navigation and actions ───────────────────────────────────────────
  //
  // The host has implemented these all along; nothing reached them, so the agent
  // could only read files and guess. Positions are 0-based `{line, character}`,
  // the same convention `vscode_selection` and the diagnostics report, so a
  // position from one tool can be fed straight back into another.

  const FILE_PATH = { type: "string", description: "Absolute or workspace-relative file path" };
  const LINE = { type: "number", description: "0-based line number" };
  const CHARACTER = { type: "number", description: "0-based character offset in the line" };

  /** The shape every position-taking method wants. */
  const withPosition = (extra = {}) => ({
    type: "object",
    properties: { filePath: FILE_PATH, line: LINE, character: CHARACTER, ...extra },
    required: ["filePath", "line", "character"],
    additionalProperties: false,
  });

  const atPosition = (params) => ({
    filePath: params.filePath,
    position: { line: params.line, character: params.character },
  });

  registerToolIfEnabled({
    name: "vscode_selection",
    label: "VS Code Selection",
    description:
      "The editor's current selection — file, text and 0-based coordinates. Falls back to the most recent selection when no editor is focused.",
    promptSnippet: "Read what the user has selected in VS Code.",
    parameters: {
      type: "object",
      properties: {
        latest: {
          type: "boolean",
          description: "Use the most recent selection even if an editor is focused",
        },
      },
      additionalProperties: false,
    },
    execute: async (_toolCallId, params) =>
      jsonResult(params.latest ? "getLatestSelection" : "getCurrentSelection"),
  });

  registerToolIfEnabled({
    name: "vscode_open_editors",
    label: "VS Code Open Editors",
    description: "Files open in the editor right now, with language and dirty state.",
    promptSnippet: "List the files the user has open.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => jsonResult("getOpenEditors"),
  });

  registerToolIfEnabled({
    name: "vscode_document_symbols",
    label: "VS Code Document Symbols",
    description:
      "Outline one file: functions, classes and methods with their ranges. Cheaper than reading the whole file.",
    promptSnippet: "Outline a file's symbols instead of reading it whole.",
    parameters: {
      type: "object",
      properties: { filePath: FILE_PATH },
      required: ["filePath"],
      additionalProperties: false,
    },
    execute: async (_toolCallId, params) =>
      jsonResult("getDocumentSymbols", { filePath: params.filePath }),
  });

  registerToolIfEnabled({
    name: "vscode_workspace_symbols",
    label: "VS Code Workspace Symbols",
    description:
      "Search symbols across the workspace by name — the fastest way to find where something lives.",
    promptSnippet: "Find a symbol across the workspace.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Symbol name or fragment" } },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (_toolCallId, params) =>
      jsonResult("getWorkspaceSymbols", { query: params.query }),
  });

  registerToolIfEnabled({
    name: "vscode_definition",
    label: "VS Code Definition",
    description:
      "Jump from a position to what it refers to: the definition, its type, an implementation or a declaration.",
    promptSnippet: "Go to the definition/type/implementation of a symbol.",
    parameters: withPosition({
      kind: {
        type: "string",
        enum: ["definition", "type", "implementation", "declaration"],
        description: "Which relationship to follow (default: definition)",
      },
    }),
    execute: async (_toolCallId, params) => {
      switch (params.kind) {
        case "type":
          return jsonResult("getTypeDefinitions", atPosition(params));
        case "implementation":
          return jsonResult("getImplementations", atPosition(params));
        case "declaration":
          return jsonResult("getDeclarations", atPosition(params));
        default:
          return jsonResult("getDefinitions", atPosition(params));
      }
    },
  });

  registerToolIfEnabled({
    name: "vscode_references",
    label: "VS Code References",
    description: "Everything that references the symbol at a position, across the workspace.",
    promptSnippet: "Find every reference to a symbol.",
    parameters: withPosition(),
    execute: async (_toolCallId, params) => jsonResult("getReferences", atPosition(params)),
  });

  registerToolIfEnabled({
    name: "vscode_hover",
    label: "VS Code Hover",
    description: "The type, signature and docs the language server shows at a position.",
    promptSnippet: "Read the type/docs at a position.",
    parameters: withPosition(),
    execute: async (_toolCallId, params) => jsonResult("getHover", atPosition(params)),
  });

  registerToolIfEnabled({
    name: "vscode_code_actions",
    label: "VS Code Code Actions",
    description:
      "Quick fixes and refactors the language server offers for a position or range, each with an id for vscode_apply_code_action.",
    promptSnippet: "List the quick fixes available at a position.",
    parameters: withPosition({
      endLine: {
        type: "number",
        description: "0-based end line, for a range (default: the same position)",
      },
      endCharacter: { type: "number", description: "0-based end character, for a range" },
    }),
    execute: async (_toolCallId, params) => {
      const start = { line: params.line, character: params.character };
      const hasRange =
        typeof params.endLine === "number" && typeof params.endCharacter === "number";
      const end = hasRange ? { line: params.endLine, character: params.endCharacter } : start;
      return jsonResult("getCodeActions", {
        filePath: params.filePath,
        selection: { start, end },
      });
    },
  });

  registerToolIfEnabled({
    name: "vscode_apply_code_action",
    label: "VS Code Apply Code Action",
    description:
      "Run one of the actions vscode_code_actions returned, by its id. This edits files through the real IDE, so it is a write.",
    promptSnippet: "Apply a code action by id.",
    parameters: {
      type: "object",
      properties: { actionId: { type: "string", description: "Id from vscode_code_actions" } },
      required: ["actionId"],
      additionalProperties: false,
    },
    execute: async (_toolCallId, params) =>
      jsonResult("executeCodeAction", { actionId: params.actionId }),
  });

  registerToolIfEnabled({
    name: "vscode_open_file",
    label: "VS Code Open File",
    description:
      "Open a file in the editor, optionally revealing a position — how you show the user where something is.",
    promptSnippet: "Open a file (and position) in the editor.",
    parameters: {
      type: "object",
      properties: {
        filePath: FILE_PATH,
        line: LINE,
        character: CHARACTER,
        preview: { type: "boolean", description: "Reuse the preview tab (default: a normal tab)" },
      },
      required: ["filePath"],
      additionalProperties: false,
    },
    execute: async (_toolCallId, params) => {
      const body = { filePath: params.filePath };
      if (typeof params.preview === "boolean") body.preview = params.preview;
      if (typeof params.line === "number") {
        const at = {
          line: params.line,
          character: typeof params.character === "number" ? params.character : 0,
        };
        body.selection = { start: at, end: at };
      }
      return jsonResult("openFile", body);
    },
  });

  registerToolIfEnabled({
    name: "vscode_save_file",
    label: "VS Code Save File",
    description: "Save a file through the editor and report whether it had unsaved changes.",
    promptSnippet: "Save a file through the editor.",
    parameters: {
      type: "object",
      properties: { filePath: FILE_PATH },
      required: ["filePath"],
      additionalProperties: false,
    },
    execute: async (_toolCallId, params) =>
      jsonResult("saveDocument", { filePath: params.filePath }),
  });

  registerToolIfEnabled({
    name: "vscode_format",
    label: "VS Code Format",
    description:
      "Format a file — or a range of it — with the formatter the editor is configured to use.",
    promptSnippet: "Format a file or range with the editor's formatter.",
    parameters: {
      type: "object",
      properties: {
        filePath: FILE_PATH,
        startLine: LINE,
        startCharacter: CHARACTER,
        endLine: LINE,
        endCharacter: CHARACTER,
      },
      required: ["filePath"],
      additionalProperties: false,
    },
    execute: async (_toolCallId, params) => {
      const hasRange = typeof params.startLine === "number" && typeof params.endLine === "number";
      if (!hasRange) return jsonResult("formatDocument", { filePath: params.filePath });
      return jsonResult("formatRange", {
        filePath: params.filePath,
        selection: {
          start: {
            line: params.startLine,
            character: typeof params.startCharacter === "number" ? params.startCharacter : 0,
          },
          end: {
            line: params.endLine,
            character: typeof params.endCharacter === "number" ? params.endCharacter : 0,
          },
        },
      });
    },
  });

  registerToolIfEnabled({
    name: "vscode_notifications",
    label: "VS Code Notifications",
    description:
      "Recent VS Code notifications — errors another extension surfaced, for instance — optionally clearing them.",
    promptSnippet: "Read (or clear) VS Code notifications.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "How many to return (default 20, max 100)" },
        since: { type: "number", description: "Only entries newer than this timestamp" },
        clear: { type: "boolean", description: "Clear them after reading" },
      },
      additionalProperties: false,
    },
    execute: async (_toolCallId, params) => {
      const result = await jsonResult("getNotifications", {
        limit: params.limit,
        since: params.since,
      });
      if (params.clear) await callBridge("clearNotifications");
      return result;
    },
  });

  // ── Slash commands ──

  const resolveCurrentContext = async () => {
    try {
      const state = await callBridge("getEditorState");
      return {
        filePath: state?.activeEditor?.filePath,
        position: state?.currentSelection?.start,
      };
    } catch {
      return {};
    }
  };

  const looksLikePath = (s) => s && (s.includes("/") || s.includes("\\") || s.includes("."));

  pi.registerCommand("vscode-selection", {
    description: "Get the current VS Code Editor selection text and coordinates",
    handler: async (args, _ctx) => {
      const result = await callBridge("getCurrentSelection");
      const json = JSON.stringify(result);
      const intent = args?.trim();
      const prefix = intent
        ? `${intent}\n\n/vscode-selection result:\n`
        : `/vscode-selection result:\n`;
      pi.sendUserMessage(`${prefix}\`\`\`json\n${json}\n\`\`\``);
    },
  });

  pi.registerCommand("vscode-diagnostics", {
    description: "Get VS Code diagnostic information (optional file path parameters)",
    handler: async (args, _ctx) => {
      const parts = args?.trim().split(/\s+/) ?? [];
      let filePath;
      let intent;

      if (parts.length > 0 && looksLikePath(parts[0])) {
        filePath = parts[0];
        intent = parts.slice(1).join(" ") || undefined;
      } else {
        const context = await resolveCurrentContext();
        filePath = context.filePath;
        intent = args?.trim() || undefined;
      }

      const result = await callBridge("getDiagnostics", filePath ? { filePath } : {});
      const json = JSON.stringify(result);
      const prefix = intent
        ? `${intent}\n\n/vscode-diagnostics result:\n`
        : `/vscode-diagnostics result:\n`;
      pi.sendUserMessage(`${prefix}\`\`\`json\n${json}\n\`\`\``);
    },
  });

  pi.registerCommand("pi-vscode-tree", {
    description: "Navigate to a point in the session tree",
    handler: async (args, ctx) => {
      const targetId = args?.trim();
      if (!targetId) return;
      await ctx.navigateTree(targetId, { summarize: false });
    },
  });
}
