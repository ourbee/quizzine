/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import test from "node:test";
import assert from "node:assert/strict";
import { grade } from "../lib/grade.ts";
import { validateQuestions } from "../lib/validate.ts";
import { parseMarkdownText, parseSheetRows } from "../lib/parsers.ts";
import { isSurvey, maxPoints } from "../lib/questions.ts";
import type { ParsedQuiz, Question } from "../lib/types.ts";

const opts = (...texts: string[]) =>
  texts.map((text, i) => ({ key: "ABCDEF"[i], text }));

const mcq = (over: Partial<Question> = {}): Question => ({
  id: "q1",
  type: "mcq",
  text: "Q",
  options: opts("one", "two", "three"),
  correct: "B",
  points: 2,
  ...over,
});

const multi = (over: Partial<Question> = {}): Question => ({
  id: "q1",
  type: "multi",
  text: "Q",
  options: opts("one", "two", "three", "four"),
  correctKeys: ["A", "C"],
  points: 4,
  ...over,
});

// ---------------- multi-answer marking ----------------

test("an exact multi-answer set earns full marks whichever order it is given in", () => {
  const { score, per } = grade([multi()], { q1: "C,A" });
  assert.equal(score, 4);
  assert.equal(per[0].correct, true);
});

test("all-or-nothing gives zero for a partly right multi-answer set", () => {
  const { score, per } = grade([multi()], { q1: "A" }, "exact");
  assert.equal(score, 0);
  assert.equal(per[0].correct, false);
});

test("partial credit pays for correct ticks and cancels them with wrong ones", () => {
  // Two of two correct ticked, one wrong ticked: (2 - 1) / 2 of 4 marks.
  const { score } = grade([multi()], { q1: "A,C,B" }, "partial");
  assert.equal(score, 2);
});

test("partial credit never goes negative, so ticking everything scores nothing", () => {
  const { score } = grade([multi()], { q1: "A,B,C,D" }, "partial");
  assert.equal(score, 0);
});

test("a missing multi answer scores zero without being queued for marking", () => {
  const { score, per, pending } = grade([multi()], {});
  assert.equal(score, 0);
  assert.equal(pending, 0);
  assert.equal(per[0].answer, undefined);
});

// ---------------- ungraded questions ----------------

test("an ungraded question is neither scored nor queued, and adds nothing to the total", () => {
  const questions = [mcq(), { ...mcq({ id: "q2", graded: false, points: 0 }) }];
  const { score, max, pending, per } = grade(questions, { q1: "B", q2: "A" });
  assert.equal(score, 2);
  assert.equal(max, 2, "the ungraded question must not inflate the denominator");
  assert.equal(pending, 0);
  assert.equal(per[1].ungraded, true);
  assert.equal(per[1].correct, undefined);
  assert.equal(per[1].answer, "A", "the response is still recorded");
});

test("a graded typed answer still waits for the teacher", () => {
  const { pending, max } = grade([{ ...mcq({ type: "essay", options: [], correct: undefined }) }], { q1: "text" });
  assert.equal(pending, 1);
  assert.equal(max, 2);
});

test("isSurvey and maxPoints agree that an all-ungraded quiz has nothing to score", () => {
  const questions = [mcq({ graded: false, points: 0 }), mcq({ id: "q2", graded: false, points: 0 })];
  assert.equal(isSurvey(questions), true);
  assert.equal(maxPoints(questions), 0);
});

// ---------------- validation ----------------

const parsed = (questions: ParsedQuiz["questions"]): ParsedQuiz => ({ questions });

test("a multi question accepts several correct letters in one cell", () => {
  const { errors, questions } = validateQuestions(
    parsed([{ text: "Q", type: "multi", options: opts("one", "two", "three"), correct: "A, C", points: 3 }])
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(questions[0].correctKeys, ["A", "C"]);
});

test("a run of letters is read as several keys", () => {
  const { questions } = validateQuestions(
    parsed([{ text: "Q", type: "checkbox", options: opts("one", "two", "three"), correct: "AC" }])
  );
  assert.deepEqual(questions[0].correctKeys, ["A", "C"]);
});

test("an option whose text is a run of A-F letters is not mistaken for a list of keys", () => {
  const { errors, questions } = validateQuestions(
    parsed([{ text: "Q", type: "mcq", options: opts("face", "beam", "cede"), correct: "face" }])
  );
  assert.deepEqual(errors, []);
  assert.equal(questions[0].correct, "A");
});

test("several correct answers on an mcq is an error that names the fix", () => {
  const { errors } = validateQuestions(
    parsed([{ text: "Q", type: "mcq", options: opts("one", "two", "three"), correct: "A,C" }])
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /multi/);
});

test("a poll needs no correct answer and is worth no marks", () => {
  const { errors, questions } = validateQuestions(
    parsed([{ text: "Which did you prefer?", type: "poll", options: opts("one", "two"), points: 5 }])
  );
  assert.deepEqual(errors, []);
  assert.equal(questions[0].graded, false);
  assert.equal(questions[0].points, 0);
  assert.equal(questions[0].type, "mcq");
});

test("a scored choice question with no answer key is still an error", () => {
  const { errors } = validateQuestions(parsed([{ text: "Q", type: "mcq", options: opts("one", "two") }]));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /CorrectAnswer is missing/);
});

test("survey mode leaves the whole quiz unscored without erroring on missing keys", () => {
  const { errors, questions } = validateQuestions(
    parsed([
      { text: "Q1", type: "mcq", options: opts("one", "two") },
      { text: "Q2", type: "essay", options: [], points: 5 },
    ]),
    "survey"
  );
  assert.deepEqual(errors, []);
  assert.equal(isSurvey(questions), true);
  assert.equal(maxPoints(questions), 0);
});

test("an explicit Graded column overrides the type's own default", () => {
  const { errors, questions } = validateQuestions(
    parsed([{ text: "Q", type: "multi", options: opts("one", "two"), graded: "no" }])
  );
  assert.deepEqual(errors, []);
  assert.equal(questions[0].graded, false);
  assert.equal(questions[0].type, "multi");
});

// ---------------- parsers reaching validation ----------------

test("a spreadsheet row carries Type and a comma-separated key through to the question", () => {
  const quiz = parseSheetRows([
    { Question: "Q", Type: "multi", OptionA: "one", OptionB: "two", OptionC: "three", CorrectAnswer: "A,C", Points: 2 },
  ]);
  const { errors, questions } = validateQuestions(quiz);
  assert.deepEqual(errors, []);
  assert.equal(questions[0].type, "multi");
  assert.deepEqual(questions[0].correctKeys, ["A", "C"]);
});

test("a Graded: no line in the block format marks the question unscored", () => {
  const quiz = parseMarkdownText("Q: How did you find this term?\nType: poll\nA: Hard\nB: Fair\nGraded: no");
  const { errors, questions } = validateQuestions(quiz);
  assert.deepEqual(errors, []);
  assert.equal(questions[0].graded, false);
});

// ---------------- semester, including "not applicable" ----------------

test("a blank semester is rejected rather than being read as 'not applicable'", async () => {
  const { readSemester } = await import("../lib/normalize.ts");
  // Number("") is 0, which is exactly the coercion this must not fall for.
  assert.equal(readSemester(""), null);
  assert.equal(readSemester(undefined), null);
  assert.equal(readSemester(null), null);
  assert.equal(readSemester("abc"), null);
});

test("'not applicable' is accepted and never collides with a real semester", async () => {
  const { readSemester, NO_SEMESTER, semesterLabel } = await import("../lib/normalize.ts");
  assert.equal(readSemester(NO_SEMESTER), NO_SEMESTER);
  assert.equal(readSemester("-1"), -1);
  assert.equal(semesterLabel(NO_SEMESTER), "N/A");
  assert.equal(semesterLabel(3), "Sem 3");
  // 0 is reserved for the reports' "all semesters" row, so it must not be pickable.
  assert.notEqual(NO_SEMESTER, 0);
  assert.equal(readSemester(0), null);
});

test("only semesters 1 to 8 are accepted alongside the sentinel", async () => {
  const { readSemester } = await import("../lib/normalize.ts");
  for (const n of [1, 4, 8]) assert.equal(readSemester(String(n)), n);
  for (const n of [9, 100, -2, 2.5]) assert.equal(readSemester(n), null, `${n} must be rejected`);
});
