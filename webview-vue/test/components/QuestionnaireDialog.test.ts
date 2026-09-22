// What the questionnaire card hands back to the tool, and how it walks there.
//
// The extension parses our response as `{answers}`, so the shape matters: an
// option has to carry its 1-based number (the tool echoes "user selected: 2."),
// a typed answer has to be marked `wasCustom`, and a single question still
// submits on the pick — the TUI does that on Enter.
//
// The card itself is `AskCard`; this suite is about the form state it drives.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { QuestionnaireQuestion } from "@/lib/questionnaire.ts";
import QuestionnaireDialog from "@/components/QuestionnaireDialog.vue";

const QUESTIONS: QuestionnaireQuestion[] = [
  {
    id: "scope",
    label: "Scope",
    prompt: "改动范围？",
    options: [{ label: "只改这一处" }, { label: "整个模块", description: "改动面更大" }],
    allowOther: true,
  },
  {
    id: "tests",
    label: "Q2",
    prompt: "要补测试吗？",
    options: [{ label: "要" }, { label: "不要" }],
    allowOther: false,
  },
];

/** Indexed reads: the fixtures are fixed, but the compiler cannot know that. */
const at = <T>(list: readonly T[], index: number): T => list[index] as T;

type Wrapper = ReturnType<typeof mount>;

/** The option rows of the page on screen — one question is mounted at a time. */
const rows = (wrapper: Wrapper) => wrapper.get(".ask-rows").findAll(".ask-row");
const pick = async (wrapper: Wrapper, index: number) => at(rows(wrapper), index).trigger("click");
const titleOf = (wrapper: Wrapper) => wrapper.get(".ask-title").text();
const stepOf = (wrapper: Wrapper) => wrapper.get(".ask-step").text();
const advance = (wrapper: Wrapper) => wrapper.get(".ask-advance");
const advanceDisabled = (wrapper: Wrapper) => advance(wrapper).attributes("disabled") !== undefined;

describe("QuestionnaireDialog — paging", () => {
  it("shows one question per page and walks forward as they are answered", async () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: QUESTIONS } });

    expect(titleOf(wrapper)).toBe("改动范围？");
    expect(stepOf(wrapper)).toBe("1 / 2");

    await pick(wrapper, 1); // answering moves on

    expect(stepOf(wrapper)).toBe("2 / 2");
    expect(titleOf(wrapper)).toBe("要补测试吗？");
  });

  it("walks both ways with the pager's arrows", async () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: QUESTIONS } });
    const pages = () => wrapper.findAll(".ask-page");

    await pick(wrapper, 0); // answers page one, which advances it
    await at(pages(), 0).trigger("click"); // ‹ back

    expect(stepOf(wrapper)).toBe("1 / 2");

    await at(pages(), 1).trigger("click"); // › forward, without a second pick

    expect(stepOf(wrapper)).toBe("2 / 2");
  });

  it("goes back to an earlier question with its answer still picked", async () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: QUESTIONS } });
    // Nothing behind page one, so the pager's ‹ is drawn disabled.
    expect((wrapper.get(".ask-page").element as HTMLButtonElement).disabled).toBe(true);

    await pick(wrapper, 1);
    await wrapper.get(".ask-page").trigger("click");

    expect(titleOf(wrapper)).toBe("改动范围？");
    expect(at(rows(wrapper), 1).classes()).toContain("is-picked");
  });

  it("gates the advance button on the current question being answered", async () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: QUESTIONS } });

    expect(advanceDisabled(wrapper)).toBe(true);

    await pick(wrapper, 0); // the pick advanced the card by itself

    expect(stepOf(wrapper)).toBe("2 / 2");
    expect(advanceDisabled(wrapper)).toBe(true);
  });
});

describe("QuestionnaireDialog — answers", () => {
  it("collects one answer per question and submits them together", async () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: QUESTIONS } });

    await pick(wrapper, 1); // scope → 整个模块
    await pick(wrapper, 0); // tests → 要 (last page, so the pick stays put)

    const submit = advance(wrapper);
    expect(submit.attributes("title")).toBe("Submit");
    expect(advanceDisabled(wrapper)).toBe(false);
    await submit.trigger("click");

    expect(wrapper.emitted("submit")?.[0]?.[0]).toEqual([
      { id: "scope", value: "整个模块", label: "整个模块", wasCustom: false, index: 2 },
      { id: "tests", value: "要", label: "要", wasCustom: false, index: 1 },
    ]);
  });

  it("submits a single question as soon as an option is picked", async () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: [at(QUESTIONS, 0)] } });

    await pick(wrapper, 0);

    expect(wrapper.emitted("submit")?.[0]?.[0]).toEqual([
      { id: "scope", value: "只改这一处", label: "只改这一处", wasCustom: false, index: 1 },
    ]);
  });

  it("shows an option's description as the row's grey hint", () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: [at(QUESTIONS, 0)] } });

    expect(at(rows(wrapper), 1).get(".ask-hint").text()).toBe("改动面更大");
  });

  it("records a typed answer as a custom one", async () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: [at(QUESTIONS, 0)] } });

    expect(wrapper.find(".ask-input").exists()).toBe(false);
    await wrapper.get(".ask-other-open").trigger("click");
    await wrapper.get(".ask-input").setValue(" 只跑 conversation 那几条 ");
    await wrapper.get(".ask-input").trigger("keydown.enter");

    expect(wrapper.emitted("submit")?.[0]?.[0]).toEqual([
      {
        id: "scope",
        value: "只跑 conversation 那几条",
        label: "只跑 conversation 那几条",
        wasCustom: true,
      },
    ]);
  });

  it("keeps a typed answer that is still in the box when leaving the page", async () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: QUESTIONS } });

    await wrapper.get(".ask-other-open").trigger("click"); // the free-form row
    await wrapper.get(".ask-input").setValue("只改标题");
    await advance(wrapper).trigger("click"); // Next, without Enter
    await wrapper.get(".ask-page").trigger("click"); // ‹ back

    expect(wrapper.get(".ask-other").classes()).toContain("is-picked");
    expect(advanceDisabled(wrapper)).toBe(false);
  });

  it("offers no typed answer for a question that opted out", () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: [at(QUESTIONS, 1)] } });

    expect(rows(wrapper)).toHaveLength(2);
    expect(wrapper.find(".ask-other-open").exists()).toBe(false);
  });

  it("reports a cancel as its own event", async () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: QUESTIONS } });

    await wrapper.get(".ask-close").trigger("click");

    expect(wrapper.emitted("cancel")).toHaveLength(1);
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("focuses the first row so the card is keyboard-ready", async () => {
    const wrapper = mount(QuestionnaireDialog, {
      props: { questions: QUESTIONS },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();
    expect(document.activeElement?.className).toContain("ask-row");
    wrapper.unmount();
  });
});
