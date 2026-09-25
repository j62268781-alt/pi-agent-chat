// One derivation for every place a session is named. The header and the
// switcher's row used to derive it separately, and only the row did the date:
// switching to an unnamed session left the header on the generic "新会话" while
// the row that was just clicked said "会话 09-25 18:02" (彬哥).

import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n.ts";
import { sessionTitle } from "@/lib/session-title.ts";

/** The label a row shows for `modified`, in the reader's own clock. */
const dated = (iso: string): string => t("Session {0}", label(iso));
function label(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

describe("sessionTitle", () => {
  it("prefers the name a session has", () => {
    expect(sessionTitle("/tmp/a.jsonl", "登录流程", "2026-09-25T10:02:00.000Z")).toBe("登录流程");
  });

  it("dates a session that has no name", () => {
    const iso = "2026-09-25T10:02:34.320Z";

    expect(sessionTitle("/tmp/a.jsonl", "", iso)).toBe(dated(iso));
  });

  it("uses pi's own timestamp, so the header can match the row", () => {
    // Two different stamps for the same session (pi's `modified` vs the file's
    // mtime) have to render differently — that is what makes the source of the
    // number matter.
    const fromList = "2026-09-25T09:46:04.225Z";
    const fromMtime = "2026-09-25T10:00:56.169Z";

    expect(sessionTitle("/tmp/a.jsonl", "", fromList)).toBe(dated(fromList));
    expect(sessionTitle("/tmp/a.jsonl", "", fromList)).not.toBe(dated(fromMtime));
  });

  it("falls back to the file's own name when nothing dated it", () => {
    expect(sessionTitle("/tmp/pi-sessions/2026-09-25T10-13-56-314Z_ab.jsonl", "")).toBe(
      "2026-09-25T10-13-56-314Z_ab.jsonl",
    );
  });

  it("has nothing to show while there is no session at all", () => {
    expect(sessionTitle(null, "")).toBe("");
    expect(sessionTitle(null, "", "")).toBe("");
  });

  it("still shows a name when the timestamp is unusable", () => {
    expect(sessionTitle("/tmp/a.jsonl", "登录流程", "not a date")).toBe("登录流程");
    expect(sessionTitle("/tmp/a.jsonl", "", "not a date")).toBe("a.jsonl");
  });
});
