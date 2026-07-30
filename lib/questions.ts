/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import type { Question } from "./types";

/**
 * Small predicates shared by the parsers, the grader, the student view and the
 * teacher's analytics, so "is this question scored?" is answered in one place.
 */

/** Questions saved before ungraded items existed have no flag and are graded. */
export function isGraded(qn: Pick<Question, "graded">): boolean {
  return qn.graded !== false;
}

/** A question the student answers by picking options rather than typing. */
export function isChoice(qn: Pick<Question, "type">): boolean {
  return qn.type === "mcq" || qn.type === "multi";
}

/** The option keys that count as correct, whichever field the question uses. */
export function correctKeysOf(qn: Pick<Question, "correct" | "correctKeys">): string[] {
  if (qn.correctKeys?.length) return qn.correctKeys;
  return qn.correct ? [qn.correct] : [];
}

/** "A,C" (or "a; c") → ["A","C"]. Tolerates every separator a teacher might type. */
export function splitKeys(answer?: string | null): string[] {
  if (!answer) return [];
  return [
    ...new Set(
      answer
        .split(/[,;|/\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    ),
  ];
}

/** Canonical stored form for a set of picked keys: de-duplicated and sorted. */
export function joinKeys(keys: string[]): string {
  return [...new Set(keys.map((k) => k.toUpperCase()))].sort().join(",");
}

/** Points that can actually be earned — ungraded questions contribute nothing. */
export function maxPoints(questions: Question[]): number {
  return questions.reduce((sum, qn) => sum + (isGraded(qn) ? qn.points : 0), 0);
}

/** True when no question in the quiz is scored, so there is no mark to show. */
export function isSurvey(questions: Question[]): boolean {
  return questions.length > 0 && questions.every((qn) => !isGraded(qn));
}
