/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateScores,
  normalizePeerConfig,
  outlierGap,
  peerMaxScore,
  reviewTotal,
  reviewableQuestions,
  topUpAllocation,
  type Pair,
} from "../lib/peer.ts";
import type { Question } from "../lib/types.ts";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `a${String(i + 1).padStart(2, "0")}`);

const countBy = (pairs: Pair[], key: keyof Pair) => {
  const m = new Map<string, number>();
  for (const p of pairs) m.set(p[key], (m.get(p[key]) ?? 0) + 1);
  return m;
};

// ---------------- allocation ----------------

test("every response gets the requested number of reviews", () => {
  const pairs = topUpAllocation(ids(10), [], 3);
  const received = countBy(pairs, "attemptId");
  assert.equal(received.size, 10);
  for (const [, n] of received) assert.equal(n, 3);
});

test("the reviewing load is spread evenly", () => {
  const pairs = topUpAllocation(ids(10), [], 3);
  const load = [...countBy(pairs, "reviewerAttemptId").values()];
  assert.equal(Math.max(...load) - Math.min(...load), 0, "10 students × 3 reviews divides evenly");
});

test("nobody is ever assigned their own work", () => {
  const pairs = topUpAllocation(ids(7), [], 4);
  assert.ok(pairs.every((p) => p.attemptId !== p.reviewerAttemptId));
});

test("no pair is duplicated", () => {
  const pairs = topUpAllocation(ids(6), [], 3);
  const keys = pairs.map((p) => `${p.attemptId}|${p.reviewerAttemptId}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("asking for more reviewers than there are classmates falls back to everyone else", () => {
  const pairs = topUpAllocation(ids(3), [], 5);
  const received = countBy(pairs, "attemptId");
  for (const [, n] of received) assert.equal(n, 2);
});

test("a single response cannot be peer reviewed", () => {
  assert.deepEqual(topUpAllocation(ids(1), [], 3), []);
});

test("a late submission is slotted in without disturbing existing assignments", () => {
  const first = topUpAllocation(ids(5), [], 2);
  const withLatecomer = topUpAllocation([...ids(5), "a06"], first, 2);
  // The original pairs are untouched and only gaps are filled.
  const all = [...first, ...withLatecomer];
  const received = countBy(all, "attemptId");
  assert.equal(received.get("a06"), 2, "the newcomer's work is reviewed too");
  // Everyone keeps the two reviewers they were promised; making room for the
  // latecomer's own marking may give one or two of them a third.
  for (const id of ids(5)) assert.ok((received.get(id) ?? 0) >= 2);
  assert.ok(withLatecomer.every((p) => p.attemptId !== p.reviewerAttemptId));
  assert.ok(
    first.every((p) => !withLatecomer.some((n) => n.attemptId === p.attemptId && n.reviewerAttemptId === p.reviewerAttemptId)),
    "no existing pair is handed out twice"
  );
});

test("a late submitter is given marking of their own, not just marks", () => {
  const first = topUpAllocation(ids(5), [], 2);
  const withLatecomer = topUpAllocation([...ids(5), "a06"], first, 2);
  const load = countBy([...first, ...withLatecomer], "reviewerAttemptId");
  assert.equal(load.get("a06"), 2, "the newcomer reviews as many as everybody else");
  for (const id of [...ids(5), "a06"]) assert.ok((load.get(id) ?? 0) >= 2, `${id} has reviewing to do`);
});

test("several latecomers at once all get work and are all reviewed", () => {
  const first = topUpAllocation(ids(4), [], 2);
  const later = topUpAllocation([...ids(4), "a05", "a06", "a07"], first, 2);
  const all = [...first, ...later];
  const load = countBy(all, "reviewerAttemptId");
  const received = countBy(all, "attemptId");
  for (const id of ids(7)) {
    assert.ok((load.get(id) ?? 0) >= 2, `${id} reviews at least two`);
    assert.ok((received.get(id) ?? 0) >= 2, `${id} is reviewed at least twice`);
  }
  assert.ok(all.every((p) => p.attemptId !== p.reviewerAttemptId));
  const keys = all.map((p) => `${p.attemptId}|${p.reviewerAttemptId}`);
  assert.equal(new Set(keys).size, keys.length, "no duplicated pair");
});

test("running allocation twice with no new students adds nothing", () => {
  const first = topUpAllocation(ids(8), [], 3);
  assert.deepEqual(topUpAllocation(ids(8), first, 3), []);
});

// ---------------- rubric arithmetic ----------------

const criteria = [
  { id: "c1", label: "Argument", max: 5 },
  { id: "c2", label: "Clarity", max: 5 },
];

test("the rubric maximum covers every criterion on every reviewed question", () => {
  assert.equal(peerMaxScore(criteria, 3), 30);
});

test("a reviewer's total adds up every criterion across the questions", () => {
  const scores = { q1: { c1: 4, c2: 3 }, q2: { c1: 5, c2: 5 } };
  assert.equal(reviewTotal(scores, criteria, ["q1", "q2"]), 17);
});

test("scores above a criterion's maximum are clamped, and blanks count as nothing", () => {
  const scores = { q1: { c1: 99, c2: -4 }, q2: {} };
  assert.equal(reviewTotal(scores, criteria, ["q1", "q2"]), 5);
});

test("only marks for the reviewed questions are counted", () => {
  const scores = { q1: { c1: 5, c2: 5 }, qX: { c1: 5, c2: 5 } };
  assert.equal(reviewTotal(scores, criteria, ["q1"]), 10);
});

// ---------------- aggregation ----------------

test("the mean averages every reviewer; the median ignores the extremes", () => {
  assert.equal(aggregateScores([10, 12, 26], "mean"), 16);
  assert.equal(aggregateScores([10, 12, 26], "median"), 12);
});

test("an even number of reviews takes the midpoint of the middle two", () => {
  assert.equal(aggregateScores([10, 12, 14, 20], "median"), 13);
});

test("a response nobody reviewed has no peer mark rather than a zero", () => {
  assert.equal(aggregateScores([], "mean"), null);
});

test("a reviewer far from the rest of the panel is flagged", () => {
  assert.ok(outlierGap(30, [30, 12, 11], 30) > 0.25, "a generous outlier stands out");
  assert.ok(outlierGap(12, [30, 12, 11], 30) < 0.25, "an agreeing reviewer does not");
});

test("a single review cannot be an outlier against nothing", () => {
  assert.equal(outlierGap(20, [20], 30), 0);
});

// ---------------- config and question selection ----------------

test("peers mark typed answers, not multiple-choice picks", () => {
  const questions = [
    { id: "q1", type: "mcq", text: "", options: [], points: 0 },
    { id: "q2", type: "essay", text: "", options: [], points: 0 },
    { id: "q3", type: "short", text: "", options: [], points: 0 },
    { id: "q4", type: "multi", text: "", options: [], points: 0 },
  ] as Question[];
  assert.deepEqual(reviewableQuestions(questions).map((q) => q.id), ["q2", "q3"]);
});

test("a malformed stored config still yields something usable", () => {
  const cfg = normalizePeerConfig({ reviewsPerResponse: 999, criteria: [{ label: "Depth", max: "8" }], aggregate: "nonsense" });
  assert.equal(cfg.reviewsPerResponse, 10);
  assert.equal(cfg.aggregate, "mean");
  assert.deepEqual(cfg.criteria, [{ id: "c1", label: "Depth", max: 8 }]);
});

test("an empty criteria list falls back to the defaults rather than a zero-mark rubric", () => {
  const cfg = normalizePeerConfig({ criteria: [] });
  assert.ok(cfg.criteria.length > 0);
  assert.ok(peerMaxScore(cfg.criteria, 1) > 0);
});

// ---------------- end-to-end scoring shape ----------------

test("summarisePeer turns reviews into marks, credit and a teacher override", async () => {
  const { summarisePeer } = await import("../lib/peerdb.ts");
  const questions = [
    { id: "q1", type: "essay", text: "Discuss", options: [], points: 0, graded: false },
    { id: "q2", type: "mcq", text: "Pick", options: [], points: 0, graded: false },
  ] as Question[];
  const config = normalizePeerConfig({ criteria, reviewsPerResponse: 2, reviewPoints: 4, aggregate: "mean" });
  const attempts = [
    { id: "a1", student: {}, group_info: null, answers: {}, teacher_score: null, submitted_at: "2026-01-01" },
    { id: "a2", student: {}, group_info: null, answers: {}, teacher_score: 7, submitted_at: "2026-01-01" },
  ] as never[];
  const reviews = [
    // a1 is marked by both classmates: 8 and 6, so the mean is 7.
    { id: "r1", quiz_id: "z", attempt_id: "a1", reviewer_attempt_id: "a2", scores: { q1: { c1: 4, c2: 4 } }, comments: {}, status: "submitted", submitted_at: "x" },
    { id: "r2", quiz_id: "z", attempt_id: "a1", reviewer_attempt_id: "a3", scores: { q1: { c1: 3, c2: 3 } }, comments: {}, status: "submitted", submitted_at: "x" },
    // a2's own review is done, so a2 earns the completion credit.
    { id: "r3", quiz_id: "z", attempt_id: "a2", reviewer_attempt_id: "a1", scores: null, comments: {}, status: "assigned", submitted_at: null },
  ] as never[];

  const { outcomes, max, rubricMax } = summarisePeer(questions, attempts, reviews, config);
  assert.equal(rubricMax, 10, "only the essay is reviewable, at 10 marks");
  assert.equal(max, 14, "plus 4 marks for doing your own reviewing");

  const a1 = outcomes.find((o) => o.attemptId === "a1")!;
  assert.equal(a1.peerScore, 7);
  assert.equal(a1.reviewCredit, 0, "a1 has not done the review it was assigned");
  assert.equal(a1.finalScore, 7);

  const a2 = outcomes.find((o) => o.attemptId === "a2")!;
  assert.equal(a2.peerScore, null, "nobody has reviewed a2 yet");
  assert.equal(a2.reviewCredit, 4, "a2 finished its own reviewing");
  assert.equal(a2.finalScore, 7, "the teacher's override wins over peers plus credit");
});
