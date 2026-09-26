// Pure helpers for the bundled `todo` extension: validating the model's list and
// rendering the strings the tool returns / publishes. No pi imports, so the rules
// stay unit-testable.

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
}

/** The model writes the whole list every call; beyond this we truncate. */
export const MAX_ITEMS = 50;

/** Widget key the webview renders (`TodoPill.vue` hardcodes the same string). */
export const WIDGET_KEY = "pi-todo";

const STATUSES: readonly TodoStatus[] = ["pending", "in_progress", "completed"];

export function parseTodoItems(
  raw: unknown,
): { ok: true; items: TodoItem[]; dropped: number } | { ok: false; error: string } {
  const list = (raw as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(list)) {
    return { ok: false, error: "`items` must be an array — send the complete list every call." };
  }
  const items: TodoItem[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const item = entry as { id?: unknown; text?: unknown; status?: unknown };
    if (typeof item?.id !== "string" || item.id.trim() === "") {
      return { ok: false, error: "Every todo needs a non-empty string `id`." };
    }
    if (seen.has(item.id)) return { ok: false, error: `Duplicate todo id "${item.id}".` };
    if (typeof item.text !== "string" || item.text.trim() === "") {
      return { ok: false, error: `Todo "${item.id}" needs non-empty \`text\`.` };
    }
    if (typeof item.status !== "string" || !STATUSES.includes(item.status as TodoStatus)) {
      return {
        ok: false,
        error: `Todo "${item.id}" has an invalid \`status\` — use pending, in_progress or completed.`,
      };
    }
    seen.add(item.id);
    items.push({ id: item.id, text: item.text.trim(), status: item.status as TodoStatus });
  }
  const kept = items.slice(0, MAX_ITEMS);
  return { ok: true, items: kept, dropped: items.length - kept.length };
}

export function summarize(items: TodoItem[], dropped = 0): string {
  const count = (status: TodoStatus) => items.filter((item) => item.status === status).length;
  const base = `待办已更新：${count("in_progress")} 进行中 · ${count("pending")} 待处理 · ${count("completed")} 已完成（共 ${items.length}）`;
  return dropped > 0 ? `${base} —— 另有 ${dropped} 项未显示（上限 ${MAX_ITEMS}）` : base;
}

export function toWidgetPayload(items: TodoItem[], now: number): string {
  return JSON.stringify({ items, updatedAt: now });
}
