import { describe, expect, it } from "vitest";
import {
  MAX_ITEMS,
  parseTodoItems,
  summarize,
  toWidgetPayload,
} from "../../../pi-extensions/todo-model.ts";

describe("parseTodoItems", () => {
  it("accepts a well-formed list and trims the text", () => {
    const result = parseTodoItems({
      items: [{ id: "a", text: "  写迁移脚本  ", status: "in_progress" }],
    });
    expect(result).toEqual({
      ok: true,
      items: [{ id: "a", text: "写迁移脚本", status: "in_progress" }],
      dropped: 0,
    });
  });

  it("accepts an empty list as a deliberate clear", () => {
    expect(parseTodoItems({ items: [] })).toEqual({ ok: true, items: [], dropped: 0 });
  });

  it("rejects an unknown status", () => {
    const result = parseTodoItems({ items: [{ id: "a", text: "x", status: "done" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("status");
  });

  it("rejects a missing or blank text", () => {
    expect(parseTodoItems({ items: [{ id: "a", text: "   ", status: "pending" }] }).ok).toBe(false);
    expect(parseTodoItems({ items: [{ id: "a", status: "pending" }] }).ok).toBe(false);
  });

  it("rejects a missing id and duplicate ids", () => {
    expect(parseTodoItems({ items: [{ text: "x", status: "pending" }] }).ok).toBe(false);
    expect(
      parseTodoItems({
        items: [
          { id: "dup", text: "a", status: "pending" },
          { id: "dup", text: "b", status: "pending" },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects a non-array items field", () => {
    expect(parseTodoItems({ items: "nope" }).ok).toBe(false);
    expect(parseTodoItems(undefined).ok).toBe(false);
  });

  it("truncates past MAX_ITEMS instead of failing", () => {
    const items = Array.from({ length: MAX_ITEMS + 7 }, (_, i) => ({
      id: `t${i}`,
      text: `task ${i}`,
      status: "pending" as const,
    }));
    const result = parseTodoItems({ items });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(MAX_ITEMS);
      expect(result.dropped).toBe(7);
    }
  });
});

describe("summarize", () => {
  it("counts each status and the total", () => {
    expect(
      summarize([
        { id: "a", text: "x", status: "in_progress" },
        { id: "b", text: "y", status: "pending" },
        { id: "c", text: "z", status: "pending" },
        { id: "d", text: "w", status: "completed" },
      ]),
    ).toBe("待办已更新：1 进行中 · 2 待处理 · 1 已完成（共 4）");
  });

  it("mentions what the cap hid", () => {
    expect(summarize([{ id: "a", text: "x", status: "pending" }], 7)).toContain("另有 7 项未显示");
  });
});

describe("toWidgetPayload", () => {
  it("is the JSON the webview parses out of widgetLines[0]", () => {
    const items = [{ id: "a", text: "x", status: "pending" as const }];
    expect(JSON.parse(toWidgetPayload(items, 1234))).toEqual({ items, updatedAt: 1234 });
  });
});
