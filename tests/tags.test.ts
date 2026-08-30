/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_DIMENSION,
  applyTagMerges,
  buildVocabulary,
  canonicalizeBatch,
  countTags,
  preferredSpellings,
  presetTags,
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

// ---------- one spelling per bucket ----------

test("the majority spelling wins a bucket, whatever order it is offered in", () => {
  const counts = { "Unit 7 Cultural studies": 10, "Unit 7 Cultural Studies": 8 };
  assert.deepEqual(preferredSpellings(counts), ["Unit 7 Cultural studies"]);
  assert.deepEqual(preferredSpellings({ ...counts, "Unit 7 Cultural Studies": 12 }), [
    "Unit 7 Cultural Studies",
  ]);
});

test("a tie is broken alphabetically, so the answer never depends on iteration order", () => {
  assert.deepEqual(preferredSpellings({ "Genre: poetry": 4, "Genre: Poetry": 4 }), ["Genre: Poetry"]);
});

test("rival spellings never both enter a vocabulary", () => {
  const vocab = buildVocabulary(["Author: I. A. Richards", "Author: I.A. Richards"]);
  assert.deepEqual(vocab.tags, ["Author: I. A. Richards"], "the first offered owns the bucket");
  assert.equal(vocab.byLoose.size, 1);
});

test("counting is by stored spelling, and only whitespace is tidied first", () => {
  assert.deepEqual(countTags(["Period: Victorian", "Period:  Victorian ", "Period: victorian"]), {
    "Period: Victorian": 2,
    "Period: victorian": 1,
  });
});

// ---------- a file made to agree with itself ----------

test("a first upload carrying both spellings founds one bucket, not two", () => {
  // Nothing was in use before, so nothing can be adopted from the teacher —
  // the majority within the file decides, and the file agrees with itself.
  const lists = [
    ["Unit 7 Cultural studies"],
    ["Unit 7 Cultural Studies"],
    ["Unit 7 Cultural studies"],
    ["Unit 7 CULTURAL STUDIES"],
  ];
  const out = canonicalizeBatch(lists, buildVocabulary([]));
  assert.deepEqual(new Set(out.flat()), new Set(["Unit 7 Cultural studies"]));
});

test("the majority in a file does not depend on which question comes first", () => {
  const minorityFirst = canonicalizeBatch(
    [["Genre: Poetries"], ["Genre: Poetry"], ["Genre: Poetry"]],
    buildVocabulary([])
  );
  assert.deepEqual(minorityFirst.flat(), ["Genre: Poetry", "Genre: Poetry", "Genre: Poetry"]);
});

test("what the teacher already writes outranks the file's own majority", () => {
  const out = canonicalizeBatch(
    [["Period: victorian"], ["Period: victorian"], ["Period: victorian"]],
    buildVocabulary(["Period: Victorian"])
  );
  assert.deepEqual(out.flat(), ["Period: Victorian", "Period: Victorian", "Period: Victorian"]);
});

test("a preset fills the buckets a teacher has never used, and no others", () => {
  const preset = findPreset("ugc-net-english")!;
  // Established usage first, preset second — the order the routes use.
  const vocab = buildVocabulary(["Unit: Unit 8 Literary Criticism", ...presetTags(preset)]);
  assert.deepEqual(
    canonicalizeTagsVia(vocab, "Unit: Unit 8 Literary criticism"),
    "Unit: Unit 8 Literary Criticism",
    "a habit used two hundred times is not rewritten to match a list"
  );
  assert.deepEqual(
    canonicalizeTagsVia(vocab, "Period: romantic"),
    "Period: Romantic",
    "a bucket the teacher has never used takes the preset's spelling"
  );
});

function canonicalizeTagsVia(vocab: ReturnType<typeof buildVocabulary>, tag: string): string {
  return canonicalizeBatch([[tag]], vocab)[0][0];
}

// ---------- mechanical versus judgement ----------

test("case, spacing and punctuation groups are mechanical; a near miss is not", () => {
  const groups = tagVariants({
    "Unit 7 Cultural studies": 10,
    "Unit 7 Cultural Studies": 8,
    "Author: I. A. Richards": 13,
    "Author: I.A. Richards": 2,
    "Author: Edward Said": 5,
    "Author: Edward W. Said": 2,
  });
  const byKeep = Object.fromEntries(groups.map((g) => [g.keep, g]));
  assert.equal(byKeep["Unit 7 Cultural studies"].mechanical, true);
  assert.equal(byKeep["Author: I. A. Richards"].mechanical, true);
  assert.equal(
    byKeep["Author: Edward Said"].mechanical,
    false,
    "a missing middle initial is a judgement, and must keep asking"
  );
});
