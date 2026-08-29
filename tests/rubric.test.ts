/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { percentOf, percentSuffix, scoreLabel } from "../lib/score.ts";
import {
  DEFAULT_RUBRIC,
  RUBRIC_PRESETS,
  awardedFor,
  bandCriteria,
  bandPercents,
  descriptorStep,
  descriptorValue,
  effectiveWeights,
  normalizeRubricConfig,
  rubricErrors,
  rubricParams,
  rubricTotal,
  scorePercent,
} from "../lib/rubric.ts";

test("every shipped preset is a valid rubric adding up to 100", () => {
  for (const preset of RUBRIC_PRESETS) {
    assert.deepEqual(rubricErrors(preset.config), [], `${preset.name} should be publishable`);
    assert.equal(rubricTotal(preset.config), 100, `${preset.name} should total 100`);
  }
});

test("the default rubric is the attached one: 40 / 30 / 20 / 10", () => {
  assert.deepEqual(
    DEFAULT_RUBRIC.bands.map((b) => b.params.reduce((s, p) => s + p.weight, 0)),
    [40, 30, 20, 10]
  );
  assert.equal(rubricParams(DEFAULT_RUBRIC).length, 10);
});

test("weights that miss 100 are reported with the correction to make", () => {
  const broken = {
    bands: [{ id: "a", label: "A", params: [{ id: "a1", label: "One", weight: 90 }] }],
  };
  const errors = rubricErrors(broken);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /90%/);
  assert.match(errors[0], /10 points/);
});

test("a zero-weight parameter is an error rather than a silent no-op", () => {
  const rubric = {
    bands: [
      {
        id: "a",
        label: "A",
        params: [
          { id: "a1", label: "One", weight: 100 },
          { id: "a2", label: "Two", weight: 0 },
        ],
      },
    ],
  };
  assert.ok(rubricErrors(rubric).some((e) => /more than nothing/.test(e)));
});

test("duplicate ids are made unique, so two parameters cannot share a score", () => {
  const config = normalizeRubricConfig({
    bands: [
      {
        id: "a",
        label: "A",
        params: [
          { id: "x", label: "One", weight: 50 },
          { id: "x", label: "Two", weight: 50 },
        ],
      },
    ],
  });
  const ids = rubricParams(config).map((p) => p.id);
  assert.equal(new Set(ids).size, 2);
});

test("rubbish falls back to the default rather than producing an unusable rubric", () => {
  assert.deepEqual(normalizeRubricConfig(null), DEFAULT_RUBRIC);
  assert.deepEqual(normalizeRubricConfig({ bands: [] }), DEFAULT_RUBRIC);
});

test("a score above a parameter's weight is capped, never inflating the mark", () => {
  const weights = { a1: 10, a2: 10 };
  assert.equal(scorePercent({ a1: 40, a2: 10 }, weights), 100);
});

test("an unscored parameter costs its marks rather than shrinking the denominator", () => {
  // 10 of a possible 20 — the missing parameter counts as nothing awarded, which
  // is what keeps a half-finished marking honest about being half-finished.
  assert.equal(scorePercent({ a1: 10 }, { a1: 10, a2: 10 }), 50);
});

test("marks are derived from the percentage, so rescaling points keeps the diagnostic", () => {
  const weights = { a1: 50, a2: 50 };
  const percent = scorePercent({ a1: 40, a2: 30 }, weights);
  assert.equal(percent, 70);
  assert.equal(awardedFor(percent, 10), 7);
  assert.equal(awardedFor(percent, 40), 28);
});

test("a per-question override replaces only the parameters it names", () => {
  const weights = effectiveWeights(DEFAULT_RUBRIC, { a1: 25 });
  assert.equal(weights.a1, 25);
  assert.equal(weights.a2, 15); // untouched, still the rubric's own
});

test("band percentages read the same scores one zoom level out", () => {
  const weights = effectiveWeights(DEFAULT_RUBRIC);
  const bands = bandPercents(DEFAULT_RUBRIC, { a1: 15, a2: 15, a3: 10, c1: 5 }, weights);
  const byId = Object.fromEntries(bands.map((b) => [b.id, b]));
  assert.equal(byId.a.percent, 100);
  assert.equal(byId.c.percent, 25); // 5 of 20
  assert.equal(byId.b.percent, null); // nothing scored there at all
});

test("peers get one criterion per band, worth the band's own weight", () => {
  assert.deepEqual(
    bandCriteria(DEFAULT_RUBRIC).map((c) => c.max),
    [40, 30, 20, 10]
  );
});

test("the descriptor scale maps five steps onto a criterion's weight", () => {
  assert.equal(descriptorValue(0, 40), 0);
  assert.equal(descriptorValue(2, 40), 20);
  assert.equal(descriptorValue(4, 40), 40);
  assert.equal(descriptorStep(20, 40), 2);
  // A score entered numerically that sits off the scale is not forced onto it.
  assert.equal(descriptorStep(17, 40), null);
});

// ---------- percentages beside marks ----------

test("a mark out of an uneven total carries its percentage", () => {
  assert.equal(scoreLabel(8, 13), "8 / 13 (62%)");
  assert.equal(percentSuffix(8, 13), "(62%)");
  assert.equal(percentOf(8, 13), 62);
});

test("a mark out of nothing keeps the mark and drops the bracket, rather than claiming 0%", () => {
  assert.equal(scoreLabel(0, 0), "0 / 0");
  assert.equal(percentSuffix(3, 0), "");
  assert.equal(percentOf(3, 0), null);
  assert.equal(percentOf(3, null), null);
});

test("a missing score is a zero, not a blank — the total is what makes it meaningful", () => {
  assert.equal(scoreLabel(null, 20), "0 / 20 (0%)");
  assert.equal(scoreLabel(20, 20), "20 / 20 (100%)");
});

test("fractional marks round to a whole percentage without losing the mark itself", () => {
  assert.equal(scoreLabel(7.5, 13), "7.5 / 13 (58%)");
});
