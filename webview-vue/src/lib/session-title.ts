import { t } from "./i18n.ts";

/**
 * What a session is called: its name when it has one, else the date it was last
 * touched.
 *
 * pi keeps a name only when something set one, so an unnamed session is
 * identified by time — and wherever a session is shown it has to be shown *the
 * same way*. The switcher's rows and the chat header's title used to derive it
 * separately, and only the row did the date: switching to an unnamed session
 * left the header saying "新会话" while the row that was just clicked said
 * "会话 09-25 18:02" (彬哥).
 *
 * `modified` is pi's own field for the row (`SessionManager.list`), not the
 * file's mtime — the two differ by seconds to minutes (measured), so both
 * places have to be fed the same number.
 */
export function sessionTitle(file: string | null, name: string, modified?: string | null): string {
  if (name) return name;
  if (modified) {
    const date = new Date(modified);
    if (!Number.isNaN(date.getTime())) {
      const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));
      const label = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
      return t("Session {0}", label);
    }
  }
  return file ? file.split("/").pop() || file : "";
}
