/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { normalizePeerConfig, reviewableQuestions } from "@/lib/peer";
import type { Question, QuizSettings } from "@/lib/types";

/**
 * One completed peer review.
 *
 * The reviewer proves who they are with their own attempt id — the same
 * unguessable handle that authorises submitting a quiz — and it must match the
 * reviewer the assignment was made to. Scores are clamped to the rubric here,
 * so nothing a browser sends can inflate a mark.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const reviewId = typeof body?.reviewId === "string" ? body.reviewId : "";
  const reviewerAttemptId = typeof body?.reviewerAttemptId === "string" ? body.reviewerAttemptId : "";
  if (!reviewId || !reviewerAttemptId) return NextResponse.json({ error: "Missing review." }, { status: 400 });

  const rows = await q<{ id: string; quiz_id: string; reviewer_attempt_id: string; status: string }>(
    `SELECT id, quiz_id, reviewer_attempt_id, status FROM peer_reviews WHERE id = $1`,
    [reviewId]
  );
  if (!rows.length) return NextResponse.json({ error: "Review not found." }, { status: 404 });
  const review = rows[0];
  if (review.reviewer_attempt_id !== reviewerAttemptId) {
    return NextResponse.json({ error: "This review belongs to someone else." }, { status: 403 });
  }

  const quizzes = await q<{ questions: Question[]; settings: QuizSettings; phase: string }>(
    `SELECT questions, settings, phase FROM quizzes WHERE id = $1`,
    [review.quiz_id]
  );
  if (!quizzes.length) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
  const quiz = quizzes[0];
  if ((quiz.phase ?? "responding") !== "reviewing") {
    return NextResponse.json({ error: "Peer review is not open for this quiz." }, { status: 400 });
  }

  const config = normalizePeerConfig(quiz.settings.peer);
  const questions = reviewableQuestions(quiz.questions);
  const rawScores = (body?.scores ?? {}) as Record<string, Record<string, unknown>>;
  const rawComments = (body?.comments ?? {}) as Record<string, unknown>;

  const scores: Record<string, Record<string, number>> = {};
  const comments: Record<string, string> = {};
  const missing: string[] = [];

  for (const [i, qn] of questions.entries()) {
    const perQuestion: Record<string, number> = {};
    for (const c of config.criteria) {
      const value = Number(rawScores?.[qn.id]?.[c.id]);
      if (!Number.isFinite(value)) {
        missing.push(`${c.label} on response part ${i + 1}`);
        continue;
      }
      perQuestion[c.id] = Math.min(c.max, Math.max(0, Math.round(value * 100) / 100));
    }
    scores[qn.id] = perQuestion;

    const comment = String(rawComments?.[qn.id] ?? "").trim().slice(0, 4000);
    if (comment) comments[qn.id] = comment;
    else if (config.commentRequired) missing.push(`a comment on response part ${i + 1}`);
  }

  if (missing.length) {
    return NextResponse.json(
      { error: `Please complete every part before submitting — still needed: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}.` },
      { status: 400 }
    );
  }

  await q(
    `UPDATE peer_reviews SET scores = $1, comments = $2, status = 'submitted', submitted_at = now() WHERE id = $3`,
    [JSON.stringify(scores), JSON.stringify(comments), reviewId]
  );
  return NextResponse.json({ ok: true });
}
