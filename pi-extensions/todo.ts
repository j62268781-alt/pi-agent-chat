/**
 * Bundled `todo` extension: the model replaces the session's task list, and the
 * list is published as a widget so the VS Code panel can show it above the
 * composer.
 *
 * The state lives here (per session runtime), NOT in the tool results: the
 * transcript gets compacted, and a compacted-away result would take the list with
 * it. pi does not clear widgets on its own — abort, new_session and
 * switch_session were all measured to leave them alone — so clearing is this
 * extension's job.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  MAX_ITEMS,
  WIDGET_KEY,
  parseTodoItems,
  summarize,
  toWidgetPayload,
  type TodoItem,
} from "./todo-model.js";

const TodoParams = Type.Object({
  items: Type.Array(
    Type.Object({
      id: Type.String({
        description: "Stable short id, unchanged across calls (kebab-case, <=32 chars)",
      }),
      text: Type.String({ description: "What the step is" }),
      status: StringEnum(["pending", "in_progress", "completed"] as const),
    }),
    {
      description:
        "The COMPLETE task list, in order. Always send every item — not just the ones that " +
        `changed: an omitted item is gone. Send an empty array to clear the list. At most ${MAX_ITEMS} items.`,
    },
  ),
});

export default function todo(pi: ExtensionAPI) {
  const disabledTools = (() => {
    try {
      const parsed = JSON.parse(process.env.PI_VSCODE_DISABLED_TOOLS ?? "[]");
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  })();
  if (disabledTools.includes("todo")) return;

  let items: TodoItem[] = [];

  const publish = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget(
      WIDGET_KEY,
      items.length === 0 ? undefined : [toWidgetPayload(items, Date.now())],
    );
  };

  // Session-scoped: every session start (startup/new/resume/fork) begins with no
  // list, and every teardown clears the widget. pi fires session_start twice for a
  // replacement, so this has to be idempotent — it is.
  const reset = (ctx: ExtensionContext): void => {
    items = [];
    publish(ctx);
  };
  pi.on("session_start", (_event, ctx) => reset(ctx));
  pi.on("session_shutdown", (_event, ctx) => reset(ctx));
  pi.on("session_before_switch", (_event, ctx) => reset(ctx));
  // Insurance only: compaction rewrites messages, not UI state, and no run was
  // ever observed clearing a widget — but re-publishing costs one line.
  pi.on("session_compact", (_event, ctx) => publish(ctx));

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description:
      "Replace the session's task list, then keep it current as you work. Use it for multi-step tasks: " +
      "send the COMPLETE list on every call (an item you omit is gone), keep exactly one item in_progress " +
      "while you work on it, and send an empty list when the work is done.",
    parameters: TodoParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parsed = parseTodoItems(params);
      // Throwing is the only way to fail a tool call — returning `isError` never
      // sets the flag (extensions.md:2120). The widget is deliberately left as it
      // was, so a malformed call cannot wipe the card the user is reading.
      if (!parsed.ok) throw new Error(parsed.error);

      items = parsed.items;
      publish(ctx);
      return {
        content: [{ type: "text" as const, text: summarize(items, parsed.dropped) }],
        details: {
          items,
          total: items.length,
          completed: items.filter((item) => item.status === "completed").length,
        },
      };
    },
  });
}
