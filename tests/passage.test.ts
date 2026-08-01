/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import test from "node:test";
import assert from "node:assert/strict";
import { groupByPassage, shuffleWithinPassageGroups } from "../lib/questions.ts";
import { parseMarkdownText, parseSheetRows } from "../lib/parsers.ts";
import { validateQuestions } from "../lib/validate.ts";

const POEM = "Made weak by time and fate, but strong in will…";

const qn = (id: string, passage?: string, passageTitle?: string) => ({ id, passage, passageTitle });

// ---------------- grouping ----------------

test("questions repeating the same passage become one group, so it is shown once", () => {
  const groups = groupByPassage([qn("q1", POEM), qn("q2", POEM), qn("q3", POEM)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].passage, POEM);
  assert.deepEqual(
    groups[0].questions.map((q) => q.id),
    ["q1", "q2", "q3"]
  );
  assert.equal(groups[0].start, 0);
});

test("a change of passage starts a new group, so one paper can carry several", () => {
  const groups = groupByPassage([qn("q1", POEM), qn("q2", POEM), qn("q3", "Another extract")]);
  assert.deepEqual(
    groups.map((g) => [g.passage, g.start, g.questions.length]),
    [[POEM, 0, 2], ["Another extract", 2, 1]]
  );
});

test("the same passage under a different heading is a separate block", () => {
  const groups = groupByPassage([qn("q1", POEM, "The poem"), qn("q2", POEM, "Sample response")]);
  assert.equal(groups.length, 2);
});

test("trailing spreadsheet whitespace does not split a shared passage", () => {
  const groups = groupByPassage([qn("q1", POEM), qn("q2", `${POEM}  `)]);
  assert.equal(groups.length, 1);
});

test("questions with no passage keep their numbering and carry no material", () => {
  const groups = groupByPassage([qn("q1"), qn("q2"), qn("q3", POEM)]);
  assert.deepEqual(
    groups.map((g) => [g.passage, g.start]),
    [[undefined, 0], [POEM, 2]]
  );
});

// ---------------- shuffling ----------------

test("shuffling never separates a question from the passage it belongs to", () => {
  const questions = [
    qn("a1", POEM),
    qn("a2", POEM),
    qn("a3", POEM),
    qn("b1", "Second extract"),
    qn("b2", "Second extract"),
    qn("plain"),
  ];
  for (let seed = 0; seed < 50; seed++) {
    const ids = shuffleWithinPassageGroups(questions, seed).map((q) => q.id);
    const groups = groupByPassage(shuffleWithinPassageGroups(questions, seed));
    // Every question is still present, exactly once...
    assert.deepEqual([...ids].sort(), ["a1", "a2", "a3", "b1", "b2", "plain"]);
    // ...and each passage still forms a single unbroken run.
    assert.equal(groups.filter((g) => g.passage === POEM).length, 1);
    assert.equal(groups.filter((g) => g.passage === "Second extract").length, 1);
  }
});

test("a quiz with no passages is still shuffled freely", () => {
  const questions = ["q1", "q2", "q3", "q4", "q5", "q6"].map((id) => qn(id));
  const orders = new Set(
    Array.from({ length: 30 }, (_, seed) => shuffleWithinPassageGroups(questions, seed).map((q) => q.id).join(","))
  );
  assert.ok(orders.size > 5, `expected many distinct orders, got ${orders.size}`);
});

// ---------------- parsing ----------------

test("a sheet's Passage and PassageTitle columns survive into the questions", () => {
  const parsed = parseSheetRows([
    { Question: "Analyse the closing lines.", Type: "short", Passage: POEM, PassageTitle: "Sample response" },
    { Question: "Which part is the claim?", Type: "short", Passage: POEM, PassageTitle: "Sample response" },
  ]);
  const { errors, questions } = validateQuestions(parsed);
  assert.deepEqual(errors, []);
  assert.equal(questions[0].passageTitle, "Sample response");
  assert.equal(groupByPassage(questions).length, 1);
});

test("Material and MaterialTitle are accepted as column names too", () => {
  const parsed = parseSheetRows([{ Question: "Q", Type: "short", Material: POEM, "Material Title": "Read this first" }]);
  assert.equal(parsed.questions[0].passage, POEM);
  assert.equal(parsed.questions[0].passageTitle, "Read this first");
});

test("the pasted block format reads PassageTitle without swallowing it into Passage", () => {
  const parsed = parseMarkdownText(
    ["Q: Analyse the closing lines.", "Type: short", "PassageTitle: Sample response", `Passage: ${POEM}`, "continued here"].join("\n")
  );
  assert.equal(parsed.questions[0].passageTitle, "Sample response");
  assert.equal(parsed.questions[0].passage, `${POEM} continued here`);
});

test("a heading with no material to head is flagged but does not block publishing", () => {
  const parsed = parseSheetRows([{ Question: "Q", Type: "short", PassageTitle: "Sample response" }]);
  const { errors, warnings } = validateQuestions(parsed);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes("PassageTitle")));
});

// ---------------- points on unscored questions ----------------

test("Points of 0 on an unscored question publishes instead of erroring", () => {
  const parsed = parseSheetRows([
    { Question: "Explain what Ulysses proposes.", Type: "short", Points: 0 },
    { Question: "Is Ulysses heroic?", Type: "short", Points: 0 },
  ]);
  const { errors, questions } = validateQuestions(parsed, "survey");
  assert.deepEqual(errors, []);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].points, 0);
  assert.equal(questions[0].graded, false);
});

test("Points of 0 on an open question publishes even in a scored quiz", () => {
  const parsed = parseSheetRows([{ Question: "What would you like to discuss?", Type: "open", Points: 0 }]);
  const { errors, questions } = validateQuestions(parsed);
  assert.deepEqual(errors, []);
  assert.equal(questions[0].points, 0);
});

test("Points of 0 on a question that IS scored is still an error", () => {
  const parsed = parseSheetRows([{ Question: "Q", Type: "short", Points: 0, Graded: "yes" }]);
  const { errors } = validateQuestions(parsed);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("positive number"));
});
