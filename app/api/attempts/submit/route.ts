/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { grade } from "@/lib/grade";
import { abilityResponses, estimateAbility, normalizeMstConfig, servedQuestions, type MstState } from "@/lib/mst";
import { isSurvey } from "@/lib/questions";
import { normalizeTelemetry } from "@/lib/telemetry";
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
    answers: Record<string, string> | null;
    mst: MstState | null;
    allotted: string[] | null;
  }>(`SELECT * FROM attempts WHERE id = $1`, [body.attemptId]);
  if (!attempts.length) return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
  const attempt = attempts[0];

  const quizzes = await q<{ title: string; theme: string; questions: Question[]; settings: QuizSettings }>(
    `SELECT title, theme, questions, settings FROM quizzes WHERE id = $1`,
    [attempt.quiz_id]
  );
  if (!quizzes.length) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
  const quiz = quizzes[0];
  const bank = quiz.questions as Question[];
  // An adaptive paper is the questions this student was routed through, not the
  // bank they were drawn from: marking, the total and the review all work on it.
  const mstConfig = quiz.settings?.mstMode ? normalizeMstConfig(quiz.settings.mst) : null;
  // An allotted attempt is marked on the hand this student was dealt, exactly
  // as an adaptive one is marked on the stages they were routed through.
  const dealt =
    quiz.settings?.allotMode && attempt.allotted?.length
      ? attempt.allotted
          .map((qid) => bank.find((qn) => qn.id === qid))
          .filter((qn): qn is Question => !!qn)
      : null;
  const questions = dealt ?? (mstConfig ? servedQuestions(bank, attempt.mst, mstConfig) : bank);
  const rubricMode = quiz.settings?.gradingMode === "rubric";
  // A rubric-marked quiz shows "response recorded" at submission for the same
  // reason a peer-reviewed one does: the marks do not exist yet, and rubric
  // feedback quotes the model answer, which must not reach a browser while
  // classmates are still writing.
  const survey = quiz.settings?.gradingMode === "survey" || rubricMode || isSurvey(questions);
  const peerReview = quiz.settings?.gradingMode === "peer";

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
      survey,
      peerReview,
      rubricMode,
      flags: attempt.flags ?? {},
      submittedAt: attempt.submitted_at ?? new Date().toISOString(),
      ability:
        mstConfig?.abilityScore && !survey
          ? estimateAbility(abilityResponses(questions, attempt.per_question))
          : undefined,
    };
    return NextResponse.json(review);
  }

  // The stage endpoint has been banking answers as each stage closed, so an
  // adaptive paper submits what the server already holds rather than trusting a
  // browser to send back stages it should no longer be able to change.
  const posted: Record<string, string> = body.answers && typeof body.answers === "object" ? body.answers : {};
  let answers: Record<string, string> = mstConfig ? { ...posted, ...(attempt.answers ?? {}) } : posted;
  // Answers to questions this student was never dealt are refused at the door.
  if (dealt) {
    const mine = new Set(dealt.map((qn) => qn.id));
    answers = Object.fromEntries(Object.entries(answers).filter(([qid]) => mine.has(qid)));
  }
  const settings = quiz.settings;
  const { per, score, max, pending } = grade(questions, answers, settings.multiScoring ?? "exact");

  const startedAt = new Date(attempt.started_at).getTime();
  const now = Date.now();
  let deadline: number | undefined;
  if (settings.timerMode === "quiz" && settings.maxMinutes) deadline = startedAt + settings.maxMinutes * 60_000;
  else if (settings.timerMode === "question" && settings.perQuestionSeconds) deadline = startedAt + questions.length * settings.perQuestionSeconds * 1000;
  const flags: AttemptFlags = {};
  if (deadline && now > deadline + GRACE_MS) flags.late = true;
  if (settings.closesAt && now > new Date(settings.closesAt).getTime() + GRACE_MS) flags.late = true;

  // Counts only — how the answer was typed, never a character of what was
  // typed or pasted. Disclosed to the student on the intro screen. See
  // lib/telemetry.ts for why there is no verdict attached to it.
  const telemetry = normalizeTelemetry(body.telemetry);

  const submittedAt = new Date().toISOString();
  await q(
    `UPDATE attempts
        SET answers = $1, per_question = $2, score = $3, max_score = $4,
            flags = $5, status = 'submitted', submitted_at = $6, telemetry = $7
      WHERE id = $8`,
    [
      JSON.stringify(answers),
      JSON.stringify(per),
      score,
      max,
      JSON.stringify(flags),
      submittedAt,
      JSON.stringify(telemetry),
      attempt.id,
    ]
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
    survey,
    peerReview,
    rubricMode,
    flags,
    submittedAt,
    ability:
      mstConfig?.abilityScore && !survey
        ? estimateAbility(abilityResponses(questions, per))
        : undefined,
  };
  return NextResponse.json(review);
}
