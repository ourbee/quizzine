/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { countWords, truncateToWords, wordState } from "../lib/words.ts";
import { TelemetryCollector, largestJump, normalizeTelemetry, telemetryBadges } from "../lib/telemetry.ts";
import { buildVocabulary, canonicalizeTags, tagNearMisses } from "../lib/tags.ts";
import { validateQuestions } from "../lib/validate.ts";
import type { RawQuestion } from "../lib/types.ts";

// ---------- words ----------

test("word counting matches what a teacher setting a limit means by it", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   "), 0);
  assert.equal(countWords("one two three"), 3);
  assert.equal(countWords("well-known compound"), 2); // a hyphen does not split
  assert.equal(countWords("a word — another word"), 4); // an em dash is not a word
  assert.equal(countWords("1967 was the year"), 4);
  assert.equal(countWords("...  ???"), 0); // punctuation alone is not a word
});

test("the counter warns before it accuses", () => {
  assert.equal(wordState(50, undefined), "none");
  assert.equal(wordState(50, 200), "under");
  assert.equal(wordState(185, 200), "near");
  assert.equal(wordState(201, 200), "over");
});

test("a hard limit trims on a word boundary and keeps the spacing", () => {
  assert.equal(truncateToWords("one two three four", 2), "one two");
  assert.equal(truncateToWords("one two", 5), "one two");
});

// ---------- telemetry ----------

test("telemetry counts pastes and characters, never a word of what was pasted", () => {
  const t = new TelemetryCollector();
  t.paste("q1", "a stolen paragraph".length);
  t.typed("q1", 40);
  const snap = t.snapshot({ q1: 40 });
  assert.equal(snap.q1.pasteCount, 1);
  assert.equal(snap.q1.pasteChars, 18);
  assert.equal(JSON.stringify(snap).includes("stolen"), false);
});

test("a badge states the fact; only a large paste is worth a second look", () => {
  const small = telemetryBadges({ pasteCount: 1, pasteChars: 40, blurCount: 0, activeSeconds: 0, growth: [] }, 900);
  assert.equal(small[0].tone, "plain");
  const large = telemetryBadges({ pasteCount: 1, pasteChars: 1400, blurCount: 0, activeSeconds: 0, growth: [] }, 1500);
  assert.equal(large[0].tone, "notable");
});

test("the growth curve shows a single jump for what it is", () => {
  const grown = largestJump({
    pasteCount: 0,
    pasteChars: 0,
    blurCount: 0,
    activeSeconds: 0,
    growth: [
      [0, 0],
      [30, 1400],
      [60, 1450],
    ],
  });
  assert.equal(grown.chars, 1400);
  assert.equal(grown.share, 0.97);
});

test("stored telemetry is coerced, and its curve is capped", () => {
  const t = normalizeTelemetry({ q1: { pasteCount: "3", growth: [[1, 2], "junk", [3, 4]] }, q2: null });
  assert.deepEqual(Object.keys(t), ["q1"]);
  assert.equal(t.q1.pasteCount, 3);
  assert.deepEqual(t.q1.growth, [
    [1, 2],
    [3, 4],
  ]);
});

// ---------- tag hygiene ----------

const vocab = buildVocabulary([
  "Unit: Unit 7 Cultural studies",
  "Unit: Unit 9 Literary Theory (Post World War II)",
  "Period: Victorian",
]);

test("a case or spacing variant is stored in the spelling already in use", () => {
  assert.deepEqual(canonicalizeTags(["Unit: Unit 7   Cultural Studies"], vocab), ["Unit: Unit 7 Cultural studies"]);
  assert.deepEqual(canonicalizeTags(["Period: victorian"], vocab), ["Period: Victorian"]);
});

test("a genuinely new tag is left exactly as written", () => {
  assert.deepEqual(canonicalizeTags(["Genre: Poetry"], vocab), ["Genre: Poetry"]);
});

test("a punctuation-only rewording is adopted, not asked about", () => {
  // Same words either way; the brackets are not a judgement, and a queue that
  // asks about them is a queue that stops being read.
  assert.deepEqual(canonicalizeTags(["Unit: Unit 9 Literary theory post World War II"], vocab), [
    "Unit: Unit 9 Literary Theory (Post World War II)",
  ]);
  assert.deepEqual(tagNearMisses(["Unit: Unit 9 Literary theory post World War II"], vocab), []);
});

test("spaced and unspaced initials are one author", () => {
  const authors = buildVocabulary(["Author: I. A. Richards"]);
  assert.deepEqual(canonicalizeTags(["Author: I.A. Richards"], authors), ["Author: I. A. Richards"]);
  assert.deepEqual(tagNearMisses(["Author: I.A. Richards"], authors), []);
});

test("a middle initial is a different name, and is left for the teacher to judge", () => {
  const authors = buildVocabulary(["Author: Edward Said"]);
  assert.deepEqual(canonicalizeTags(["Author: Edward W. Said"], authors), ["Author: Edward W. Said"]);
  assert.deepEqual(tagNearMisses(["Author: Edward W. Said"], authors), [
    { incoming: "Author: Edward W. Said", existing: "Author: Edward Said" },
  ]);
});

test("a tag that canonicalisation already handles is not also asked about", () => {
  assert.deepEqual(tagNearMisses(["Period: victorian"], vocab), []);
});

test("a single typo is caught as a near miss", () => {
  assert.deepEqual(tagNearMisses(["Period: Victorain"], vocab), [
    { incoming: "Period: Victorain", existing: "Period: Victorian" },
  ]);
});

// ---------- validation ----------

const raw = (over: Partial<RawQuestion> = {}): RawQuestion => ({
  text: "Discuss enjambment.",
  type: "essay",
  options: [],
  points: 10,
  ...over,
});

test("a rubric-marked quiz keeps its points — it is scored, unlike a survey or a peer round", () => {
  const rubric = validateQuestions({ questions: [raw()] }, "rubric");
  assert.deepEqual(rubric.errors, []);
  assert.equal(rubric.questions[0].points, 10);
  assert.equal(rubric.questions[0].graded, undefined); // i.e. scored

  const peer = validateQuestions({ questions: [raw()] }, "peer");
  assert.equal(peer.questions[0].points, 0);
  assert.equal(peer.questions[0].graded, false);
});

test("WordLimit and ModelAnswer reach the stored question", () => {
  const result = validateQuestions(
    { questions: [raw({ wordLimit: "250", feedbackCorrect: "A strong answer names the device." })] },
    "rubric"
  );
  assert.equal(result.questions[0].wordLimit, 250);
  assert.equal(result.questions[0].feedbackCorrect, "A strong answer names the device.");
});

test("a word limit on a choice question is ignored with a warning, not an error", () => {
  const result = validateQuestions(
    {
      questions: [
        {
          text: "Pick one.",
          type: "mcq",
          options: [
            { key: "A", text: "right" },
            { key: "B", text: "wrong" },
          ],
          correct: "A",
          wordLimit: "50",
        },
      ],
    },
    "graded"
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.questions[0].wordLimit, undefined);
  assert.ok(result.warnings.some((w) => /WordLimit is ignored/.test(w)));
});

test("rubric mode with no written answers says so rather than failing", () => {
  const result = validateQuestions(
    {
      questions: [
        {
          text: "Pick one.",
          type: "mcq",
          options: [
            { key: "A", text: "right" },
            { key: "B", text: "wrong" },
          ],
          correct: "A",
        },
      ],
    },
    "rubric"
  );
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((w) => /has none/.test(w)));
});
