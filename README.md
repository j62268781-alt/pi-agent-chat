# Pi Agent Chat

A VS Code extension that puts the [pi](https://github.com/badlogic/pi-mono) coding agent in your
editor: a Vue 3 chat panel and sidebar backed by a `pi --mode rpc` subprocess, a live editor bridge
the agent can call as tools, and a set of bundled pi extensions (questionnaire, permission
gate, file rewind) that work out of the box.

## Features

- **Chat panel and sidebar** — an editor-tab webview or a single activity-bar view, both driven by
  the same session controller. `pi-agent-chat.ui` picks the default surface.
- **Live editor bridge** — the agent gets real IDE state: active editor, selection, diagnostics,
  document/workspace symbols, definitions, references, hovers, code actions and document
  formatting. Tool results are truncated at 50 KB / 2000 lines.
- **Bundled pi extensions** — loaded into every session with `-e`:
  | extension | what it adds |
  | --- | --- |
  | `pi-extensions/pi-vscode-bridge.js` | the `vscode_*` LLM tools + TUI status |
  | `pi-extensions/questionnaire.ts` | interactive multi-question forms |
  | `pi-extensions/permission-gate.ts` | approval gate for dangerous bash commands |
  | `pi-extensions/rewind-code.ts` | sha256 file snapshots + rewind/accept UI |
- **Settings panel** — models, agents, prompt templates, skills, MCP servers, commit message
  generation, system prompt and general settings, plus install-state banners for the optional
  ecosystem packages below.
- **Commit messages from the SCM title bar**, generated from the staged diff via the pi SDK.
- **Editor and Explorer context menus** to send a selection or a file to the open chat.

## Optional pi ecosystem packages

Two capabilities are delegated to the user-installed pi ecosystem packages instead of being
bundled. The Settings panel detects both and shows a banner in the related tab — the tabs still
manage the config files either way, but the configs are inert until the package is installed.

| package                                                          | what it provides                                                                                                                                                  | config files                                                                                         | install                         |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------- |
| [`pi-subagents`](https://www.npmjs.com/package/pi-subagents)     | the `subagent` tool: delegate tasks to child agents with isolated contexts (single, parallel, async/background, workflows). Agents are defined as markdown files. | `~/.pi/agent/agents/*.md` — drop-in samples live in [`docs/examples/agents/`](docs/examples/agents/) | `pi install npm:pi-subagents`   |
| [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter) | MCP server connections: the servers configured in the MCP tab are only connected when this adapter is installed                                                   | `~/.pi/agent/mcp.json` (user) and `<workspace>/.mcp.json` (project), managed by the MCP tab          | `pi install npm:pi-mcp-adapter` |

Without a package the related tab shows a "NOT installed" banner with the install command;
with it installed the banner turns green and the config is live.

## Project layout

```
src/                       extension host (Node)
  extension.ts             entry point: pure wiring
  commands/                VSCode command handlers
  providers/               webview hosts (WebviewPanel / WebviewView)
    chat/                  chat panel, sidebar view, session controller, rewind provider
    settings/              settings panel
  services/                UI-decoupled core logic
    bridge/                local HTTP bridge that serves the pi process's LLM tools
    rpc/                   `pi --mode rpc` subprocess client (JSONL framing)
    agent/ models/ prompts/ skills/ mcp/ sessions/ git/ settings/
    pi/                    pi binary resolution + spawn target normalisation
  protocol/                the postMessage contract, shared with the webviews
  utils/                   small shared helpers
  types/                   ambient module declarations
webview-vue/               Vue 3 webviews (one Vite project, two builds)
  src/pages/               ChatPage.vue, SettingsPage.vue
  src/components/          transcript, composer, popups
  src/stores/              Pinia stores
  src/lib/                 framework-free helpers: markdown, math, mermaid, icons, i18n, paths
  index.html               shell with the host-injected `PI_*_PLACEHOLDER` needles
pi-extensions/             pi CLI extensions, loaded at runtime with `-e`
resources/                 icons and the pi icon font
l10n/                      extension-host localisation bundles
docs/design/               UI design references
dist/                      build output: extension.cjs + lazily-loaded chunks
```

### How the webviews are loaded

There is no `localResourceRoots` / `asWebviewUri` / CSP plumbing. Each webview is built by Vite into
a **single self-contained HTML file** (`vite-plugin-singlefile` inlines all JS, CSS and fonts). The
extension host embeds that file with `import html from ".../index.html?raw"` — a custom rolldown
plugin turns it into a string constant — and then substitutes `PI_*_PLACEHOLDER` needles with the
user's configuration before assigning `webview.html`.

The chat and settings webviews are two builds of the same Vite project, selected by `--mode`:

```bash
pnpm --filter @pi-agent-chat/webview-vue build   # dist/chat/index.html + dist/settings/index.html
```

### How the chat talks to pi

```
Vue webview  <-- postMessage -->  extension host  <-- JSONL over stdin/stdout -->  pi --mode rpc
```

`src/protocol/messages.ts` is the single source of truth for the postMessage half; both the host and
the webviews import it (the webviews through the `@protocol` alias), so a change on one side breaks
the build on the other.

The HTTP bridge in `src/services/bridge/` is a **separate** channel: it exists so the pi process can
call back into VS Code for editor state while running an LLM tool. It never carries chat traffic.

## Development

Requires Node 20+ and pnpm 10.

```bash
pnpm install
pnpm run build          # webviews, then the extension host
pnpm run dev            # watch the extension host only
pnpm run dev:webview    # Vite dev server for the chat webview
pnpm run typecheck      # extension host, pi extensions, webviews
pnpm run lint           # oxlint + oxfmt --check
pnpm run test:unit      # vitest
pnpm run test           # lint + typecheck + unit tests
pnpm run package        # produce a .vsix
```

To debug, run the **Run Extension** launch configuration and press <kbd>F5</kbd>; the Extension
Development Host opens with this extension loaded. For the webview side, run
`Developer: Open Webview Developer Tools` from the command palette in the development host.

### Type-checking the pi extensions

`pi-extensions/*.ts` are loaded by the `pi` CLI at runtime with no build step, but they still need
type-checking against the pi packages:

```bash
node scripts/typecheck-pi-extensions.mjs                  # everything
node scripts/typecheck-pi-extensions.mjs pi-extensions/questionnaire.ts   # one file
```

This runs as part of `pnpm run typecheck`.

### Build pipeline

`rolldown` bundles the extension host into CommonJS (VS Code's loader requires it) and keeps every
implementation module behind an `await import()` so activation stays cheap — the main chunk is ~27 KB
and the pi SDK only loads when a chat surface opens.

The `webview-vue` build must run **before** the rolldown build, because the host inlines the webview
HTML at bundle time.

### Stimulating the webview from the host

The chat panel cannot be driven from outside its own document, so `src/commands/testing.ts` exposes
`pi-agent-chat.__webviewMessage`, which dispatches a message exactly as the webview would; an
automated check can also observe the run through the `Pi Chat RPC` output channel that
`pi-agent-chat.rpcTrace` mirrors to disk.

`shouldRegisterTestingCommands()` keeps the command off the air unless the extension is running in
dev mode, so an install from a VSIX never registers it. Nothing in the repo uses it right now: the
end-to-end harness that drove it was removed on 2026-09-19 and is meant to return once the feature
set settles.

## Configuration

All settings live under `pi-agent-chat.*` — see the Settings panel
(<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>,</kbd>) or the VS Code Settings UI. The most relevant:

| setting                             | default          | meaning                                                                        |
| ----------------------------------- | ---------------- | ------------------------------------------------------------------------------ |
| `pi-agent-chat.ui`                  | `sidebar`        | `webview` (editor tab) or `sidebar`                                            |
| `pi-agent-chat.path`                | `""`             | absolute path to the `pi` binary; empty = auto-detect                          |
| `pi-agent-chat.language`            | `auto`           | `auto` / `en` / `zh-cn`                                                        |
| `pi-agent-chat.permission.mode`     | `AskForApproval` | gate bash commands matching `permission.dangerousPatterns`                     |
| `pi-agent-chat.disabledTools`       | `[]`             | bundled tools to keep unregistered (`vscode_get_diagnostics`, `questionnaire`) |
| `pi-agent-chat.chatFontSize`        | `14`             | transcript font size in px                                                     |
| `pi-agent-chat.chatBackgroundImage` | `""`             | optional background image path                                                 |

## Credits

This project is a ground-up restructure of
[pi-agent-studio](https://github.com/JohnnyZ93/pi-agent-studio) by Johnny Zhao — the extension host
was reorganised around `commands/ providers/ services/`, and the webviews were rewritten from
vanilla TypeScript DOM code into Vue 3. The bundled pi extensions, the editor bridge and the chat
protocol originate there.

## License

MIT
