// The `questionnaire` pi extension asks through pi's generic `editor` request:
// the prefill is the form definition, and the response must be `{answers}`.
//
// Keeping the shape in one place means the dialog and the transcript card agree
// on it, and that a malformed prefill is rejected before a form is drawn — an
// unrecognised editor request must still fall back to the plain text field.

/** One selectable option of a question. */
export interface QuestionnaireOption {
  label: string;
  description?: string;
}

export interface QuestionnaireQuestion {
  id: string;
  /** Short label ("Scope"), used by the TUI's tab bar. */
  label: string;
  prompt: string;
  options: QuestionnaireOption[];
  allowOther: boolean;
}

export interface QuestionnaireAnswer {
  id: string;
  value: string;
  label: string;
  /** True when the user typed the answer instead of picking an option. */
  wasCustom: boolean;
  /** 1-based option number, only for a picked option — the TUI's wording. */
  index?: number;
}

/** What the `questionnaire` tool returns in `details`. */
export interface QuestionnaireResult {
  questions: QuestionnaireQuestion[];
  answers: QuestionnaireAnswer[];
  cancelled: boolean;
}

/** The "Type something." escape hatch, worded like the TUI's own row. */
export const OTHER_LABEL = "Type something.";

/** The TUI's placeholder for an empty typed answer, kept verbatim. */
const NO_RESPONSE = "(no response)";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asOptions(value: unknown): QuestionnaireOption[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const options: QuestionnaireOption[] = [];
  for (const raw of value) {
    const option = asRecord(raw);
    if (!option || typeof option.label !== "string" || !option.label) return null;
    options.push({
      label: option.label,
      description: typeof option.description === "string" ? option.description : undefined,
    });
  }
  return options;
}

function asQuestions(value: unknown): QuestionnaireQuestion[] | null {
  const record = asRecord(value);
  const list = record?.questions;
  if (!Array.isArray(list) || list.length === 0) return null;
  const questions: QuestionnaireQuestion[] = [];
  for (const [index, raw] of list.entries()) {
    const question = asRecord(raw);
    if (!question) return null;
    const options = asOptions(question.options);
    if (!options) return null;
    const prompt = typeof question.prompt === "string" ? question.prompt : "";
    const label = typeof question.label === "string" ? question.label : "";
    if (!prompt && !label) return null;
    questions.push({
      id: typeof question.id === "string" && question.id ? question.id : `Q${index + 1}`,
      label: label || `Q${index + 1}`,
      prompt: prompt || label,
      options,
      allowOther: question.allowOther !== false,
    });
  }
  return questions;
}

/**
 * Read an `editor` request's prefill as a questionnaire form.
 *
 * Returns null for every other editor payload, which is the signal to render the
 * ordinary text field instead.
 */
export function parseQuestionnaireForm(prefill: string): QuestionnaireResult["questions"] | null {
  const text = prefill.trim();
  if (!text.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return asQuestions(parsed);
}

/** Keep a `questionnaire` tool result's `details` if it carries answers. */
export function parseQuestionnaireResult(details: unknown): QuestionnaireResult | null {
  const questions = asQuestions(details);
  if (!questions) return null;
  const record = asRecord(details);
  const list = Array.isArray(record?.answers) ? (record.answers as unknown[]) : [];
  const answers: QuestionnaireAnswer[] = [];
  for (const raw of list) {
    const answer = asRecord(raw);
    if (!answer || typeof answer.id !== "string") continue;
    const label = typeof answer.label === "string" ? answer.label : "";
    answers.push({
      id: answer.id,
      value: typeof answer.value === "string" ? answer.value : label,
      label,
      wasCustom: answer.wasCustom === true,
      index: typeof answer.index === "number" ? answer.index : undefined,
    });
  }
  return { questions, answers, cancelled: record?.cancelled === true };
}

/** The answer a question received, if it was answered at all. */
export function answerFor(
  result: QuestionnaireResult,
  question: QuestionnaireQuestion,
): QuestionnaireAnswer | null {
  return result.answers.find((answer) => answer.id === question.id) ?? null;
}

/** Record a picked option, numbered from 1 the way the tool reports it. */
export function pickOption(question: QuestionnaireQuestion, index: number): QuestionnaireAnswer {
  const option = question.options[index];
  return {
    id: question.id,
    value: option?.label ?? "",
    label: option?.label ?? "",
    wasCustom: false,
    index: index + 1,
  };
}

/** Record a typed answer. An empty box matches the TUI's "(no response)". */
export function writeAnswer(question: QuestionnaireQuestion, text: string): QuestionnaireAnswer {
  const value = text.trim() || NO_RESPONSE;
  return { id: question.id, value, label: value, wasCustom: true };
}

/** One-line rendering of an answer for the transcript card. */
export function answerText(answer: QuestionnaireAnswer | null): string {
  if (!answer) return "";
  if (answer.wasCustom) return answer.label;
  return answer.index ? `${answer.index}. ${answer.label}` : answer.label;
}
