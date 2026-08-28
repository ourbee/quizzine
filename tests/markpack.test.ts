/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildPackage, extractJson, parseAiReply, remainderPackage } from "../lib/markpack.ts";
import { DEFAULT_RUBRIC, effectiveWeights } from "../lib/rubric.ts";
import type { Question } from "../lib/types.ts";

const weights = effectiveWeights(DEFAULT_RUBRIC);

const question: Question = {
  id: "q1",
  type: "essay",
  text: "Discuss enjambment in the closing lines.",
  passage: "The poem's last stanza.",
  passageTitle: "The passage",
  options: [],
  points: 10,
  feedbackCorrect: "A strong answer names the device and reads the line break.",
  wordLimit: 200,
};

const responses = (n: number, words = 10) =>
  Array.from({ length: n }, (_, i) => ({
    attemptId: `a${i + 1}`,
    text: Array.from({ length: words }, (_, w) => `word${w}`).join(" "),
  }));

test("a package carries the rubric, the question, the model answer and the responses", () => {
  const pack = buildPackage(question, DEFAULT_RUBRIC, weights, responses(3));
  const text = pack.parts[0].text;
  assert.equal(pack.parts.length, 1);
  assert.match(text, /Discuss enjambment/);
  assert.match(text, /MODEL ANSWER/);
  assert.match(text, /The poem's last stanza/);
  assert.match(text, /WORD LIMIT: 200 words/);
  assert.match(text, /Correctness with respect to the question/);
  assert.deepEqual(pack.parts[0].codes, ["R1", "R2", "R3"]);
});

test("no name, roll or attempt id ever reaches a package", () => {
  const pack = buildPackage(question, DEFAULT_RUBRIC, weights, [
    { attemptId: "attempt-abc123", text: "An answer." },
  ]);
  assert.ok(!pack.parts[0].text.includes("attempt-abc123"));
  assert.deepEqual(pack.codeMap, { R1: "attempt-abc123" });
});

test("blank responses are left out and counted, never sent to be marked", () => {
  const pack = buildPackage(question, DEFAULT_RUBRIC, weights, [
    { attemptId: "a1", text: "An answer." },
    { attemptId: "a2", text: "   " },
  ]);
  assert.equal(pack.blank, 1);
  assert.deepEqual(pack.parts[0].codes, ["R1"]);
  assert.deepEqual(pack.codeMap, { R1: "a1" });
});

test("a question over the word budget splits into self-contained parts with running codes", () => {
  // 6 responses of 100 words against a 250-word budget: 2 per part.
  const pack = buildPackage(question, DEFAULT_RUBRIC, weights, responses(6, 100), 250);
  assert.equal(pack.parts.length, 3);
  assert.deepEqual(
    pack.parts.map((p) => p.codes),
    [["R1", "R2"], ["R3", "R4"], ["R5", "R6"]]
  );
  for (const part of pack.parts) {
    // Each part stands alone in a fresh chat: rubric, question, model answer.
    assert.match(part.text, /THE RUBRIC:/);
    assert.match(part.text, /Discuss enjambment/);
    assert.match(part.text, /MODEL ANSWER/);
    assert.match(part.text, /FRESH CHAT/);
  }
});

test("one response longer than the whole budget still travels rather than being cut", () => {
  const pack = buildPackage(question, DEFAULT_RUBRIC, weights, responses(1, 500), 100);
  assert.equal(pack.parts.length, 1);
  assert.deepEqual(pack.parts[0].codes, ["R1"]);
});

test("a reply is read out of surrounding prose and code fences", () => {
  const reply = `Certainly! Here are the marks:

\`\`\`json
[{"code":"R1","scores":{"a1":15,"a2":12},"strengths":"Clear","improvements":"More evidence","corrections":"","oneThing":"Quote."}]
\`\`\`

Let me know if you would like these adjusted.`;
  const result = parseAiReply(reply, ["R1", "R2"], weights);
  assert.equal(result.error, undefined);
  assert.equal(result.marks.length, 1);
  assert.equal(result.marks[0].params.a1, 15);
  assert.deepEqual(result.unmarked, ["R2"]);
});

test("a code the package never issued is refused, never assigned to the nearest student", () => {
  const reply = '[{"code":"R9","scores":{"a1":10}},{"code":"R1","scores":{"a1":10}}]';
  const result = parseAiReply(reply, ["R1", "R2"], weights);
  assert.deepEqual(result.marks.map((m) => m.code), ["R1"]);
  assert.equal(result.rejected[0].code, "R9");
  assert.match(result.rejected[0].reason, /not a code in this package/);
  assert.deepEqual(result.unmarked, ["R2"]);
});

test("a score above a parameter's weight is capped and flagged rather than trusted", () => {
  const result = parseAiReply('[{"code":"R1","scores":{"a1":99,"a2":10}}]', ["R1"], weights);
  assert.equal(result.marks[0].params.a1, 15); // a1's weight
  assert.deepEqual(result.marks[0].clamped, ["a1"]);
});

test("a duplicated code keeps the first mark and says so", () => {
  const reply = '[{"code":"R1","scores":{"a1":10}},{"code":"R1","scores":{"a1":2}}]';
  const result = parseAiReply(reply, ["R1"], weights);
  assert.equal(result.marks.length, 1);
  assert.equal(result.marks[0].params.a1, 10);
  assert.match(result.rejected[0].reason, /twice/);
});

test("an entry whose keys match no parameter is rejected instead of scoring zero", () => {
  const result = parseAiReply('[{"code":"R1","scores":{"nonsense":5}}]', ["R1"], weights);
  assert.equal(result.marks.length, 0);
  assert.match(result.rejected[0].reason, /none of the parameter keys/);
  assert.deepEqual(result.unmarked, ["R1"]);
});

test("a reply with no JSON at all fails whole rather than half-applying", () => {
  const result = parseAiReply("I am afraid I cannot mark these for you.", ["R1", "R2"], weights);
  assert.ok(result.error);
  assert.equal(result.marks.length, 0);
  assert.deepEqual(result.unmarked, ["R1", "R2"]);
});

test("a truncated reply is readable up to the point it stopped", () => {
  // The array never closes, but the object before it does.
  const reply = '[{"code":"R1","scores":{"a1":10}}, {"code":"R2", "scores": {"a1"';
  const result = parseAiReply(reply, ["R1", "R2"], weights);
  assert.deepEqual(result.marks.map((m) => m.code), ["R1"]);
  assert.deepEqual(result.unmarked, ["R2"]);
});

test("an object keyed by code is understood as well as an array", () => {
  const result = parseAiReply('{"R1": {"scores": {"a1": 10}}}', ["R1"], weights);
  assert.equal(result.marks.length, 1);
});

test("a bracket inside a string cannot end the JSON early", () => {
  const reply = '[{"code":"R1","scores":{"a1":10},"strengths":"Uses ] and [ well"}]';
  const parsed = extractJson(reply) as unknown[];
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed.length, 1);
});

test("the remainder package holds only the unmarked responses, under their original codes", () => {
  const all = responses(4);
  const pack = buildPackage(question, DEFAULT_RUBRIC, weights, all);
  const remainder = remainderPackage(question, DEFAULT_RUBRIC, weights, all, pack.codeMap, ["R2", "R4"]);

  assert.deepEqual(remainder.parts[0].codes, ["R2", "R4"]);
  // The codes still point at the same students they did in the first package.
  assert.equal(remainder.codeMap.R2, pack.codeMap.R2);
  assert.equal(remainder.codeMap.R4, pack.codeMap.R4);
  assert.match(remainder.parts[0].text, /R2/);
  assert.ok(!/\bR1\b/.test(remainder.parts[0].text));
});
