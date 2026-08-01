/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import test from "node:test";
import assert from "node:assert/strict";
import { shareDescription, shareFacts, type ShareQuiz } from "../lib/share.ts";

const quiz = (over: Partial<ShareQuiz> = {}): ShareQuiz => ({
  title: "Unit 1 — Romantic poetry",
  theme: "slate",
  questionCount: 12,
  totalPoints: 24,
  survey: false,
  peerReview: false,
  groupMode: false,
  settings: { shuffleQuestions: true, shuffleOptions: true, timerMode: "none", allowMultiple: false },
  phase: "responding",
  open: true,
  ...over,
});

test("a plain quiz is described by its size and its marks", () => {
  assert.deepEqual(shareFacts(quiz()), ["12 questions", "24 marks"]);
  assert.equal(
    shareDescription(quiz()),
    "12 questions · 24 marks. Open the link to take it on any device. No account needed.",
  );
});

test("one question is not one questions", () => {
  assert.deepEqual(shareFacts(quiz({ questionCount: 1, totalPoints: 5 })), ["1 question", "5 marks"]);
});

test("a timer is worth announcing, in whichever form it takes", () => {
  const whole = quiz({ settings: { ...quiz().settings, timerMode: "quiz", maxMinutes: 30 } });
  assert.deepEqual(shareFacts(whole), ["12 questions", "30 minutes", "24 marks"]);
  const each = quiz({ settings: { ...quiz().settings, timerMode: "question", perQuestionSeconds: 45 } });
  assert.deepEqual(shareFacts(each), ["12 questions", "45s per question", "24 marks"]);
});

test("an unscored quiz says survey rather than a mark total", () => {
  const facts = shareFacts(quiz({ survey: true, totalPoints: 0 }));
  assert.deepEqual(facts, ["12 questions", "survey"]);
  assert.match(shareDescription(quiz({ survey: true, totalPoints: 0 })), /collected, not marked/);
});

test("group work and peer review are announced on the card", () => {
  assert.deepEqual(shareFacts(quiz({ groupMode: true, peerReview: true })), [
    "12 questions",
    "24 marks",
    "group work",
    "peer reviewed",
  ]);
});

test("a closed quiz says so instead of inviting an attempt", () => {
  assert.match(shareDescription(quiz({ open: false, phase: "closed" })), /This quiz is closed\./);
  assert.match(shareDescription(quiz({ open: false, phase: "reviewing" })), /Now in peer review\./);
});

test("the teacher's own description wins over the generated one", () => {
  assert.equal(
    shareDescription(quiz({ description: "Bring your annotated copy of the poem." })),
    "Bring your annotated copy of the poem.",
  );
});
