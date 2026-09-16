// Markdown rendering for assistant prose and tool output.
//
// markdown-it renders synchronously to an HTML string; mermaid diagrams and
// KaTeX math are upgraded in place afterwards by `enhance()`, which is why the
// renderer marks those nodes with `data-tex` / `.pi-mermaid` instead of
// resolving them immediately.

import MarkdownIt from "markdown-it";
import type { RenderRule } from "markdown-it/lib/renderer.mjs";
import { enhance, mermaidFenceRule } from "./enhance.ts";
import { mathPlugin } from "./md-math.ts";

export const markdown: MarkdownIt = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
});

markdown.use(mathPlugin);

const defaultFence = markdown.renderer.rules.fence;
if (defaultFence) {
  markdown.renderer.rules.fence = mermaidFenceRule(defaultFence as RenderRule);
}

/** Render markdown to HTML. Safe to interpolate with `v-html` (html is off). */
export function renderMarkdown(source: string): string {
  if (!source) return "";
  return markdown.render(source);
}

/** Upgrade any mermaid/math nodes inside `target`. Idempotent. */
export async function enhanceRendered(target: HTMLElement | null): Promise<void> {
  if (!target) return;
  await enhance(target);
}
