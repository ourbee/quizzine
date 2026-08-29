/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildPackage,
  buildQuestionPackage,
  extractJson,
  parseAiReply,
  remainderPackage,
} from "../lib/markpack.ts";
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
  const pack = buildQuestionPackage(question, DEFAULT_RUBRIC, weights, responses(3));
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
  const pack = buildQuestionPackage(question, DEFAULT_RUBRIC, weights, [
    { attemptId: "attempt-abc123", text: "An answer." },
  ]);
  assert.ok(!pack.parts[0].text.includes("attempt-abc123"));
  assert.deepEqual(pack.codeMap, { R1: { attemptId: "attempt-abc123", qid: "q1" } });
});

test("blank responses are left out and counted, never sent to be marked", () => {
  const pack = buildQuestionPackage(question, DEFAULT_RUBRIC, weights, [
    { attemptId: "a1", text: "An answer." },
    { attemptId: "a2", text: "   " },
  ]);
  assert.equal(pack.blank, 1);
  assert.deepEqual(pack.parts[0].codes, ["R1"]);
  assert.deepEqual(pack.codeMap, { R1: { attemptId: "a1", qid: "q1" } });
});

test("a question over the word budget splits into self-contained parts with running codes", () => {
  // 6 responses of 100 words against a 250-word budget: 2 per part.
  const pack = buildQuestionPackage(question, DEFAULT_RUBRIC, weights, responses(6, 100), 250);
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
  const pack = buildQuestionPackage(question, DEFAULT_RUBRIC, weights, responses(1, 500), 100);
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
  const pack = buildQuestionPackage(question, DEFAULT_RUBRIC, weights, all);
  const remainder = remainderPackage(
    {
      scope: "question",
      rubric: DEFAULT_RUBRIC,
      questions: [{ question, weights }],
      attempts: all.map((r) => ({ attemptId: r.attemptId })),
      answer: (attemptId) => all.find((r) => r.attemptId === attemptId)?.text ?? "",
    },
    ["R2", "R4"]
  );

  assert.deepEqual(remainder.parts[0].codes, ["R2", "R4"]);
  // The codes still point at the same students they did in the first package.
  assert.deepEqual(remainder.codeMap.R2, pack.codeMap.R2);
  assert.deepEqual(remainder.codeMap.R4, pack.codeMap.R4);
  assert.match(remainder.parts[0].text, /R2/);
  assert.ok(!/\bR1\b/.test(remainder.parts[0].text));
});

test("unescaped quotes inside a value are repaired rather than rejected", () => {
  // What a marker discussing words actually writes, and what no JSON parser
  // will accept: the student is being quoted back inside a quoted string.
  const reply =
    '[{"code":"R1","scores":{"a1":10},"strengths":"Good.","improvements":"More.",' +
    '"corrections":""greek" should be capitalized as "Greek"; "though off" should be "thought of".",' +
    '"oneThing":"Define, then explain."}]';
  const parsed = extractJson(reply) as { corrections: string }[];
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed.length, 1);
  // The quotation marks survive into the feedback the student reads.
  assert.match(parsed[0].corrections, /"greek" should be capitalized as "Greek"/);
});

test("a repaired reply still marks, and still refuses a code it never issued", () => {
  const reply = '[{"code":"R1","scores":{"a1":10},"corrections":"say "this" not "that"."},{"code":"R9","scores":{"a1":1}}]';
  const result = parseAiReply(reply, ["R1"], { a1: 10 });
  assert.equal(result.marks.length, 1);
  assert.equal(result.marks[0].code, "R1");
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].code, "R9");
});

test("valid JSON is never put through the repair", () => {
  // A value that legitimately ends on a quoted word: the repair would mangle
  // it, so a strict parse has to win first.
  const reply = '[{"code":"R1","scores":{"a1":5},"oneThing":"Read the chapter called \\"Xenia\\""}]';
  const parsed = extractJson(reply) as { oneThing: string }[];
  assert.equal(parsed[0].oneThing, 'Read the chapter called "Xenia"');
});

test("a reply that will not parse says so, rather than claiming there was no JSON", () => {
  const result = parseAiReply('[{"code":"R1","scores":{"a1":', ["R1"], { a1: 10 });
  assert.match(result.error ?? "", /could not be read/);
  assert.deepEqual(result.unmarked, ["R1"]);
});

// ---------- packages that span more than one question ----------

const q2: Question = {
  id: "q2",
  type: "short",
  text: "Define caesura in one sentence.",
  options: [],
  points: 5,
  feedbackCorrect: "A pause within a line.",
};

const twoQuestions = [
  { question, weights },
  { question: q2, weights },
];

/** Three attempts, both questions answered by each. */
const grid = (n: number, words = 10) => {
  const attempts = Array.from({ length: n }, (_, i) => ({ attemptId: `a${i + 1}` }));
  const answer = (attemptId: string, qid: string) =>
    `${attemptId} ${qid} ` + Array.from({ length: words }, (_, w) => `word${w}`).join(" ");
  return { attempts, answer };
};

test("a student package covers every question that student answered, under R1Q1…R1Qn codes", () => {
  const { answer } = grid(1);
  const pack = buildPackage({
    scope: "student",
    rubric: DEFAULT_RUBRIC,
    questions: twoQuestions,
    attempts: [{ attemptId: "a1" }],
    answer,
  });
  assert.deepEqual(pack.parts[0].codes, ["R1Q1", "R1Q2"]);
  assert.deepEqual(pack.codeMap.R1Q1, { attemptId: "a1", qid: "q1" });
  assert.deepEqual(pack.codeMap.R1Q2, { attemptId: "a1", qid: "q2" });
  // Both questions travel whole, each with its own model answer.
  assert.match(pack.parts[0].text, /Discuss enjambment/);
  assert.match(pack.parts[0].text, /Define caesura/);
  assert.match(pack.parts[0].text, /A pause within a line/);
  // And the code rule is stated, because R1 alone would now be ambiguous.
  assert.match(pack.parts[0].text, /R3Q2/);
});

test("a batch package runs question-major, so one question's answers stay together", () => {
  const { attempts, answer } = grid(3);
  const pack = buildPackage({
    scope: "batch",
    rubric: DEFAULT_RUBRIC,
    questions: twoQuestions,
    attempts,
    answer,
  });
  assert.deepEqual(pack.parts[0].codes, ["R1Q1", "R2Q1", "R3Q1", "R1Q2", "R2Q2", "R3Q2"]);
  assert.equal(Object.keys(pack.codeMap).length, 6);
  assert.deepEqual(pack.codeMap.R3Q2, { attemptId: "a3", qid: "q2" });
});

test("a code carries the question, so one student's two answers can never be confused", () => {
  const { attempts, answer } = grid(2);
  const pack = buildPackage({ scope: "batch", rubric: DEFAULT_RUBRIC, questions: twoQuestions, attempts, answer });
  const result = parseAiReply(
    '[{"code":"R2Q1","scores":{"a1":10}},{"code":"R2Q2","scores":{"a1":3}}]',
    pack.parts[0].codes,
    pack.codeWeights
  );
  assert.equal(result.marks.length, 2);
  assert.deepEqual(pack.codeMap[result.marks[0].code], { attemptId: "a2", qid: "q1" });
  assert.deepEqual(pack.codeMap[result.marks[1].code], { attemptId: "a2", qid: "q2" });
});

test("a bare response number in a multi-question reply is refused, and says why", () => {
  const { attempts, answer } = grid(2);
  const pack = buildPackage({ scope: "batch", rubric: DEFAULT_RUBRIC, questions: twoQuestions, attempts, answer });
  const result = parseAiReply('[{"code":"R2","scores":{"a1":10}}]', pack.parts[0].codes, pack.codeWeights);
  assert.equal(result.marks.length, 0);
  assert.equal(result.rejected[0].code, "R2");
  assert.match(result.rejected[0].reason, /no question on it/);
});

test("per-question weight overrides are stated on the question and used when the reply comes back", () => {
  const light = { ...weights, a1: 5 };
  const { attempts, answer } = grid(1);
  const pack = buildPackage({
    scope: "batch",
    rubric: DEFAULT_RUBRIC,
    questions: [{ question, weights }, { question: q2, weights: light }],
    attempts,
    answer,
  });
  assert.match(pack.parts[0].text, /MAXIMUMS FOR THIS QUESTION/);
  const result = parseAiReply(
    '[{"code":"R1Q1","scores":{"a1":12}},{"code":"R1Q2","scores":{"a1":12}}]',
    pack.parts[0].codes,
    pack.codeWeights
  );
  // Q1 allows 15, so 12 stands; Q2 allows only 5, so it is capped and flagged.
  assert.equal(result.marks[0].params.a1, 12);
  assert.equal(result.marks[1].params.a1, 5);
  assert.deepEqual(result.marks[1].clamped, ["a1"]);
});

test("a batch over the word budget splits into parts that each carry their own questions", () => {
  const { attempts, answer } = grid(4, 100);
  const pack = buildPackage({
    scope: "batch",
    rubric: DEFAULT_RUBRIC,
    questions: twoQuestions,
    attempts,
    answer,
    wordBudget: 250,
  });
  assert.ok(pack.parts.length > 1);
  for (const part of pack.parts) {
    assert.match(part.text, /THE RUBRIC:/);
    assert.match(part.text, /Return ONLY a JSON array/);
    // Only the questions this part actually asks about are described in it.
    const asksQ1 = part.codes.some((c) => c.endsWith("Q1"));
    assert.equal(/Discuss enjambment/.test(part.text), asksQ1);
  }
  // Every code appears exactly once across the parts.
  const all = pack.parts.flatMap((p) => p.codes);
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, 8);
});

test("a blank answer is left out of a batch without shifting anyone else's code", () => {
  const pack = buildPackage({
    scope: "batch",
    rubric: DEFAULT_RUBRIC,
    questions: twoQuestions,
    attempts: [{ attemptId: "a1" }, { attemptId: "a2" }],
    answer: (attemptId, qid) => (attemptId === "a1" && qid === "q2" ? "   " : "An answer."),
  });
  assert.equal(pack.blank, 1);
  assert.deepEqual(pack.parts[0].codes, ["R1Q1", "R2Q1", "R2Q2"]);
  // R2Q2 is still R2Q2 — a gap never renumbers what follows it.
  assert.deepEqual(pack.codeMap.R2Q2, { attemptId: "a2", qid: "q2" });
});

test("a remainder of a batch keeps its codes and drops everything already marked", () => {
  const { attempts, answer } = grid(3);
  const input = { scope: "batch" as const, rubric: DEFAULT_RUBRIC, questions: twoQuestions, attempts, answer };
  const pack = buildPackage(input);
  const remainder = remainderPackage(input, ["R2Q1", "R3Q2"]);
  assert.deepEqual(remainder.parts[0].codes, ["R2Q1", "R3Q2"]);
  assert.deepEqual(remainder.codeMap.R2Q1, pack.codeMap.R2Q1);
  assert.deepEqual(remainder.codeMap.R3Q2, pack.codeMap.R3Q2);
  assert.ok(!remainder.parts[0].text.includes("R1Q1"));
});

test("a single-question package keeps plain R codes, whatever scope asked for it", () => {
  const pack = buildPackage({
    scope: "student",
    rubric: DEFAULT_RUBRIC,
    questions: [{ question, weights }],
    attempts: [{ attemptId: "a1" }],
    answer: () => "An answer.",
  });
  assert.deepEqual(pack.parts[0].codes, ["R1"]);
  assert.equal(pack.qid, "q1");
});
