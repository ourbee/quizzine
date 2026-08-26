/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_MST,
  advanceMst,
  estimateAbility,
  mstCapacity,
  mstPoints,
  normalizeMstConfig,
  planStage,
  routeNext,
  startMst,
  type MstConfig,
} from "../lib/mst.ts";
import type { Question } from "../lib/types.ts";

/** A bank of `perLevel` questions at each difficulty from 1 to 5. */
function bank(perLevel: number): Question[] {
  const out: Question[] = [];
  for (let d = 1; d <= 5; d++) {
    for (let i = 0; i < perLevel; i++) {
      out.push({
        id: `d${d}-${i}`,
        type: "mcq",
        text: `Level ${d} question ${i}`,
        options: [
          { key: "A", text: "a" },
          { key: "B", text: "b" },
        ],
        correct: "A",
        points: 1,
        difficulty: d,
      });
    }
  }
  return out;
}

const config = (over: Partial<MstConfig> = {}): MstConfig => normalizeMstConfig({ ...DEFAULT_MST, ...over });

test("the routing thresholds always leave a band that holds difficulty steady", () => {
  const c = normalizeMstConfig({ routeUpAt: 30, routeDownAt: 60 });
  assert.ok(c.routeUpAt > c.routeDownAt, "a stage must not step up and down at once");
});

test("everyone starts on the same stage", () => {
  const b = bank(20);
  const a = startMst(b, config({ perStage: 10, startDifficulty: 3 }));
  const c = startMst(b, config({ perStage: 10, startDifficulty: 3 }));
  assert.deepEqual(a.served[0], c.served[0]);
  assert.equal(a.served[0].length, 10);
  assert.ok(a.served[0].every((id) => id.startsWith("d3-")), "drawn at the starting difficulty");
});

test("a good stage routes up and a poor one routes down", () => {
  const c = config({ routeUpAt: 70, routeDownAt: 40 });
  assert.equal(routeNext(3, 80, c), 4);
  assert.equal(routeNext(3, 55, c), 3, "the middle band holds steady");
  assert.equal(routeNext(3, 30, c), 2);
});

test("routing never leaves the difficulty scale", () => {
  const c = config();
  assert.equal(routeNext(5, 100, c), 5);
  assert.equal(routeNext(1, 0, c), 1);
});

test("a student who does well climbs stage by stage", () => {
  const b = bank(20);
  const c = config({ stages: 3, perStage: 5, startDifficulty: 3 });
  let state = startMst(b, c);
  assert.equal(state.difficulty, 3);

  state = advanceMst(state, b, c, { difficulty: 3, awarded: 5, possible: 5, percent: 100 });
  assert.equal(state.difficulty, 4);
  assert.ok(state.served[1].every((id) => id.startsWith("d4-")));

  state = advanceMst(state, b, c, { difficulty: 4, awarded: 5, possible: 5, percent: 100 });
  assert.equal(state.difficulty, 5);
  assert.equal(state.done, false);

  state = advanceMst(state, b, c, { difficulty: 5, awarded: 2, possible: 5, percent: 40 });
  assert.equal(state.done, true, "the paper ends after the configured number of stages");
  assert.equal(state.results.length, 3);
});

test("a question is never served twice in one paper", () => {
  const b = bank(8);
  const c = config({ stages: 5, perStage: 5, startDifficulty: 3 });
  let state = startMst(b, c);
  // Bounce up and down so the same level is revisited.
  const path = [100, 0, 100, 0];
  for (const percent of path) {
    state = advanceMst(state, b, c, { difficulty: state.difficulty, awarded: 0, possible: 5, percent });
  }
  const all = state.served.flat();
  assert.equal(new Set(all).size, all.length, "no repeats across stages");
});

test("a thin level is filled from the nearest levels rather than served short", () => {
  const b: Question[] = [
    ...bank(2).filter((qn) => qn.difficulty === 5),
    ...bank(10).filter((qn) => qn.difficulty === 4),
  ];
  const picked = planStage(b, new Set(), 5, 6);
  assert.equal(picked.length, 6, "a full stage is still delivered");
  assert.equal(picked.filter((id) => id.startsWith("d5-")).length, 2, "both level 5 questions come first");
});

test("at equal distance an easier question is preferred to a harder one", () => {
  const b = [...bank(3).filter((qn) => qn.difficulty === 2), ...bank(3).filter((qn) => qn.difficulty === 4)];
  const picked = planStage(b, new Set(), 3, 3);
  assert.ok(
    picked.every((id) => id.startsWith("d2-")),
    "a bank with nothing at the target leans easy, not hard"
  );
});

test("a paper ends early when the bank runs dry", () => {
  const b = bank(2); // 10 questions in total
  const c = config({ stages: 5, perStage: 4, startDifficulty: 3 });
  let state = startMst(b, c);
  for (let i = 0; i < 5 && !state.done; i++) {
    state = advanceMst(state, b, c, { difficulty: state.difficulty, awarded: 4, possible: 4, percent: 100 });
  }
  assert.ok(state.done);
  assert.ok(state.served.flat().length <= b.length);
});

test("capacity warns before publishing, not after", () => {
  const c = config({ stages: 5, perStage: 10 });
  const small = mstCapacity(bank(4), c); // 20 questions, 50 wanted
  assert.equal(small.wanted, 50);
  assert.ok(small.warnings.some((w) => w.includes("end early")));
  assert.equal(small.thinLevels.length, 5, "no level can fill a stage of ten on its own");

  const big = mstCapacity(bank(12), c);
  assert.equal(big.warnings.length, 0);
  assert.equal(big.thinLevels.length, 0);
});

test("questions with no difficulty are treated as medium, and said so", () => {
  const b: Question[] = [
    { id: "x1", type: "mcq", text: "?", options: [], points: 1 },
    ...bank(1),
  ];
  const capacity = mstCapacity(b, config({ stages: 1, perStage: 1 }));
  assert.ok(capacity.warnings.some((w) => w.includes("level 3")));
});

test("scoring by difficulty pays harder questions more", () => {
  const easy = { points: 1, difficulty: 1 };
  const hard = { points: 1, difficulty: 5 };
  const fixed = config({ scoring: "fixed" });
  const scaled = config({ scoring: "byDifficulty" });
  assert.equal(mstPoints(easy, fixed), 1);
  assert.equal(mstPoints(hard, fixed), 1);
  assert.equal(mstPoints(easy, scaled), 1);
  assert.equal(mstPoints(hard, scaled), 5);
});

test("ability separates the same percentage on different papers", () => {
  const onHard = estimateAbility(
    Array.from({ length: 20 }, (_, i) => ({ difficulty: 5, correct: i < 12 }))
  );
  const onEasy = estimateAbility(
    Array.from({ length: 20 }, (_, i) => ({ difficulty: 1, correct: i < 12 }))
  );
  assert.ok(
    onHard.theta > onEasy.theta,
    "60% of very difficult questions beats 60% of very easy ones"
  );
});

test("a perfect or blank script is flagged rather than reported as a precise number", () => {
  const perfect = estimateAbility(Array.from({ length: 10 }, () => ({ difficulty: 3, correct: true })));
  assert.equal(perfect.extreme, true);
  assert.ok(Number.isFinite(perfect.theta));
  assert.ok(perfect.theta <= 3);

  const blank = estimateAbility(Array.from({ length: 10 }, () => ({ difficulty: 3, correct: false })));
  assert.equal(blank.extreme, true);
  assert.ok(blank.theta >= -3);
});

test("a middling script lands near the difficulty it was tested at", () => {
  const even = estimateAbility(
    Array.from({ length: 20 }, (_, i) => ({ difficulty: 3, correct: i % 2 === 0 }))
  );
  assert.ok(Math.abs(even.theta) < 0.2, "half right at level 3 is an ability of about level 3");
  assert.equal(even.scaled, 50);
  assert.equal(even.extreme, false);
});

test("fewer answers means a larger standard error", () => {
  const few = estimateAbility(Array.from({ length: 4 }, (_, i) => ({ difficulty: 3, correct: i % 2 === 0 })));
  const many = estimateAbility(Array.from({ length: 40 }, (_, i) => ({ difficulty: 3, correct: i % 2 === 0 })));
  assert.ok(few.se > many.se);
});

test("an empty script is not an error", () => {
  const none = estimateAbility([]);
  assert.equal(none.responses, 0);
  assert.equal(none.scaled, 50);
});
