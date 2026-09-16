// Maps a model id to a vendor logo. The lookup table is generated at build time
// by `scripts/extract-model-icons.mjs` from `@lobehub/icons`.

import { DEFAULT_MODEL_ICON, MODEL_ICONS, type ModelIconEntry } from "./model-icons-data.ts";

/** Longest-prefix lookup after stripping a `provider/` prefix. */
export function getModelIcon(modelName: string | null | undefined): ModelIconEntry {
  const name = String(modelName ?? "");
  const slash = name.indexOf("/");
  const lower = (slash >= 0 ? name.slice(slash + 1) : name).toLowerCase();
  for (const entry of MODEL_ICONS) {
    for (const prefix of entry.prefixes) {
      if (lower.startsWith(prefix)) return entry;
    }
  }
  return DEFAULT_MODEL_ICON;
}

export function escapeHtml(value: string | null | undefined): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Inline SVG avatar markup. Used with `v-html` inside the icon slot. */
export function modelIconHtml(
  icon: ModelIconEntry | null | undefined,
  extraClass?: string,
): string {
  const entry = icon ?? DEFAULT_MODEL_ICON;
  const paths = entry.paths.map((d) => `<path d="${d}"></path>`).join("");
  const classes = extraClass ? `model-icon-avatar ${extraClass}` : "model-icon-avatar";
  return `<span class="${classes}" style="background:${entry.color}"><svg viewBox="0 0 24 24" fill="#fff" fill-rule="evenodd" aria-hidden="true">${paths}</svg></span>`;
}
