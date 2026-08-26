/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_DIMENSION,
  applyTagMerges,
  dimensionsOf,
  extractDifficulty,
  findPreset,
  formatTag,
  normalizeTags,
  parseTag,
  readDifficulty,
  splitTagCell,
  tagKey,
  tagVariants,
  tagsOutsidePreset,
} from "../lib/tags.ts";

test("a tag splits on its first colon only", () => {
  assert.deepEqual(parseTag("Period: Victorian"), { dimension: "Period", value: "Victorian" });
  assert.deepEqual(parseTag("Text: Ulysses: a reading"), {
    dimension: "Text",
    value: "Ulysses: a reading",
  });
});

test("a tag with no dimension falls into the default one", () => {
  assert.deepEqual(parseTag("Prosody"), { dimension: DEFAULT_DIMENSION, value: "Prosody" });
  // The default dimension is implicit again when written back out.
  assert.equal(formatTag(parseTag("Prosody")!), "Prosody");
  assert.equal(formatTag(parseTag("Period: Victorian")!), "Period: Victorian");
});

test("a dangling colon does not create an empty dimension", () => {
  assert.deepEqual(parseTag(": Victorian"), { dimension: DEFAULT_DIMENSION, value: "Victorian" });
  assert.deepEqual(parseTag("Period:"), { dimension: DEFAULT_DIMENSION, value: "Period" });
  assert.equal(parseTag("   "), null);
});

test("case and spacing never split one bucket in two", () => {
  const a = parseTag("Period: Victorian")!;
  const b = parseTag("period:   victorian")!;
  assert.equal(tagKey(a), tagKey(b));
});

test("a tags cell splits on semicolons, commas and newlines", () => {
  assert.deepEqual(splitTagCell("Period: Victorian; Genre: Poetry, Author: Tennyson"), [
    "Period: Victorian",
    "Genre: Poetry",
    "Author: Tennyson",
  ]);
  assert.deepEqual(splitTagCell("A\nB\r\nC"), ["A", "B", "C"]);
  assert.deepEqual(splitTagCell(undefined), []);
});

test("normalizing keeps the first spelling of a repeated bucket", () => {
  assert.deepEqual(normalizeTags("Period: Victorian; period: victorian; Genre: Poetry"), [
    "Period: Victorian",
    "Genre: Poetry",
  ]);
});

test("difficulty is read as a number or as a word", () => {
  assert.equal(readDifficulty(4), 4);
  assert.equal(readDifficulty("2"), 2);
  assert.equal(readDifficulty("Very difficult"), 5);
  assert.equal(readDifficulty("hard"), 4);
  assert.equal(readDifficulty("medium"), 3);
  assert.equal(readDifficulty(""), undefined);
  assert.equal(readDifficulty("9"), undefined, "out of range is unset, not clamped");
  assert.equal(readDifficulty("spicy"), undefined);
});

test("difficulty written as a tag is lifted out of the tag list", () => {
  const { tags, difficulty } = extractDifficulty(
    normalizeTags("Period: Victorian; Difficulty: 4; Genre: Poetry")
  );
  assert.deepEqual(tags, ["Period: Victorian", "Genre: Poetry"]);
  assert.equal(difficulty, 4);
});

test("dimensions are listed in first-seen order, without repeats", () => {
  assert.deepEqual(dimensionsOf(["Period: Victorian", "Genre: Poetry", "period: Romantic"]), [
    "Period",
    "Genre",
  ]);
});

test("drift is caught across punctuation, plurals and single typos", () => {
  const groups = tagVariants({
    "Period: Victorian": 12,
    "Period: victorian": 3,
    "Period: Victorain": 1,
    "Genre: Poetry": 8,
    "Genre: Poetries": 2,
    "Author: Tennyson": 5,
  });
  const period = groups.find((g) => g.keep === "Period: Victorian");
  assert.ok(period, "the most-used spelling is the one kept");
  assert.deepEqual(period!.merge.sort(), ["Period: Victorain", "Period: victorian"]);

  const genre = groups.find((g) => g.keep === "Genre: Poetry");
  assert.deepEqual(genre!.merge, ["Genre: Poetries"]);

  assert.ok(
    !groups.some((g) => g.keep.startsWith("Author:")),
    "a tag with one spelling is never proposed for merging"
  );
});

test("different dimensions are never merged, however alike the values", () => {
  const groups = tagVariants({ "Period: Modern": 4, "Genre: Modern": 4 });
  assert.equal(groups.length, 0);
});

test("confirmed merges rewrite a question's tags", () => {
  const merged = applyTagMerges(["Period: victorian", "Genre: Poetry"], {
    "Period: victorian": "Period: Victorian",
  });
  assert.deepEqual(merged, ["Period: Victorian", "Genre: Poetry"]);
});

test("a case-only respelling can still be merged, so the tidy-up is not refused", () => {
  // These two already count as one bucket, so no number is wrong — but the
  // vocabulary shows both, and refusing the merge would leave the same
  // suggestion coming back for ever.
  const merged = applyTagMerges(["Period: victorian", "Genre: Poetry"], {
    "Period: victorian": "Period: Victorian",
  });
  assert.deepEqual(merged, ["Period: Victorian", "Genre: Poetry"]);
});

test("merging a spelling a question already carries leaves one tag, not two", () => {
  const merged = applyTagMerges(["Period: Victorian", "Period: victorian"], {
    "Period: victorian": "Period: Victorian",
  });
  assert.deepEqual(merged, ["Period: Victorian"]);
});

test("a preset flags unknown values but accepts anything under an open dimension", () => {
  const preset = findPreset("ugc-net-english")!;
  const stray = tagsOutsidePreset(
    ["Period: Victorian", "Period: Steampunk", "Author: Tennyson", "Genre: Poetry"],
    preset
  );
  assert.deepEqual(stray, ["Period: Steampunk"], "Author is open, so any name passes");
});
