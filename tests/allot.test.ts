/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  allotmentCoverage,
  allotmentProblems,
  allottedFor,
  dealAllotment,
  fillAllotmentGaps,
  normalizeAllotment,
  parseRoster,
  setAllottedQid,
  type Allotment,
} from "../lib/allot.ts";
import type { Question } from "../lib/types.ts";

const q = (id: string): Question => ({
  id,
  type: "essay",
  text: `Question ${id}`,
  options: [],
  points: 10,
});

const bank = (n: number) => Array.from({ length: n }, (_, i) => `q${i + 1}`);
const rolls = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));

test("parseRoster splits on lines, commas, spaces; dedupes; flags junk", () => {
  const r = parseRoster("1\n2, 3\t4 5;6\n2\nabc 7x 07\n");
  assert.deepEqual(r.rolls, ["1", "2", "3", "4", "5", "6", "07"]);
  assert.deepEqual(r.duplicates, ["2"]);
  assert.deepEqual(r.invalid, ["abc", "7x"]);
});

test("dealAllotment is deterministic for a seed and changes with it", () => {
  const a = dealAllotment(bank(10), rolls(6), 1, "seed-a");
  const b = dealAllotment(bank(10), rolls(6), 1, "seed-a");
  const c = dealAllotment(bank(10), rolls(6), 1, "seed-b");
  assert.deepEqual(a, b);
  assert.notDeepEqual(
    a.map((e) => e.qids),
    c.map((e) => e.qids)
  );
});

test("a bank at least as big as the roster deals every student a distinct question", () => {
  const dealt = dealAllotment(bank(12), rolls(12), 1, "s");
  const used = new Set(dealt.flatMap((e) => e.qids));
  assert.equal(used.size, 12);
  for (const e of dealt) assert.equal(e.qids.length, 1);
});

test("a smaller bank cycles, spreading reuse evenly", () => {
  const dealt = dealAllotment(bank(3), rolls(7), 1, "s");
  const counts = new Map<string, number>();
  for (const e of dealt) counts.set(e.qids[0], (counts.get(e.qids[0]) ?? 0) + 1);
  const values = [...counts.values()].sort();
  assert.deepEqual(values, [2, 2, 3]);
});

test("perStudent > 1 never repeats a question within one student", () => {
  const dealt = dealAllotment(bank(5), rolls(8), 3, "s");
  for (const e of dealt) {
    assert.equal(e.qids.length, 3);
    assert.equal(new Set(e.qids).size, 3);
  }
});

test("perStudent is clamped to the bank size", () => {
  const dealt = dealAllotment(bank(2), rolls(3), 5, "s");
  for (const e of dealt) assert.equal(e.qids.length, 2);
});

test("an empty bank deals empty hands rather than throwing", () => {
  const dealt = dealAllotment([], rolls(2), 1, "s");
  assert.deepEqual(
    dealt.map((e) => e.qids),
    [[], []]
  );
});

test("normalizeAllotment drops dead qids, duplicate rolls and junk", () => {
  const raw = {
    semester: 3,
    perStudent: 1,
    seed: "s",
    entries: [
      { roll: " 17 ", qids: ["q1", "gone", "q1"] },
      { roll: "17", qids: ["q2"] },
      { roll: "", qids: ["q2"] },
      { bad: true },
      { roll: "18", qids: ["q2"], manual: true },
    ],
  };
  const a = normalizeAllotment(raw, new Set(["q1", "q2"]));
  assert.ok(a);
  assert.equal(a.semester, 3);
  assert.deepEqual(a.entries, [
    { roll: "17", qids: ["q1"] },
    { roll: "18", qids: ["q2"], manual: true },
  ]);
});

test("normalizeAllotment rejects shapes without a semester", () => {
  assert.equal(normalizeAllotment({ entries: [] }), null);
  assert.equal(normalizeAllotment(null), null);
  assert.equal(normalizeAllotment("x"), null);
});

test("allottedFor finds a roll however it is typed, and misses politely", () => {
  const a: Allotment = {
    semester: 3,
    perStudent: 1,
    seed: "s",
    entries: [{ roll: "17", qids: ["q4"] }],
  };
  assert.deepEqual(allottedFor(a, " 17 "), ["q4"]);
  assert.equal(allottedFor(a, "99"), null);
});

test("coverage counts reuse, unused and unassigned", () => {
  const a: Allotment = {
    semester: 3,
    perStudent: 1,
    seed: "s",
    entries: [
      { roll: "1", qids: ["q1"] },
      { roll: "2", qids: ["q1"] },
      { roll: "3", qids: [] },
    ],
  };
  const cov = allotmentCoverage(a, [q("q1"), q("q2")]);
  assert.equal(cov.rosterSize, 3);
  assert.deepEqual(cov.unassigned, ["3"]);
  assert.equal(cov.reused, 1);
  assert.equal(cov.unused, 1);
});

test("allotmentProblems blocks an empty roster and undealt rolls", () => {
  assert.equal(allotmentProblems(null, [q("q1")]).length, 1);
  const a: Allotment = {
    semester: 3,
    perStudent: 1,
    seed: "s",
    entries: [
      { roll: "1", qids: ["q1"] },
      { roll: "2", qids: ["gone"] },
    ],
  };
  const problems = allotmentProblems(a, [q("q1")]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /2/);
  const ok: Allotment = { ...a, entries: [{ roll: "1", qids: ["q1"] }] };
  assert.deepEqual(allotmentProblems(ok, [q("q1")]), []);
});

// ---------------------------------------------------------------------------
// Marking an allotted test. The package builder is fed the union of every
// dealt question and answers only where a student actually sat one, which is
// how the copy-package / paste-back round trip survives one question per
// student. See SPEC-allotted-tests.md §7.
// ---------------------------------------------------------------------------

test("a batch package over an allotted test holds one cell per student, and the codes round-trip", async () => {
  const { buildPackage, parseAiReply } = await import("../lib/markpack.ts");
  const { DEFAULT_RUBRIC, effectiveWeights } = await import("../lib/rubric.ts");
  const weights = effectiveWeights(DEFAULT_RUBRIC);

  const bank: Question[] = ["q1", "q2", "q3"].map((id, i) => ({
    id,
    type: "essay",
    text: `Grammar question ${i + 1}`,
    options: [],
    points: 10,
  }));
  // Four students, one question each, dealt as the dealer would deal them.
  const dealt = dealAllotment(
    bank.map((b) => b.id),
    ["11", "12", "13", "14"],
    1,
    "seed"
  );
  const hands = new Map(dealt.map((e, i) => [`a${i + 1}`, e.qids]));

  const pack = buildPackage({
    scope: "batch",
    rubric: DEFAULT_RUBRIC,
    questions: bank.map((question) => ({ question, weights })),
    attempts: [...hands.keys()].map((attemptId) => ({ attemptId })),
    // The one rule that makes this work: a student answers only their own hand.
    answer: (attemptId, qid) =>
      hands.get(attemptId)?.includes(qid) ? `Answer by ${attemptId} to ${qid}` : "",
  });

  const codes = Object.keys(pack.codeMap);
  assert.equal(codes.length, 4, "one cell per student, not one per student per question");
  for (const [code, ref] of Object.entries(pack.codeMap)) {
    assert.ok(hands.get(ref.attemptId)?.includes(ref.qid), `${code} points at a question its student was dealt`);
  }
  // Every student is represented exactly once.
  assert.deepEqual(
    [...new Set(Object.values(pack.codeMap).map((r) => r.attemptId))].sort(),
    ["a1", "a2", "a3", "a4"]
  );

  // A reply keyed by those codes resolves back to the right (student, question).
  const reply = JSON.stringify(
    codes.map((code) => ({
      code,
      scores: Object.fromEntries(Object.keys(weights).map((p) => [p, 5])),
      strengths: "s",
      improvements: "i",
      corrections: "c",
      oneThing: "o",
    }))
  );
  const parsed = parseAiReply(reply, codes, pack.codeWeights);
  assert.equal(parsed.marks.length, 4);
  assert.deepEqual(parsed.rejected, []);
  assert.deepEqual(parsed.unmarked, []);
  // Each mark resolves to the student whose answer it judged.
  for (const mark of parsed.marks) {
    const ref = pack.codeMap[mark.code];
    assert.ok(hands.get(ref.attemptId)?.includes(ref.qid));
  }
});

test("an allotted student's package covers their own question only", async () => {
  const { buildPackage } = await import("../lib/markpack.ts");
  const { DEFAULT_RUBRIC, effectiveWeights } = await import("../lib/rubric.ts");
  const weights = effectiveWeights(DEFAULT_RUBRIC);
  const bank: Question[] = ["q1", "q2", "q3"].map((id) => ({
    id,
    type: "essay",
    text: `Question ${id}`,
    options: [],
    points: 10,
  }));
  const pack = buildPackage({
    scope: "student",
    rubric: DEFAULT_RUBRIC,
    questions: bank.map((question) => ({ question, weights })),
    attempts: [{ attemptId: "a1" }],
    answer: (_a, qid) => (qid === "q2" ? "Their one answer." : ""),
  });
  assert.deepEqual(Object.values(pack.codeMap).map((r) => r.qid), ["q2"]);
  assert.equal(pack.blank, 2, "the two questions they never sat are counted as blank, not marked");
});


// The editor's dropdowns. The bug these cover: a roll dealt nothing has an
// empty qids array, and the old `qids.map(...)` over it produced another empty
// array — so every question picked by hand for that roll was thrown away while
// the row was still marked "edited".

test("setAllottedQid fills a slot on a roll that was dealt nothing", () => {
  const a: Allotment = {
    semester: 1,
    perStudent: 1,
    seed: "s",
    entries: [
      { roll: "1", qids: ["q1"] },
      { roll: "2", qids: [] },
    ],
  };
  const next = setAllottedQid(a, "2", 0, "q2");
  assert.deepEqual(next.entries[1].qids, ["q2"]);
  assert.equal(next.entries[1].manual, true);
  assert.deepEqual(next.entries[0].qids, ["q1"], "the other rolls are untouched");
  assert.deepEqual(a.entries[1].qids, [], "the input is not mutated");
});

test("setAllottedQid pads a short hand up to the slot being set", () => {
  const a: Allotment = { semester: 1, perStudent: 3, seed: "s", entries: [{ roll: "7", qids: ["q1"] }] };
  const next = setAllottedQid(a, "7", 2, "q3");
  assert.deepEqual(next.entries[0].qids, ["q1", "", "q3"]);
});

test("setAllottedQid swaps rather than dealing one student the same question twice", () => {
  const a: Allotment = { semester: 1, perStudent: 2, seed: "s", entries: [{ roll: "1", qids: ["q1", "q2"] }] };
  const next = setAllottedQid(a, "1", 1, "q1");
  assert.deepEqual(next.entries[0].qids, ["q2", "q1"]);
});

test("setAllottedQid takes a roll however it is typed, and clears on an empty pick", () => {
  const a: Allotment = { semester: 1, perStudent: 1, seed: "s", entries: [{ roll: "5", qids: ["q1"] }] };
  assert.deepEqual(setAllottedQid(a, " 5 ", 0, "q2").entries[0].qids, ["q2"]);
  assert.deepEqual(setAllottedQid(a, "5", 0, "").entries[0].qids, [""]);
});

// The status line must describe the rows as they are shown, holes included.

test("coverage treats an empty slot as a hole, not as a dealt question", () => {
  const a: Allotment = {
    semester: 1,
    perStudent: 2,
    seed: "s",
    entries: [
      { roll: "1", qids: ["q1", ""] },
      { roll: "2", qids: ["", ""] },
    ],
  };
  const cov = allotmentCoverage(a, [q("q1"), q("q2")]);
  assert.deepEqual(cov.unassigned, ["2"]);
  assert.deepEqual(cov.incomplete, ["1", "2"]);
  assert.equal(cov.reused, 0, "an empty slot is never a reused question");
  assert.equal(cov.unused, 1);
  assert.equal(allotmentProblems(a, [q("q1"), q("q2")]).length, 1);
});

test("normalizeAllotment strips the editor's empty slots", () => {
  const a = normalizeAllotment({ semester: 1, perStudent: 2, seed: "s", entries: [{ roll: "1", qids: ["q1", ""] }] });
  assert.deepEqual(a?.entries[0].qids, ["q1"]);
});

test("fillAllotmentGaps fills only the holes, evenly, without repeating within a hand", () => {
  const a: Allotment = {
    semester: 1,
    perStudent: 2,
    seed: "s",
    entries: [
      { roll: "1", qids: ["q1", "q2"], manual: true },
      { roll: "2", qids: ["", ""] },
      { roll: "3", qids: ["q1", ""] },
    ],
  };
  const next = fillAllotmentGaps(a, bank(4), "seed");
  assert.deepEqual(next.entries[0].qids, ["q1", "q2"], "a full hand is left alone");
  for (const e of next.entries) {
    assert.equal(e.qids.filter(Boolean).length, 2);
    assert.equal(new Set(e.qids).size, 2, "no student holds the same question twice");
  }
  const usage = new Map<string, number>();
  for (const e of next.entries) for (const id of e.qids) usage.set(id, (usage.get(id) ?? 0) + 1);
  assert.ok(Math.max(...usage.values()) - Math.min(...usage.values()) <= 1, "the bank is spread evenly");
});

test("fillAllotmentGaps leaves a hole when the bank is smaller than the hand", () => {
  const a: Allotment = { semester: 1, perStudent: 3, seed: "s", entries: [{ roll: "1", qids: [] }] };
  const next = fillAllotmentGaps(a, bank(2), "seed");
  assert.deepEqual(next.entries[0].qids.filter(Boolean).length, 2);
  assert.equal(next.entries[0].qids.length, 3);
});
