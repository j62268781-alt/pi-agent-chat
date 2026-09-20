// What the questionnaire dialog hands back to the tool, and how it walks there.
//
// The extension parses our response as `{answers}`, so the shape matters: an
// option has to carry its 1-based number (the tool echoes "user selected: 2."),
// a typed answer has to be marked `wasCustom`, and a single question still
// submits on the pick — the TUI does that on Enter.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { QuestionnaireQuestion } from "@/lib/questionnaire.ts";
import QuestionnaireDialog from "./QuestionnaireDialog.vue";

const QUESTIONS: QuestionnaireQuestion[] = [
  {
    id: "scope",
    label: "Scope",
    prompt: "改动范围？",
    options: [{ label: "只改这一处" }, { label: "整个模块" }],
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

/** The options of the page on screen — one question is mounted at a time. */
const options = (wrapper: ReturnType<typeof mount>) =>
  wrapper.get(".qa-question").findAll(".qa-option");

const pick = async (wrapper: ReturnType<typeof mount>, index: number) =>
  at(options(wrapper), index).trigger("click");

const promptOf = (wrapper: ReturnType<typeof mount>) => wrapper.get(".qa-prompt").text();

describe("QuestionnaireDialog — paging", () => {
  it("shows one question per page and walks forward as they are answered", async () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: QUESTIONS } });

    expect(wrapper.findAll(".qa-question")).toHaveLength(1);
    expect(wrapper.get(".qa-step").text()).toBe("1 / 2");
    expect(promptOf(wrapper)).toBe("改动范围？");

    await pick(wrapper, 1); // answering moves on

    expect(wrapper.get(".qa-step").text()).toBe("2 / 2");
    expect(promptOf(wrapper)).toBe("要补测试吗？");
  });

  it("goes back to an earlier question with its answer still picked", async () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: QUESTIONS } });
    expect(wrapper.find(".qa-back").exists()).toBe(false); // nothing behind page one

    await pick(wrapper, 1);
    await wrapper.get(".qa-back").trigger("click");

    expect(promptOf(wrapper)).toBe("改动范围？");
    expect(at(options(wrapper), 1).classes()).toContain("is-picked");
  });

  it("gates Next on the current question being answered", async () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: QUESTIONS } });
    const next = wrapper.get(".qa-actions .btn-primary");

    expect(next.text()).toBe("Next");
    expect(next.attributes("disabled")).toBeDefined();
    await pick(wrapper, 0);
    expect(wrapper.get(".qa-step").text()).toBe("2 / 2"); // the pick advanced it
  });
});

describe("QuestionnaireDialog — answers", () => {
  it("collects one answer per question and submits them together", async () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: QUESTIONS } });

    await pick(wrapper, 1); // scope → 整个模块
    await pick(wrapper, 0); // tests → 要 (last page, so the pick stays put)

    const submit = wrapper.get(".qa-actions .btn-primary");
    expect(submit.text()).toBe("Submit");
    expect(submit.attributes("disabled")).toBeUndefined();
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

  it("records a typed answer as a custom one", async () => {
    // `scope` allows a typed answer; that row sits after its two options.
    const wrapper = mount(QuestionnaireDialog, { props: { questions: [at(QUESTIONS, 0)] } });

    expect(wrapper.find(".qa-input").exists()).toBe(false);
    await pick(wrapper, 2);
    await wrapper.get(".qa-input").setValue(" 只跑 conversation 那几条 ");
    await wrapper.get(".qa-input").trigger("keydown.enter");

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

    await pick(wrapper, 2); // "Type something."
    await wrapper.get(".qa-input").setValue("只改标题");
    await wrapper.get(".qa-actions .btn-primary").trigger("click"); // Next, without Enter
    await wrapper.get(".qa-back").trigger("click");

    expect(at(options(wrapper), 2).classes()).toContain("is-picked");
    expect(wrapper.get(".qa-actions .btn-primary").attributes("disabled")).toBeUndefined();
  });

  it("offers no typed answer for a question that opted out", () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: [at(QUESTIONS, 1)] } });

    expect(wrapper.findAll(".qa-option")).toHaveLength(2);
  });

  it("reports a cancel as its own event", async () => {
    const wrapper = mount(QuestionnaireDialog, { props: { questions: QUESTIONS } });

    await wrapper.get(".qa-actions .btn").trigger("click");

    expect(wrapper.emitted("cancel")).toHaveLength(1);
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("focuses the first option so the dialog is keyboard-ready", async () => {
    const wrapper = mount(QuestionnaireDialog, {
      props: { questions: QUESTIONS },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();
    expect(document.activeElement?.className).toContain("qa-option");
    wrapper.unmount();
  });
});
