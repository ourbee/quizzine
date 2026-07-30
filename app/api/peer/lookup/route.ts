/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { normRoll } from "@/lib/normalize";
import { normalizePeerConfig, reviewableQuestions } from "@/lib/peer";
import { listReviews, summarisePeer, listSubmittedAttempts, type PeerReviewRow } from "@/lib/peerdb";
import type { GroupInfo, Question, QuizSettings, StudentInfo } from "@/lib/types";

/**
 * A student returning to a quiz that has moved into its reviewing phase. They
 * identify themselves the same way they did when responding — roll number and
 * semester, which is the app's identity anchor — and get back the work they
 * have been asked to mark.
 *
 * Reviewing is double-blind: the responses come back as "Response 1 of 3" with
 * no name, no roll and no attempt id belonging to the author. The review id is
 * the only handle, and it is bound to this reviewer.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const roll = normRoll(String(body?.roll ?? ""));
  const semester = Number(body?.semester);
  if (!slug || !roll || !Number.isFinite(semester)) {
    return NextResponse.json({ error: "Enter your roll number and semester." }, { status: 400 });
  }

  const quizzes = await q<{ id: string; title: string; theme: string; questions: Question[]; settings: QuizSettings; phase: string }>(
    `SELECT id, title, theme, questions, settings, phase FROM quizzes WHERE slug = $1`,
    [slug]
  );
  if (!quizzes.length) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
  const quiz = quizzes[0];
  const phase = quiz.phase ?? "responding";
  if (phase === "responding") {
    return NextResponse.json({ error: "Peer review has not opened yet for this quiz." }, { status: 400 });
  }

  const config = normalizePeerConfig(quiz.settings.peer);
  const attempts = await q<{ id: string; student: StudentInfo; group_info: GroupInfo | null }>(
    `SELECT id, student, group_info FROM attempts WHERE quiz_id = $1 AND status = 'submitted'`,
    [quiz.id]
  );

  // A group submission belongs to every member, so any of their roll numbers finds it.
  const mine = attempts.find((a) =>
    a.group_info
      ? a.group_info.semester === semester && a.group_info.members.some((m) => normRoll(m.roll) === roll)
      : a.student.rollNorm === roll && a.student.semester === semester
  );
  if (!mine) {
    return NextResponse.json(
      { error: "No submission was found for that roll number and semester, so there is nothing for you to review." },
      { status: 404 }
    );
  }

  const questions = reviewableQuestions(quiz.questions);
  const allReviews = await listReviews(quiz.id);
  const assigned = allReviews.filter((r) => r.reviewer_attempt_id === mine.id);
  const answersById = new Map<string, Record<string, string> | null>();
  if (assigned.length) {
    const rows = await q<{ id: string; answers: Record<string, string> | null }>(
      `SELECT id, answers FROM attempts WHERE id = ANY($1::text[])`,
      [assigned.map((r) => r.attempt_id)]
    );
    for (const row of rows) answersById.set(row.id, row.answers);
  }

  // Sorted by review id so "Response 2 of 3" means the same thing on every visit.
  const ordered = [...assigned].sort((a, b) => a.id.localeCompare(b.id));
  const tasks = ordered.map((r: PeerReviewRow, i) => ({
    reviewId: r.id,
    label: `Response ${i + 1} of ${ordered.length}`,
    status: r.status,
    scores: r.scores ?? {},
    comments: r.comments ?? {},
    answers: Object.fromEntries(questions.map((qn) => [qn.id, answersById.get(r.attempt_id)?.[qn.id] ?? ""])),
  }));

  // Once the teacher closes the quiz, the student may read what the panel said of their own work.
  let feedback: { total: number | null; max: number; comments: string[] } | null = null;
  if (phase === "closed" && config.releaseFeedback) {
    const all = await listSubmittedAttempts(quiz.id);
    const { outcomes, max } = summarisePeer(quiz.questions, all, allReviews, config);
    const own = outcomes.find((o) => o.attemptId === mine.id);
    const onMe = allReviews.filter((r) => r.attempt_id === mine.id && r.status === "submitted");
    feedback = {
      total: own ? own.finalScore : null,
      max,
      // Detached from their authors and from each other, so no reviewer can be identified.
      comments: onMe
        .flatMap((r) => questions.map((qn) => (r.comments ?? {})[qn.id] ?? ""))
        .map((c) => c.trim())
        .filter(Boolean),
    };
  }

  return NextResponse.json({
    quizTitle: quiz.title,
    theme: quiz.theme,
    phase,
    reviewerAttemptId: mine.id,
    criteria: config.criteria,
    commentRequired: config.commentRequired,
    questions: questions.map((qn) => ({ id: qn.id, text: qn.text, passage: qn.passage })),
    tasks,
    feedback,
  });
}
