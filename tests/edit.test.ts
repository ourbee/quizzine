/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { nextQuestionId, planEdit } from "../lib/edit.ts";
import type { Question } from "../lib/types.ts";

function mcq(id: string, text: string, correct = "A", points = 1): Question {
  return {
    id,
    type: "mcq",
    text,
    options: [
      { key: "A", text: "first" },
      { key: "B", text: "second" },
    ],
    correct,
    points,
  };
}

const before = [mcq("q1", "One"), mcq("q2", "Two"), mcq("q3", "Three")];

test("rewording, retagging and reordering are safe edits", () => {
  const incoming = [
    { ...before[2], text: "Three, reworded" },
    { ...before[0], tags: ["Period: Victorian"] },
    { ...before[1], difficulty: 4 },
  ];
  const plan = planEdit(before, incoming, true);
  assert.equal(plan.tier, "safe");
  assert.equal(plan.regrade.length, 0);
  assert.deepEqual(
    plan.questions.map((qn) => qn.id),
    ["q3", "q1", "q2"],
    "a question keeps its id through a reorder"
  );
});

test("deleting a question never renumbers the ones that remain", () => {
  // The trap this whole module exists to avoid: without stable ids, last term's
  // answer to q3 would become an answer to a different question.
  const plan = planEdit(before, [before[0], before[2]], true);
  assert.deepEqual(
    plan.questions.map((qn) => qn.id),
    ["q1", "q3"]
  );
  assert.deepEqual(plan.removed.map((r) => r.qid), ["q2"]);
  assert.equal(plan.tier, "structural");
});

test("a new question gets an id no question here has ever held", () => {
  const withGap = [mcq("q1", "One"), mcq("q5", "Five")];
  const plan = planEdit(withGap, [...withGap, { ...mcq("", "New"), id: "" }], false);
  assert.equal(plan.questions[2].id, "q6", "counting continues past the highest, not the count");
  assert.deepEqual(plan.added.map((a) => a.qid), ["q6"]);
});

test("two new questions in one edit do not collide", () => {
  const plan = planEdit(before, [...before, { ...mcq("", "A"), id: "" }, { ...mcq("", "B"), id: "" }], false);
  const ids = plan.questions.map((qn) => qn.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.slice(3), ["q4", "q5"]);
});

test("changing the correct answer forces a regrade", () => {
  const plan = planEdit(before, [before[0], { ...before[1], correct: "B" }, before[2]], true);
  assert.equal(plan.tier, "regrade");
  assert.deepEqual(plan.regrade.map((r) => r.qid), ["q2"]);
  assert.match(plan.regrade[0].reason, /correct answer/);
});

test("changing the marks forces a regrade", () => {
  const plan = planEdit(before, [{ ...before[0], points: 4 }, before[1], before[2]], true);
  assert.equal(plan.tier, "regrade");
  assert.match(plan.regrade[0].reason, /marks changed from 1 to 4/);
});

test("rewriting an option is a marking change, because a student chose that text", () => {
  const edited = {
    ...before[0],
    options: [
      { key: "A", text: "first, rewritten" },
      { key: "B", text: "second" },
    ],
  };
  const plan = planEdit(before, [edited, before[1], before[2]], true);
  assert.equal(plan.tier, "regrade");
  assert.match(plan.regrade[0].reason, /options changed/);
});

test("turning scoring on or off is a marking change", () => {
  const off = planEdit(before, [{ ...before[0], graded: false, points: 0 }, before[1], before[2]], true);
  assert.match(off.regrade[0].reason, /no longer scored/);

  const survey = [{ ...mcq("q1", "One"), graded: false as const, points: 0 }];
  const on = planEdit(survey, [{ ...survey[0], graded: true, points: 1 }], true);
  assert.match(on.regrade[0].reason, /now scored/);
});

test("with no attempts yet, structural edits are simply safe", () => {
  const plan = planEdit(before, [before[0], { ...mcq("", "New"), id: "" }], false);
  assert.equal(plan.tier, "safe");
  assert.equal(plan.warnings.length, 0, "there is nobody to warn about");
});

test("the teacher is warned in plain language before a structural edit", () => {
  const plan = planEdit(before, [before[0], { ...mcq("", "New"), id: "" }], true);
  assert.equal(plan.tier, "structural");
  assert.equal(plan.warnings.length, 2, "one about the removals, one about the addition");
  assert.ok(plan.warnings.some((w) => w.includes("stop counting")));
  assert.ok(plan.warnings.some((w) => w.includes("smaller total")));
});

test("an unknown id is treated as a new question, not as a silent overwrite", () => {
  const plan = planEdit(before, [{ ...mcq("q99", "Forged") }], true);
  assert.equal(plan.questions[0].id, "q4");
  assert.deepEqual(plan.added.map((a) => a.qid), ["q4"]);
});

test("ids are handed out without gaps or reuse across several calls", () => {
  const next = nextQuestionId(before);
  assert.equal(next(), "q4");
  assert.equal(next(), "q5");
  const skipping = nextQuestionId(before);
  assert.equal(skipping(new Set(["q4", "q5"])), "q6");
});
