/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { grade } from "@/lib/grade";
import type { AttemptFlags, GroupInfo, PerQuestionResult, Question, QuizSettings, ReviewPayload, StudentInfo } from "@/lib/types";

const GRACE_MS = 45_000; // network/clock grace before a submission is flagged late

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.attemptId) return NextResponse.json({ error: "Missing attempt id." }, { status: 400 });

  const attempts = await q<{
    id: string;
    quiz_id: string;
    student: StudentInfo;
    group_info: GroupInfo | null;
    status: string;
    started_at: string;
    submitted_at: string | null;
    per_question: PerQuestionResult[] | null;
    score: number | null;
    max_score: number | null;
    flags: AttemptFlags;
  }>(`SELECT * FROM attempts WHERE id = $1`, [body.attemptId]);
  if (!attempts.length) return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
  const attempt = attempts[0];

  const quizzes = await q<{ title: string; theme: string; questions: Question[]; settings: QuizSettings }>(
    `SELECT title, theme, questions, settings FROM quizzes WHERE id = $1`,
    [attempt.quiz_id]
  );
  if (!quizzes.length) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
  const quiz = quizzes[0];
  const questions = quiz.questions as Question[];

  // Idempotent: a second submit (double-click, refresh) returns the stored result.
  if (attempt.status === "submitted" && attempt.per_question) {
    const pending = attempt.per_question.filter((p) => p.pending).length;
    const review: ReviewPayload = {
      quizTitle: quiz.title,
      theme: quiz.theme,
      student: attempt.student,
      group: attempt.group_info ?? undefined,
      questions,
      per: attempt.per_question,
      score: attempt.score ?? 0,
      max: attempt.max_score ?? 0,
      pending,
      flags: attempt.flags ?? {},
      submittedAt: attempt.submitted_at ?? new Date().toISOString(),
    };
    return NextResponse.json(review);
  }

  const answers: Record<string, string> = body.answers && typeof body.answers === "object" ? body.answers : {};
  const { per, score, max, pending } = grade(questions, answers);

  const settings = quiz.settings;
  const startedAt = new Date(attempt.started_at).getTime();
  const now = Date.now();
  let deadline: number | undefined;
  if (settings.timerMode === "quiz" && settings.maxMinutes) deadline = startedAt + settings.maxMinutes * 60_000;
  else if (settings.timerMode === "question" && settings.perQuestionSeconds) deadline = startedAt + questions.length * settings.perQuestionSeconds * 1000;
  const flags: AttemptFlags = {};
  if (deadline && now > deadline + GRACE_MS) flags.late = true;
  if (settings.closesAt && now > new Date(settings.closesAt).getTime() + GRACE_MS) flags.late = true;

  const submittedAt = new Date().toISOString();
  await q(
    `UPDATE attempts
        SET answers = $1, per_question = $2, score = $3, max_score = $4,
            flags = $5, status = 'submitted', submitted_at = $6
      WHERE id = $7`,
    [JSON.stringify(answers), JSON.stringify(per), score, max, JSON.stringify(flags), submittedAt, attempt.id]
  );

  const review: ReviewPayload = {
    quizTitle: quiz.title,
    theme: quiz.theme,
    student: attempt.student,
    group: attempt.group_info ?? undefined,
    questions,
    per,
    score,
    max,
    pending,
    flags,
    submittedAt,
  };
  return NextResponse.json(review);
}
