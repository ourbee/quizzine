/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { seededShuffle } from "./normalize.ts";
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

/** Anything carrying a passage: the stored question, or the sanitized public one. */
type PassageOwner = { passage?: string; passageTitle?: string };

export interface PassageGroup<T> {
  /** Material to show once above these questions; absent when they have none. */
  passage?: string;
  passageTitle?: string;
  questions: T[];
  /** Position of the first question in the original list, so numbering survives. */
  start: number;
}

/**
 * Fold a run of consecutive questions that share the same passage into one
 * group, so a poem or a sample response is shown once above the questions on
 * it rather than repeated over each. A teacher writes that run by filling the
 * same Passage cell down several rows — which is also why the comparison is on
 * the trimmed text: spreadsheets are careless with trailing spaces.
 *
 * Questions with no passage are grouped too (with no material), which keeps the
 * caller to a single loop.
 */
export function groupByPassage<T extends PassageOwner>(questions: T[]): PassageGroup<T>[] {
  const groups: PassageGroup<T>[] = [];
  questions.forEach((qn, i) => {
    const passage = qn.passage?.trim() || undefined;
    const passageTitle = qn.passageTitle?.trim() || undefined;
    const last = groups[groups.length - 1];
    if (last && last.passage === passage && last.passageTitle === passageTitle) last.questions.push(qn);
    else groups.push({ passage, passageTitle, questions: [qn], start: i });
  });
  return groups;
}

/**
 * Shuffle questions without stranding one from the material it belongs to: a
 * run sharing a passage moves as a single unit (its questions shuffled among
 * themselves), while questions with no material shuffle freely as before. A
 * quiz without passages is therefore shuffled exactly as it always was.
 */
export function shuffleWithinPassageGroups<T extends PassageOwner>(questions: T[], seed: number): T[] {
  const units: T[][] = [];
  for (const group of groupByPassage(questions)) {
    if (group.passage) units.push(group.questions);
    else for (const qn of group.questions) units.push([qn]);
  }
  return seededShuffle(units, seed).flatMap((unit, i) => (unit.length > 1 ? seededShuffle(unit, seed + i + 1) : unit));
}
