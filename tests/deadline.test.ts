/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEADLINE_PRESETS,
  describeDeadline,
  endOfDayAfter,
  fromLocalInput,
  isPast,
  matchPreset,
  presetValue,
  toLocalInput,
} from "../lib/deadline.ts";

/** A fixed afternoon to reason from: Wednesday 2 September 2026, 3:07 pm local. */
const AFTERNOON = new Date(2026, 8, 2, 15, 7, 30, 500);

test("every dated preset lands at the last minute of a day, never mid-afternoon", () => {
  for (const preset of ["today", "week", "month", "year"] as const) {
    const value = presetValue(preset, AFTERNOON);
    assert.match(value, /T23:59$/, `${preset} should close at 11:59 pm, got ${value}`);
  }
});

test("the presets mean the days they say", () => {
  assert.equal(presetValue("today", AFTERNOON), "2026-09-02T23:59");
  assert.equal(presetValue("week", AFTERNOON), "2026-09-09T23:59");
  assert.equal(presetValue("month", AFTERNOON), "2026-10-02T23:59");
  assert.equal(presetValue("year", AFTERNOON), "2027-09-02T23:59");
});

test("no deadline clears the field rather than inventing one", () => {
  assert.equal(presetValue("none", AFTERNOON), "");
  assert.equal(presetValue("custom", AFTERNOON), "");
});

test("day arithmetic rolls the month and the year", () => {
  // 30 days from 20 December 2026 is 19 January 2027.
  assert.equal(endOfDayAfter(30, new Date(2026, 11, 20, 9, 0)), "2027-01-19T23:59");
  // And a leap day is a day like any other.
  assert.equal(endOfDayAfter(1, new Date(2028, 1, 28, 9, 0)), "2028-02-29T23:59");
});

test("the chosen chip is re-derived from the value, not remembered", () => {
  assert.equal(matchPreset("", AFTERNOON), "none");
  assert.equal(matchPreset(presetValue("week", AFTERNOON), AFTERNOON), "week");
  // A date the teacher typed themselves is nobody's preset.
  assert.equal(matchPreset("2026-09-04T17:30", AFTERNOON), "custom");
  // "Tonight", read tomorrow, is simply a date — and says so.
  const tonight = presetValue("today", AFTERNOON);
  assert.equal(matchPreset(tonight, new Date(2026, 8, 3, 9, 0)), "custom");
});

test("the resolved instant is spelled back in words", () => {
  assert.equal(describeDeadline("2026-09-09T23:59", AFTERNOON), "Closes Wed 9 Sep, 11:59 pm.");
  // Another year is named, so a 1-year deadline cannot be misread as this one.
  assert.equal(describeDeadline("2027-09-02T23:59", AFTERNOON), "Closes Thu 2 Sep 2027, 11:59 pm.");
  // Midnight and noon are the two the twelve-hour clock gets wrong.
  assert.equal(describeDeadline("2026-09-09T00:00", AFTERNOON), "Closes Wed 9 Sep, 12:00 am.");
  assert.equal(describeDeadline("2026-09-09T12:00", AFTERNOON), "Closes Wed 9 Sep, 12:00 pm.");
});

test("an empty deadline is described as open, not as blank", () => {
  assert.equal(describeDeadline("", AFTERNOON), "Open until you close it by hand.");
});

test("a deadline already gone is reported as gone", () => {
  assert.equal(isPast("2026-09-01T23:59", AFTERNOON), true);
  assert.equal(isPast("2026-09-02T23:59", AFTERNOON), false);
  assert.equal(isPast("", AFTERNOON), false);
});

test("a value survives the round trip through the input and back", () => {
  const local = presetValue("week", AFTERNOON);
  assert.equal(toLocalInput(fromLocalInput(local)), local);
});

test("rubbish in the stored field leaves the picker empty rather than NaN", () => {
  assert.equal(toLocalInput("not a date"), "");
  assert.equal(toLocalInput(undefined), "");
  assert.equal(fromLocalInput("not a date"), "");
  assert.equal(fromLocalInput(""), "");
});

test("the chip row offers a way out as well as a way in", () => {
  const ids = DEADLINE_PRESETS.map((p) => p.id);
  assert.deepEqual(ids, ["none", "today", "week", "month", "year", "custom"]);
});
