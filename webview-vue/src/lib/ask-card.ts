// Two of pi's requests are questions rather than forms: the permission gate's
// `ui.select` and the `questionnaire` extension's `editor`. Both are answered on
// the composer's own card instead of in a centred modal — the decision is taken
// where the hands already are, and the transcript above stays readable while it
// is taken, which matters when the question is "allow this command?".
//
// Recognising them is this module's whole job: everything else falls through to
// the modal, so an unrecognised `select` or `editor` still gets the plain field.

import type { ExtensionUiRequest } from "@protocol/rpc";
import { parseQuestionnaireForm, type QuestionnaireQuestion } from "./questionnaire.ts";

/** A `ui.select` with choices — the permission gate's four-option prompt. */
export interface AskChoice {
  kind: "choice";
  /** Heading, e.g. "Permission Required" / "Dangerous Command:". */
  title: string;
  /** Optional body: the tool facts, or the command itself. */
  message: string;
  options: string[];
}

export interface AskQuestionnaire {
  kind: "questionnaire";
  questions: QuestionnaireQuestion[];
}

export type AskCard = AskChoice | AskQuestionnaire;

/**
 * pi's `editor` request carries its starting text as `prefill`; `defaultValue`
 * is its internal name for "what a cancel resolves to". Reading only the latter
 * left every editor dialog empty.
 */
export function dialogPrefill(request: { [k: string]: unknown } | null): string {
  return String(request?.prefill ?? request?.defaultValue ?? "");
}

/**
 * The ask card a request should render as, or null when it belongs in the modal.
 *
 * An empty option list is not a question — pi's `select` without options reaches
 * the modal (which is also where its native `<select>` lives).
 */
export function askCardFrom(request: ExtensionUiRequest | null): AskCard | null {
  if (!request) return null;
  if (request.method === "editor") {
    const questions = parseQuestionnaireForm(dialogPrefill(request));
    return questions ? { kind: "questionnaire", questions } : null;
  }
  if (request.method !== "select") return null;
  const options = Array.isArray(request.options) ? (request.options as string[]) : [];
  if (options.length === 0) return null;
  return {
    kind: "choice",
    title: String(request.title ?? ""),
    message: String(request.message ?? ""),
    options,
  };
}
