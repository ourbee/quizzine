/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  applyMarking,
  buildEntry,
  clearMark,
  effectiveMark,
  markingStatus,
  normalizeMarking,
  setMark,
  unmarkedCount,
} from "../lib/marking.ts";
import { grade } from "../lib/grade.ts";
import type { Question } from "../lib/types.ts";

const weights = { a1: 50, a2: 50 };

const essay = (id: string, points = 10): Question => ({
  id,
  type: "essay",
  text: `Discuss ${id}`,
  options: [],
  points,
});

const mcq = (id: string): Question => ({
  id,
  type: "mcq",
  text: `Pick ${id}`,
  options: [
    { key: "A", text: "right" },
    { key: "B", text: "wrong" },
  ],
  correct: "A",
  points: 1,
});

test("a mark is stored as a percentage and its parameters, not as marks", () => {
  const entry = buildEntry({ a1: 40, a2: 30 }, weights, { oneThing: "Quote less, read more." });
  assert.equal(entry.percent, 70);
  assert.deepEqual(entry.params, { a1: 40, a2: 30 });
  assert.equal(entry.oneThing, "Quote less, read more.");
});

test("the teacher beats the AI pass where both marked the same answer", () => {
  let record = setMark({}, "q1", "ai", buildEntry({ a1: 20, a2: 20 }, weights));
  assert.equal(effectiveMark(record, "q1")!.reviewer, "ai");
  record = setMark(record, "q1", "teacher", buildEntry({ a1: 45, a2: 45 }, weights));
  const found = effectiveMark(record, "q1")!;
  assert.equal(found.reviewer, "teacher");
  assert.equal(found.entry.percent, 90);
  // Discarding the teacher's mark hands the answer back to the suggestion.
  record = clearMark(record, "q1", "teacher");
  assert.equal(effectiveMark(record, "q1")!.reviewer, "ai");
});

test("writing one reviewer's mark leaves every other entry alone", () => {
  const record = setMark(
    setMark({}, "q1", "ai", buildEntry({ a1: 10, a2: 10 }, weights)),
    "q2",
    "teacher",
    buildEntry({ a1: 50, a2: 50 }, weights)
  );
  assert.equal(record.q1!.ai!.percent, 20);
  assert.equal(record.q2!.teacher!.percent, 100);
});

test("a blank answer counts as marked at zero, so it never holds up release", () => {
  const questions = [essay("q1"), essay("q2")];
  const status = markingStatus(questions, { q1: "   " }, {});
  const byId = Object.fromEntries(status.map((s) => [s.qid, s]));
  assert.equal(byId.q1.blank, true);
  assert.equal(byId.q1.marked, true);
  assert.equal(byId.q1.awarded, 0);
  assert.equal(byId.q2.blank, true);
  assert.equal(unmarkedCount(status), 0);
});

test("a written answer nobody has marked is still outstanding", () => {
  const status = markingStatus([essay("q1")], { q1: "An answer." }, {});
  assert.equal(unmarkedCount(status), 1);
});

test("marking a written answer resolves the pending item and adds its marks", () => {
  const questions = [mcq("q1"), essay("q2", 10)];
  const answers = { q1: "A", q2: "An answer." };
  const base = grade(questions, answers);
  assert.equal(base.pending, 1);
  assert.equal(base.score, 1);

  const record = setMark({}, "q2", "teacher", buildEntry({ a1: 40, a2: 30 }, weights));
  const applied = applyMarking(questions, base.per, answers, record);

  assert.equal(applied.pending, 0);
  assert.equal(applied.max, 11);
  assert.equal(applied.score, 8); // 1 + 70% of 10
  const q2 = applied.per.find((p) => p.qid === "q2")!;
  assert.equal(q2.pending, false);
  assert.equal(q2.awarded, 7);
  assert.equal(q2.correct, false); // marks, but not full marks
});

test("full marks on a written answer count as correct, like any other question", () => {
  const questions = [essay("q1", 10)];
  const answers = { q1: "An answer." };
  const record = setMark({}, "q1", "teacher", buildEntry({ a1: 50, a2: 50 }, weights));
  const applied = applyMarking(questions, grade(questions, answers).per, answers, record);
  assert.equal(applied.per[0].correct, true);
  assert.equal(applied.score, 10);
});

test("re-marking after the points change rescales instead of losing the judgement", () => {
  const answers = { q1: "An answer." };
  const record = setMark({}, "q1", "teacher", buildEntry({ a1: 40, a2: 30 }, weights));

  const five = applyMarking([essay("q1", 5)], grade([essay("q1", 5)], answers).per, answers, record);
  const twenty = applyMarking([essay("q1", 20)], grade([essay("q1", 20)], answers).per, answers, record);

  assert.equal(five.score, 3.5);
  assert.equal(twenty.score, 14);
});

test("an unscored question is left out of the marking entirely", () => {
  const open: Question = { ...essay("q1"), graded: false, points: 0 };
  const status = markingStatus([open], { q1: "A reflection." }, {});
  assert.equal(status[0].markable, false);
  assert.equal(unmarkedCount(status), 0);
});

test("stored marking survives a round trip, and rubbish in it does not", () => {
  const record = normalizeMarking({
    q1: { teacher: { params: { a1: "40", bad: "x" }, percent: 70, at: "2026-08-28T00:00:00.000Z" }, ghost: {} },
    q2: "not an object",
  });
  assert.deepEqual(Object.keys(record), ["q1"]);
  assert.deepEqual(record.q1!.teacher!.params, { a1: 40 });
  assert.equal(record.q1!.teacher!.percent, 70);
});
