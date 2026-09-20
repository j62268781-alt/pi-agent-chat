import type { RenderRule } from "markdown-it/lib/renderer.mjs";
import { mermaidTheme as configuredMermaidTheme } from "./injected.ts";

let mermaidReady: Promise<typeof import("mermaid")> | null = null;
let katexReady: Promise<typeof import("katex")> | null = null;
let katexCssInjected = false;
let mermaidInitialized = false;
let seq = 0;

function loadMermaid(): Promise<typeof import("mermaid")> {
  if (!mermaidReady) mermaidReady = import("mermaid");
  return mermaidReady;
}

function loadKatex(): Promise<typeof import("katex")> {
  if (!katexReady) katexReady = import("katex");
  return katexReady;
}

const MERMAID_THEMES = ["default", "dark", "forest", "neutral", "base"] as const;

type MermaidTheme = (typeof MERMAID_THEMES)[number];

/**
 * The mermaid theme to draw with.
 *
 * An explicit `chatMermaidTheme` wins. Left on `default`, follow the VS Code
 * theme instead: mermaid's `default` theme inks dark on a transparent canvas,
 * which is unreadable on a dark surface — that is why the diagram container used
 * to be pinned white. With `dark` for dark themes the container can be a token.
 */
export function resolveMermaidTheme(): MermaidTheme {
  const configured = (configuredMermaidTheme() || "default").toLowerCase();
  if (configured !== "default" && (MERMAID_THEMES as readonly string[]).indexOf(configured) >= 0) {
    return configured as MermaidTheme;
  }
  return document.body.classList.contains("vscode-light") ? "default" : "dark";
}

let resolvedMermaidTheme: MermaidTheme | null = null;

function currentMermaidTheme(): MermaidTheme {
  resolvedMermaidTheme ??= resolveMermaidTheme();
  return resolvedMermaidTheme;
}

/** Set once the body-class observer is in place; the webview outlives renders. */
let themeWatcherInstalled = false;

/**
 * VS Code repaints a webview into a new theme without reloading it, so nothing
 * would re-run `mermaid.initialize`: a diagram would keep the ink of the theme
 * it was drawn under, on a container that has just changed colour. The body
 * class is the only signal the webview gets, so watch it.
 */
function installThemeWatcher(): void {
  if (themeWatcherInstalled) return;
  themeWatcherInstalled = true;
  new MutationObserver(() => {
    const next = resolveMermaidTheme();
    if (next === resolvedMermaidTheme) return;
    resolvedMermaidTheme = next;
    // Re-initialise on the next draw, then redraw what is already on screen.
    mermaidInitialized = false;
    void redrawMermaid();
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
}

/** Draw (or redraw) mermaid nodes, keeping each diagram's source on the node. */
async function renderMermaid(nodes: HTMLElement[]): Promise<void> {
  if (nodes.length === 0) return;
  try {
    const mermaid = (await loadMermaid()).default;
    if (!mermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: currentMermaidTheme(),
      });
      mermaidInitialized = true;
    }
    for (const node of nodes) {
      const source = node.dataset.src ?? node.querySelector("code")?.textContent ?? "";
      node.dataset.src = source;
      node.setAttribute("data-r", "1");
      try {
        const { svg } = await mermaid.render(`pi-mermaid-${seq++}`, source);
        node.innerHTML = svg;
      } catch {
        node.classList.add("pi-mermaid-error");
      }
    }
  } catch {
    for (const node of nodes) node.classList.add("pi-mermaid-error");
  }
}

async function redrawMermaid(): Promise<void> {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(".pi-mermaid[data-r]"));
  for (const node of nodes) node.classList.remove("pi-mermaid-error");
  await renderMermaid(nodes);
}

function escapeCode(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mermaidFenceRule(defaultFence: RenderRule): RenderRule {
  return (tokens, idx, options, env, slf) => {
    const token = tokens[idx];
    if (token?.info?.trim().split(/\s+/g)[0] === "mermaid") {
      return `<div class="pi-mermaid"><pre><code>${escapeCode(token.content)}</code></pre></div>\n`;
    }
    return defaultFence(tokens, idx, options, env, slf);
  };
}

async function ensureKatexCss(): Promise<void> {
  if (katexCssInjected || document.getElementById("pi-katex-css")) {
    katexCssInjected = true;
    return;
  }
  const mod = await import("katex/dist/katex.min.css?inline");
  const style = document.createElement("style");
  style.id = "pi-katex-css";
  style.textContent = mod.default;
  document.head.appendChild(style);
  katexCssInjected = true;
}

export async function enhance(target: HTMLElement): Promise<void> {
  installThemeWatcher();
  const mermaidNodes = Array.from(
    target.querySelectorAll<HTMLElement>(".pi-mermaid:not([data-r])"),
  );
  const mathNodes = Array.from(target.querySelectorAll<HTMLElement>(".pi-math:not([data-r])"));

  await renderMermaid(mermaidNodes);

  if (mathNodes.length) {
    try {
      const katex = (await loadKatex()).default;
      await ensureKatexCss();
      for (const node of mathNodes) {
        node.setAttribute("data-r", "1");
        const tex = decodeURIComponent(node.getAttribute("data-tex") || "");
        try {
          node.innerHTML = katex.renderToString(tex, {
            displayMode: node.classList.contains("pi-math-block"),
            throwOnError: false,
          });
        } catch {
          node.textContent = tex;
          node.classList.add("pi-math-error");
        }
      }
    } catch {
      for (const node of mathNodes) node.classList.add("pi-math-error");
    }
  }
}

export { mermaidFenceRule };
