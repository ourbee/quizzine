/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { grade } from "@/lib/grade";
import { advanceMst, mstPoints, normalizeMstConfig, publicStage, type MstState } from "@/lib/mst";
import { isGraded } from "@/lib/questions";
import type { Question, QuizSettings } from "@/lib/types";

/**
 * Close one stage of an adaptive paper and hand back the next.
 *
 * Routing is decided here and nowhere else. The browser is told which questions
 * to show and never which difficulty it is on or how the last stage scored,
 * because a student who can read their own routing can infer their marks
 * mid-exam. The stage's answers are banked as they arrive, so a student whose
 * connection drops between stages keeps everything they have already committed.
 */
/**
 * The stage the student is on, without advancing anything. A reload mid-paper
 * has to be able to get its questions back — losing them would end the attempt.
 */
export async function GET(req: NextRequest) {
  const attemptId = new URL(req.url).searchParams.get("attemptId");
  if (!attemptId) return NextResponse.json({ error: "Missing attempt id." }, { status: 400 });

  const attempts = await q<{ quiz_id: string; status: string; mst: MstState | null }>(
    `SELECT quiz_id, status, mst FROM attempts WHERE id = $1`,
    [attemptId]
  );
  if (!attempts.length) return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
  const attempt = attempts[0];
  if (!attempt.mst) return NextResponse.json({ error: "This quiz is not an adaptive paper." }, { status: 400 });

  const quizzes = await q<{ questions: Question[]; settings: QuizSettings }>(
    `SELECT questions, settings FROM quizzes WHERE id = $1`,
    [attempt.quiz_id]
  );
  if (!quizzes.length) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
  const config = normalizeMstConfig(quizzes[0].settings.mst);

  return NextResponse.json({
    done: attempt.mst.done || attempt.status === "submitted",
    stage: attempt.mst.stage,
    totalStages: config.stages,
    questions: publicStage(quizzes[0].questions ?? [], attempt.mst),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.attemptId) return NextResponse.json({ error: "Missing attempt id." }, { status: 400 });

  const attempts = await q<{
    id: string;
    quiz_id: string;
    status: string;
    answers: Record<string, string> | null;
    mst: MstState | null;
  }>(`SELECT id, quiz_id, status, answers, mst FROM attempts WHERE id = $1`, [body.attemptId]);
  if (!attempts.length) return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
  const attempt = attempts[0];
  if (attempt.status === "submitted") {
    return NextResponse.json({ error: "This attempt has already been submitted." }, { status: 409 });
  }

  const quizzes = await q<{ questions: Question[]; settings: QuizSettings }>(
    `SELECT questions, settings FROM quizzes WHERE id = $1`,
    [attempt.quiz_id]
  );
  if (!quizzes.length) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
  const bank = quizzes[0].questions ?? [];
  const settings = quizzes[0].settings;
  if (!settings.mstMode || !attempt.mst) {
    return NextResponse.json({ error: "This quiz is not an adaptive paper." }, { status: 400 });
  }
  const config = normalizeMstConfig(settings.mst);
  const state = attempt.mst;

  // Only answers to the stage the student is actually on are accepted, so a
  // replayed or edited request cannot reach back into a stage already closed.
  const currentStage = new Set(state.served[state.stage] ?? []);
  const incoming: Record<string, string> = body.answers && typeof body.answers === "object" ? body.answers : {};
  const answers: Record<string, string> = { ...(attempt.answers ?? {}) };
  for (const [qid, value] of Object.entries(incoming)) {
    if (currentStage.has(qid) && typeof value === "string") answers[qid] = value;
  }

  const stageQuestions = bank
    .filter((qn) => currentStage.has(qn.id))
    .map((qn) => {
      const points = mstPoints(qn, config);
      return points === qn.points ? qn : { ...qn, points };
    });
  const marked = grade(stageQuestions, answers, settings.multiScoring ?? "exact");
  const possible = stageQuestions.reduce((sum, qn) => sum + (isGraded(qn) ? qn.points : 0), 0);
  const percent = possible > 0 ? (marked.score / possible) * 100 : 0;

  const next = advanceMst(
    state,
    bank,
    config,
    { difficulty: state.difficulty, awarded: marked.score, possible, percent },
    // Later stages are shuffled per attempt when the quiz asks for it; the first
    // stage never is, so every student begins on the same paper.
    settings.shuffleQuestions ? attempt.id : undefined
  );

  await q(`UPDATE attempts SET answers = $1, mst = $2 WHERE id = $3`, [
    JSON.stringify(answers),
    JSON.stringify(next),
    attempt.id,
  ]);

  if (next.done) {
    return NextResponse.json({ done: true, stage: next.stage, totalStages: config.stages });
  }

  return NextResponse.json({
    done: false,
    stage: next.stage,
    totalStages: config.stages,
    questions: publicStage(bank, next),
  });
}
