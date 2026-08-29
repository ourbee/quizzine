/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { q } from "./db.ts";
import { grade } from "./grade.ts";
import { applyMarking, markingStatus, normalizeMarking, unmarkedCount, type MarkingRecord } from "./marking.ts";
import type { GroupInfo, PerQuestionResult, Question, QuizSettings, StudentInfo } from "./types";

/**
 * The database side of rubric marking.
 *
 * Marking is stored on the attempt as percentages per reviewer; the marks are
 * derived from them here and written back onto `per_question`, `score` and
 * `max_score`, so every existing surface — the responses table, the Excel
 * export, the cross-quiz reports, the bands, the analytics — reads a
 * rubric-marked question exactly like an auto-marked one, without knowing
 * anything about rubrics.
 *
 * Nothing here releases anything. The recomputation is safe to run on every
 * save because a student in a rubric-marked quiz is not shown their marks until
 * the teacher flips the phase — see the route.
 */

export interface MarkAttemptRow {
  id: string;
  student: StudentInfo;
  group_info: GroupInfo | null;
  answers: Record<string, string> | null;
  per_question: PerQuestionResult[] | null;
  marking: MarkingRecord | null;
  telemetry: Record<string, unknown> | null;
  flags: Record<string, unknown> | null;
  score: number | null;
  max_score: number | null;
  teacher_score: number | null;
  submitted_at: string;
  /** Allotted tests: the questions this student was dealt. Null for every other quiz. */
  allotted: string[] | null;
}

export const listMarkableAttempts = (quizId: string) =>
  q<MarkAttemptRow>(
    `SELECT id, student, group_info, answers, per_question, marking, telemetry, flags,
            score, max_score, teacher_score, submitted_at, allotted
       FROM attempts WHERE quiz_id = $1 AND status = 'submitted' ORDER BY submitted_at ASC`,
    [quizId]
  );

/**
 * Re-derive one attempt's marks from its answers and its marking. The answers
 * are never touched — only what is derived from them — so this is repeatable
 * and always reflects the quiz and the marking as they stand now.
 */
export async function recomputeAttempt(
  attempt: Pick<MarkAttemptRow, "id" | "answers" | "per_question" | "marking">,
  questions: Question[],
  settings: QuizSettings
): Promise<{ score: number; max: number; pending: number }> {
  // Rebuilding from `grade` rather than patching the stored rows keeps one
  // definition of what an unmarked question looks like, and repairs a row that
  // predates a question being added.
  const base = attempt.per_question?.length
    ? attempt.per_question
    : grade(questions, attempt.answers ?? {}, settings.multiScoring ?? "exact").per;
  const marking = normalizeMarking(attempt.marking);
  const { per, score, max, pending } = applyMarking(questions, base, attempt.answers, marking);
  await q(`UPDATE attempts SET per_question = $1, score = $2, max_score = $3 WHERE id = $4`, [
    JSON.stringify(per),
    score,
    max,
    attempt.id,
  ]);
  return { score, max, pending };
}

/** Re-derive every attempt on a quiz — what a released quiz runs on release. */
export async function recomputeQuiz(quizId: string, questions: Question[], settings: QuizSettings): Promise<number> {
  const attempts = await listMarkableAttempts(quizId);
  for (const attempt of attempts) await recomputeAttempt(attempt, questions, settings);
  return attempts.length;
}

export interface MarkingProgress {
  attempts: number;
  /** Written answers that still have no reviewer's mark. */
  unmarked: number;
  /** Attempts with nothing left outstanding. */
  complete: number;
}

/**
 * How much marking is left. Blank answers count as done — a student who wrote
 * nothing is not waiting on anybody, and releasing with unmarked blanks is the
 * normal case rather than an oversight.
 */
export function markingProgress(questions: Question[], attempts: MarkAttemptRow[]): MarkingProgress {
  let unmarked = 0;
  let complete = 0;
  for (const a of attempts) {
    const status = markingStatus(questions, a.answers, normalizeMarking(a.marking));
    const left = unmarkedCount(status);
    unmarked += left;
    if (!left) complete += 1;
  }
  return { attempts: attempts.length, unmarked, complete };
}
