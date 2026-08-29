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
  normalizeAllotment,
  parseRoster,
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
