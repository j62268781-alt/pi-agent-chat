import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// ============================================================================
// Path helpers — pure Node.js, mirrors src/models/models-config.ts
// ============================================================================

export function getSystemPromptPath(): string {
  return join(getAgentDir(), "SYSTEM.md");
}

export function getAppendSystemPromptPath(): string {
  return join(getAgentDir(), "APPEND_SYSTEM.md");
}

export function getSettingsJsonPath(): string {
  return join(getAgentDir(), "settings.json");
}

// ============================================================================
// Read / Write helpers
// ============================================================================

export function readTextFile(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function writeTextFile(path: string, content: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, content, "utf8");
}

/** Ensure settings.json exists (create empty `{}` if missing) and return its path. */
export function ensureSettingsJsonExists(): string {
  const path = getSettingsJsonPath();
  if (!existsSync(path)) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, "{}\n", "utf8");
  }
  return path;
}

/** Ensure a markdown prompt file exists (create empty file if missing) and return its path. */
export function ensurePromptFileExists(path: string): string {
  if (!existsSync(path)) writeTextFile(path, "");
  return path;
}

// ============================================================================
// enabledModels (model favorites) - read/write ~/.pi/agent/settings.json
// pi treats enabledModels as an allowlist (glob/exact "provider/model" patterns);
// here we only manage exact "provider/model" entries and leave globs untouched.
// ============================================================================

function isGlobPattern(s: string): boolean {
  return s.indexOf("*") >= 0 || s.indexOf("?") >= 0 || s.indexOf("[") >= 0;
}

export function modelKey(provider: string, id: string): string {
  return provider + "/" + id;
}

function parseSettingsJson(): Record<string, any> {
  const text = readTextFile(getSettingsJsonPath());
  if (!text.trim()) return {};
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === "object" ? (obj as Record<string, any>) : {};
  } catch {
    return {};
  }
}

function writeSettingsJson(obj: Record<string, any>): void {
  writeTextFile(getSettingsJsonPath(), JSON.stringify(obj, null, 2) + "\n");
}

/** Read parsed settings.json (missing or invalid -> {}). */
export function readSettingsJson(): Record<string, any> {
  return parseSettingsJson();
}

/**
 * Parse settings.json for a write, refusing to read a broken file as empty.
 *
 * Every write here is read-merge-write, so a parser that swallows its error and
 * returns `{}` turns a file we cannot read into a file we overwrite: the user
 * keeps one key and loses the rest. pi accepts comments in this file, so the
 * unparseable case is a real user's file, not a corrupt-disk edge case. Reads
 * stay lenient — showing defaults beats throwing on every panel open.
 */
function parseSettingsForWrite(): Record<string, any> {
  const text = readTextFile(getSettingsJsonPath());
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `settings.json could not be parsed (${e instanceof Error ? e.message : String(e)}), so nothing was written. ` +
        "Fix the file and try again — saving now would drop the settings we cannot read.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "settings.json does not hold a JSON object, so nothing was written. Expected a top-level `{...}`.",
    );
  }
  return parsed as Record<string, any>;
}

/**
 * Deep-merge a patch into settings. Nested plain objects are merged
 * recursively (preserving untouched sibling keys); arrays/scalars replace.
 */
export function mergeSettingsPatch(
  base: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      cur !== null &&
      typeof cur === "object" &&
      !Array.isArray(cur)
    ) {
      out[k] = mergeSettingsPatch(cur, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Merge patch into the persisted settings.json and write it back. */
export function saveSettingsPatch(patch: Record<string, any>): void {
  writeSettingsJson(mergeSettingsPatch(parseSettingsForWrite(), patch));
}

/** Lowercased exact "provider/id" keys from enabledModels (globs ignored). */
export function readEnabledModelKeys(): string[] {
  const arr = Array.isArray(parseSettingsJson().enabledModels)
    ? parseSettingsJson().enabledModels
    : [];
  const keys: string[] = [];
  for (const entry of arr) {
    if (typeof entry !== "string" || isGlobPattern(entry)) continue;
    keys.push(entry.toLowerCase());
  }
  return keys;
}

/**
 * Toggle a model's favorite state in enabledModels (exact "provider/id" only).
 * Preserves glob entries and all other keys. Returns the new exact lowercased keys.
 */
export function toggleFavoriteModel(provider: string, id: string): string[] {
  const obj = parseSettingsForWrite();
  const arr = Array.isArray(obj.enabledModels) ? obj.enabledModels.slice() : [];
  const lower = modelKey(provider, id).toLowerCase();
  let removed = false;
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (typeof e !== "string" || isGlobPattern(e)) continue;
    if (e.toLowerCase() === lower) {
      arr.splice(i, 1);
      removed = true;
    }
  }
  if (!removed) arr.push(modelKey(provider, id));
  obj.enabledModels = arr;
  writeSettingsJson(obj);
  return readEnabledModelKeys();
}
