/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  countStatuses,
  emptyProgress,
  hasAnswer,
  parseProgress,
  serializeProgress,
  statusOf,
  submitSummary,
  type ExamProgress,
} from "../lib/examstate.ts";

const progress = (visited: string[] = [], marked: string[] = []): ExamProgress => ({
  visited: new Set(visited),
  marked: new Set(marked),
});

// ---------- the five statuses ----------

test("a question nobody has reached is Not Visited", () => {
  assert.equal(statusOf("q1", {}, emptyProgress()), "notVisited");
});

test("visited and left empty is Not Answered", () => {
  assert.equal(statusOf("q1", {}, progress(["q1"])), "notAnswered");
});

test("a saved answer is Answered", () => {
  assert.equal(statusOf("q1", { q1: "B" }, progress(["q1"])), "answered");
});

test("flagged without an answer is Marked for Review", () => {
  assert.equal(statusOf("q1", {}, progress(["q1"], ["q1"])), "marked");
});

test("flagged with an answer is Answered & Marked", () => {
  assert.equal(statusOf("q1", { q1: "B" }, progress(["q1"], ["q1"])), "answeredMarked");
});

test("flagging on the first visit still reads as Marked, not Not Visited", () => {
  // Mark for Review & Next can fire before anything marks the question visited.
  assert.equal(statusOf("q1", {}, progress([], ["q1"])), "marked");
});

test("a saved answer reads as Answered even if the visited set lost it", () => {
  // Not reachable through the interface, but the palette must never show a
  // question the student has filled in as untouched.
  assert.equal(statusOf("q1", { q1: "B" }, emptyProgress()), "answered");
});

// ---------- what counts as answered ----------

test("whitespace is not an answer", () => {
  assert.equal(hasAnswer("   "), false);
  assert.equal(hasAnswer(""), false);
  assert.equal(hasAnswer(undefined), false);
  assert.equal(hasAnswer("B"), true);
});

test("a multi-answer question's joined keys count as one answer", () => {
  assert.equal(statusOf("q1", { q1: "A,C" }, progress(["q1"])), "answered");
});

test("clearing an answer drops a question back to Not Answered", () => {
  assert.equal(statusOf("q1", { q1: "" }, progress(["q1"])), "notAnswered");
});

test("a typed answer counts like a chosen option", () => {
  assert.equal(statusOf("q1", { q1: "Because the metre is falling." }, progress(["q1"])), "answered");
});

// ---------- counts ----------

test("every question lands in exactly one bucket", () => {
  const qids = ["q1", "q2", "q3", "q4", "q5", "q6"];
  const answers = { q2: "A", q4: "B", q6: "C" };
  const counts = countStatuses(qids, answers, progress(["q1", "q2", "q3", "q4"], ["q3", "q4"]));
  assert.deepEqual(counts, {
    notVisited: 1, // q5 — never reached
    notAnswered: 1, // q1 — reached, left empty
    answered: 2, // q2, and q6 whose answer speaks for itself
    marked: 1, // q3
    answeredMarked: 1, // q4
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(total, qids.length);
});

// ---------- the submit summary ----------

test("the submit summary counts a flagged answer as answered", () => {
  const qids = ["q1", "q2", "q3"];
  const summary = submitSummary(qids, { q1: "A", q2: "B" }, progress(["q1", "q2", "q3"], ["q2"]));
  assert.deepEqual(summary, { total: 3, answered: 2, notAnswered: 1, flagged: 1 });
});

test("answered and notAnswered always account for the whole paper", () => {
  const qids = ["q1", "q2", "q3", "q4"];
  const s = submitSummary(qids, { q3: "A" }, progress(["q1"], ["q2"]));
  assert.equal(s.answered + s.notAnswered, s.total);
});

// ---------- persistence ----------

test("progress survives a round trip through storage", () => {
  const before = progress(["q1", "q2"], ["q2"]);
  const after = parseProgress(serializeProgress(before));
  assert.deepEqual([...after.visited].sort(), ["q1", "q2"]);
  assert.deepEqual([...after.marked], ["q2"]);
});

test("nothing stored yet reads as a clean slate", () => {
  const p = parseProgress(null);
  assert.equal(p.visited.size, 0);
  assert.equal(p.marked.size, 0);
});

test("corrupt storage reads as a clean slate rather than throwing", () => {
  const p = parseProgress("{not json");
  assert.equal(p.visited.size, 0);
  assert.equal(p.marked.size, 0);
});

test("storage missing a field reads as a clean slate for that field", () => {
  const p = parseProgress(JSON.stringify({ visited: ["q1"] }));
  assert.deepEqual([...p.visited], ["q1"]);
  assert.equal(p.marked.size, 0);
});
