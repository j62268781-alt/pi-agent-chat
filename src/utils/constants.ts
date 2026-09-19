export const TERMINAL_TITLE = "PI Code";

export const BRIDGE_EXTENSION_PATH = "pi-extensions/pi-vscode-bridge.js";
export const PERMISSION_GATE_EXTENSION_PATH = "pi-extensions/permission-gate.ts";
export const QUESTIONNAIRE_EXTENSION_PATH = "pi-extensions/questionnaire.ts";
export const REWIND_CODE_EXTENSION_PATH = "pi-extensions/rewind-code.ts";

/**
 * Extra system prompt for every pi session, so the agent knows the IDE bridge is
 * there and reaches for it instead of guessing.
 *
 * It names the tools on purpose: `bridge-tools.test.ts` checks that every
 * `vscode_*` name in here is actually registered by the bridge extension, so the
 * prompt cannot promise a tool that does not exist.
 */
export const BRIDGE_BOOTSTRAP_PROMPT = [
  "You are running inside VS Code with a live IDE bridge — use it instead of guessing about the user's editor:",
  "vscode_selection (what they have selected), vscode_open_editors, vscode_document_symbols (outline a file), vscode_workspace_symbols (find a symbol by name), vscode_definition / vscode_references / vscode_hover (language-server answers about a position), vscode_code_actions and vscode_apply_code_action (the IDE's own quick fixes, the second one edits files), vscode_get_diagnostics, vscode_open_file (show the user where something is), vscode_save_file, vscode_format, vscode_notifications.",
  "Positions are 0-based {line, character} — the same convention the tools and the diagnostics report, so a position from one call can be passed straight into the next.",
  "Prefer vscode_get_diagnostics over running a separate type-check: it is the IDE's own answer and it is already current.",
].join("\n");
