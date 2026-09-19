// The `questionnaire` extension's contract, both directions: the form it sends
// through pi's `editor` prefill, and the `{answers}` string it parses back.
//
// A payload we misread is not a cosmetic problem — the dialog would submit a
// shape the tool cannot parse, and the run would end in "invalid questionnaire
// response" instead of an answer.

import { describe, expect, it } from "vitest";
import {
  answerFor,
  answerText,
  parseQuestionnaireForm,
  parseQuestionnaireResult,
  pickOption,
  writeAnswer,
  type QuestionnaireQuestion,
  type QuestionnaireResult,
} from "./questionnaire.ts";

/** Indexed reads: the fixtures are fixed, but the compiler cannot know that. */
const at = <T>(list: readonly T[], index: number): T => list[index] as T;

/** As the tool builds it: labels filled in, `allowOther` only when it is off. */
const FORM = {
  questions: [
    {
      id: "scope",
      label: "Scope",
      prompt: "改动范围？",
      options: [{ label: "只改这一处", description: "最小 diff" }, { label: "整个模块" }],
      allowOther: true,
    },
    {
      id: "tests",
      label: "Q2",
      prompt: "要补测试吗？",
      options: [{ label: "要" }, { label: "不要" }],
    },
  ],
};

/** The parsed form, failing loudly if the fixture stops parsing. */
function form(payload: unknown = FORM): QuestionnaireQuestion[] {
  const questions = parseQuestionnaireForm(JSON.stringify(payload));
  if (!questions) throw new Error("fixture no longer parses as a questionnaire");
  return questions;
}

/** The parsed result, failing loudly if the fixture stops parsing. */
function resultOf(payload: unknown): QuestionnaireResult {
  const result = parseQuestionnaireResult(payload);
  if (!result) throw new Error("fixture no longer parses as a questionnaire result");
  return result;
}

describe("questionnaire — reading the form", () => {
  it("takes the questions out of the prefill", () => {
    const questions = form();
    expect(questions.map((question) => question.id)).toEqual(["scope", "tests"]);
    expect(at(at(questions, 0).options, 0).description).toBe("最小 diff");
    expect(at(questions, 1).prompt).toBe("要补测试吗？");
  });

  it("allows a typed answer unless the question opts out", () => {
    const questions = form();
    expect(at(questions, 0).allowOther).toBe(true);
    expect(at(questions, 1).allowOther).toBe(true);

    const optedOut = JSON.parse(JSON.stringify(FORM)) as typeof FORM;
    at(optedOut.questions, 1).allowOther = false;
    expect(at(form(optedOut), 1).allowOther).toBe(false);
  });

  it("stands aside for every other editor payload", () => {
    const others = [
      "",
      "hello",
      "{}",
      '["question"]',
      '{"questions":[]}',
      '{"questions":[{"id":"a","prompt":"p"}]}', // no options to choose from
      '{"questions":[{"id":"a","prompt":"p","options":[]}]}',
      '{"questions":[{"id":"a","options":[{"label":"x"}]}]}', // no prompt, no label
      "{not json",
    ];
    for (const prefill of others) expect(parseQuestionnaireForm(prefill)).toBeNull();
  });
});

describe("questionnaire — building the answers", () => {
  it("numbers a picked option the way the tool reports it", () => {
    expect(pickOption(at(form(), 0), 1)).toEqual({
      id: "scope",
      value: "整个模块",
      label: "整个模块",
      wasCustom: false,
      index: 2,
    });
  });

  it("keeps the tool's placeholder for an empty typed answer", () => {
    const scope = at(form(), 0);
    expect(writeAnswer(scope, "   ")).toEqual({
      id: "scope",
      value: "(no response)",
      label: "(no response)",
      wasCustom: true,
    });
    expect(writeAnswer(scope, " 就改标题 ").label).toBe("就改标题");
  });
});

describe("questionnaire — reading a finished result", () => {
  const details = {
    questions: FORM.questions,
    answers: [
      { id: "scope", value: "只改这一处", label: "只改这一处", wasCustom: false, index: 1 },
      { id: "tests", value: "只跑现有的", label: "只跑现有的", wasCustom: true },
    ],
    cancelled: false,
  };

  it("keeps the questions and answers from `details`", () => {
    const result = resultOf(details);
    expect(result.questions).toHaveLength(2);
    expect(result.answers).toHaveLength(2);
    expect(result.cancelled).toBe(false);
  });

  it("pairs an answer with its question", () => {
    const result = resultOf(details);
    expect(answerFor(result, at(result.questions, 0))?.label).toBe("只改这一处");
    expect(answerFor(result, at(result.questions, 1))?.wasCustom).toBe(true);
    expect(answerFor(result, { ...at(result.questions, 0), id: "missing" })).toBeNull();
  });

  it("renders a picked answer and a typed one differently", () => {
    const result = resultOf(details);
    expect(answerText(at(result.answers, 0))).toBe("1. 只改这一处");
    expect(answerText(at(result.answers, 1))).toBe("只跑现有的");
  });

  it("ignores a tool result that is not a questionnaire", () => {
    expect(parseQuestionnaireResult({ diff: "- a\n+ b" })).toBeNull();
    expect(parseQuestionnaireResult(null)).toBeNull();
    expect(parseQuestionnaireResult({ answers: [] })).toBeNull();
  });

  it("accepts a result whose answers have not arrived yet", () => {
    const result = resultOf({ questions: FORM.questions });
    expect(result.answers).toEqual([]);
    expect(result.cancelled).toBe(false);
  });

  it("keeps a cancelled run (and its empty answer list)", () => {
    const result = resultOf({ ...details, answers: [], cancelled: true });
    expect(result.cancelled).toBe(true);
    expect(result.answers).toEqual([]);
  });
});
