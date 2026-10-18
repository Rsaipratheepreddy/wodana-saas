import { describe, expect, it } from "vitest";
import { answerText, healthCheck, KIT_QUESTIONS, missingRequired, normaliseQuestions, questionsFor, QUESTIONNAIRE_PURPOSES, type Question } from "./questionnaires.domain";

describe("Setup questionnaires (§0.3 P3)", () => {
  it("keeps well-formed questions in order, keys them from their label and drops duplicates", () => {
    const questions = normaliseQuestions([
      { label: "  Who attended?  ", kind: "text" },
      { key: "who_attended", label: "Again", kind: "text" },
      { label: "Style", kind: "choice", options: ["Modern", "Modern", " Classic "], required: true },
      { label: "", kind: "text" },
      { label: "Odd kind", kind: "sketch" },
    ]);
    expect(questions).toEqual([
      { key: "who_attended", label: "Who attended?", kind: "text", required: false },
      { key: "style", label: "Style", kind: "choice", required: true, options: ["Modern", "Classic"] },
      { key: "odd_kind", label: "Odd kind", kind: "text", required: false },
    ]);
  });

  it("starts every firm with optional questions that pass the health check", () => {
    for (const purpose of QUESTIONNAIRE_PURPOSES) {
      expect(KIT_QUESTIONS[purpose].every((question) => !question.required)).toBe(true);
      expect(healthCheck(KIT_QUESTIONS[purpose])).toEqual([]);
    }
  });

  it("won't publish an empty list or a choice without two choices", () => {
    expect(healthCheck([])).toEqual(["Add at least one question."]);
    expect(healthCheck([{ key: "a", label: "Pick", kind: "choice", required: false, options: ["One"] }])).toEqual(['Give "Pick" at least two choices.']);
  });

  it("asks a question only on the job types it's for", () => {
    const questions: Question[] = [{ key: "a", label: "A", kind: "text", required: false }, { key: "b", label: "B", kind: "text", required: false, jobTypes: ["fit_out"] }];
    expect(questionsFor(questions, "furniture").map((question) => question.key)).toEqual(["a"]);
    expect(questionsFor(questions, "fit_out").map((question) => question.key)).toEqual(["a", "b"]);
  });

  it("checks each answer against its question", () => {
    const ask = (kind: Question["kind"], options?: string[]): Question => ({ key: "k", label: "Q", kind, required: false, ...(options ? { options } : {}) });
    expect(answerText(ask("number"), "12.5")).toBe("12.5");
    expect(() => answerText(ask("number"), "twelve")).toThrow('Answer "Q" with a number.');
    expect(answerText(ask("yes_no"), true)).toBe("yes");
    expect(answerText(ask("date"), "2026-10-17")).toBe("2026-10-17");
    expect(() => answerText(ask("date"), "17/10/2026")).toThrow();
    expect(answerText(ask("choice", ["Call", "Portal update"]), "Call")).toBe("Call");
    expect(() => answerText(ask("choice", ["Call"]), "Email")).toThrow();
    expect(answerText(ask("multi_choice", ["A", "B"]), ["B", "A", "B"])).toBe("B\nA");
    expect(answerText(ask("text"), "  ")).toBeNull();
  });

  it("names every required question still unanswered", () => {
    const questions: Question[] = [{ key: "a", label: "A", kind: "text", required: true }, { key: "b", label: "B", kind: "text", required: false }];
    expect(missingRequired(questions, { a: null, b: null })).toEqual(["A"]);
    expect(missingRequired(questions, { a: "yes", b: null })).toEqual([]);
  });
});
