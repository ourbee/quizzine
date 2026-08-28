/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentTeacher } from "@/lib/auth";
import { isChoice, isGraded } from "@/lib/questions";
import { buildEntry, clearMark, normalizeMarking, setMark, type Reviewer } from "@/lib/marking";
import { listMarkableAttempts, markingProgress, recomputeAttempt, recomputeQuiz } from "@/lib/markdb";
import { normalizeRubricConfig, weightsForQuestion } from "@/lib/rubric";
import { normalizeTelemetry } from "@/lib/telemetry";
import type { Question, QuizSettings } from "@/lib/types";

/**
 * The teacher's marking screen, and the release that ends it.
 *
 * A written question could never be scored outside peer mode: `grade()` marks
 * it pending for ever and nothing existed to resolve it. This route is the
 * missing half. It serves rubric-marked quizzes and, just as usefully, any
 * ordinary scored quiz that happens to contain a written question.
 *
 * Nothing here is AI-specific. The AI pass reaches it through the same `save`
 * action with `reviewer: "ai"`, because a pasted-back suggestion is one more
 * reviewer's opinion and is stored exactly like the teacher's own.
 */

type QuizRow = {
  id: string;
  slug: string;
  title: string;
  questions: Question[];
  settings: QuizSettings;
  phase: string | null;
};

async function loadOwned(id: string, owner: string): Promise<QuizRow | null> {
  const rows = await q<QuizRow>(
    `SELECT id, slug, title, questions, settings, phase FROM quizzes WHERE id = $1 AND owner = $2`,
    [id, owner]
  );
  return rows[0] ?? null;
}

const writtenQuestions = (questions: Question[]) => questions.filter((qn) => !isChoice(qn) && isGraded(qn));

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const quiz = await loadOwned(id, owner);
  if (!quiz) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rubric = normalizeRubricConfig(quiz.settings.rubric);
  const attempts = await listMarkableAttempts(quiz.id);
  const written = writtenQuestions(quiz.questions);

  return NextResponse.json({
    quiz: {
      id: quiz.id,
      slug: quiz.slug,
      title: quiz.title,
      phase: quiz.phase ?? "responding",
      gradingMode: quiz.settings.gradingMode ?? "graded",
    },
    rubric,
    questions: written.map((qn) => ({
      id: qn.id,
      text: qn.text,
      passage: qn.passage,
      passageTitle: qn.passageTitle,
      points: qn.points,
      type: qn.type,
      wordLimit: qn.wordLimit,
      modelAnswer: qn.feedbackCorrect,
      weights: weightsForQuestion(rubric, qn),
    })),
    attempts: attempts.map((a) => ({
      id: a.id,
      name: a.group_info ? a.group_info.name : a.student.name,
      roll: a.group_info ? `${a.group_info.members.length} members` : a.student.rollNorm,
      answers: Object.fromEntries(written.map((qn) => [qn.id, a.answers?.[qn.id] ?? ""])),
      marking: normalizeMarking(a.marking),
      telemetry: normalizeTelemetry(a.telemetry),
      flags: a.flags ?? {},
      score: a.score,
      maxScore: a.max_score,
      submittedAt: a.submitted_at,
    })),
    progress: markingProgress(quiz.questions, attempts),
  });
}

const readReviewer = (v: unknown): Reviewer => (v === "ai" ? "ai" : "teacher");

/** One reviewer's marking of one answer, as it arrives from the screen. */
interface IncomingMark {
  attemptId?: unknown;
  qid?: unknown;
  params?: unknown;
  comment?: unknown;
  strengths?: unknown;
  improvements?: unknown;
  corrections?: unknown;
  oneThing?: unknown;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const quiz = await loadOwned(id, owner);
  if (!quiz) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const action = body?.action;
  const rubric = normalizeRubricConfig(quiz.settings.rubric);
  const byId = new Map(writtenQuestions(quiz.questions).map((qn) => [qn.id, qn]));

  if (action === "save" || action === "saveMany") {
    const reviewer = readReviewer(body.reviewer);
    const incoming: IncomingMark[] = action === "save" ? [body] : Array.isArray(body.marks) ? body.marks : [];
    if (!incoming.length) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

    // Group by attempt so one attempt is read, updated and written once even
    // when a whole question's worth of AI marks arrives in a single paste.
    const grouped = new Map<string, IncomingMark[]>();
    for (const mark of incoming) {
      const attemptId = typeof mark.attemptId === "string" ? mark.attemptId : "";
      const qid = typeof mark.qid === "string" ? mark.qid : "";
      if (!attemptId || !byId.has(qid)) continue;
      grouped.set(attemptId, [...(grouped.get(attemptId) ?? []), mark]);
    }
    if (!grouped.size) {
      return NextResponse.json({ error: "None of those marks named a written question on this quiz." }, { status: 400 });
    }

    const attempts = await listMarkableAttempts(quiz.id);
    const attemptById = new Map(attempts.map((a) => [a.id, a]));
    let saved = 0;

    for (const [attemptId, marks] of grouped) {
      const attempt = attemptById.get(attemptId);
      if (!attempt) continue;
      let record = normalizeMarking(attempt.marking);
      for (const mark of marks) {
        const qn = byId.get(String(mark.qid))!;
        const weights = weightsForQuestion(rubric, qn);
        const params: Record<string, number> = {};
        for (const [key, value] of Object.entries((mark.params ?? {}) as Record<string, unknown>)) {
          const n = Number(value);
          if (Number.isFinite(n)) params[key] = n;
        }
        record = setMark(
          record,
          qn.id,
          reviewer,
          buildEntry(params, weights, {
            comment: mark.comment === undefined ? undefined : String(mark.comment),
            strengths: mark.strengths === undefined ? undefined : String(mark.strengths),
            improvements: mark.improvements === undefined ? undefined : String(mark.improvements),
            corrections: mark.corrections === undefined ? undefined : String(mark.corrections),
            oneThing: mark.oneThing === undefined ? undefined : String(mark.oneThing),
          })
        );
        saved += 1;
      }
      await q(`UPDATE attempts SET marking = $1 WHERE id = $2`, [JSON.stringify(record), attemptId]);
      await recomputeAttempt({ ...attempt, marking: record }, quiz.questions, quiz.settings);
    }

    const after = await listMarkableAttempts(quiz.id);
    return NextResponse.json({ ok: true, saved, progress: markingProgress(quiz.questions, after) });
  }

  if (action === "clear") {
    const attemptId = typeof body.attemptId === "string" ? body.attemptId : "";
    const qid = typeof body.qid === "string" ? body.qid : "";
    if (!attemptId || !byId.has(qid)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const attempts = await listMarkableAttempts(quiz.id);
    const attempt = attempts.find((a) => a.id === attemptId);
    if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const record = clearMark(normalizeMarking(attempt.marking), qid, readReviewer(body.reviewer));
    await q(`UPDATE attempts SET marking = $1 WHERE id = $2`, [JSON.stringify(record), attemptId]);
    await recomputeAttempt({ ...attempt, marking: record }, quiz.questions, quiz.settings);
    const after = await listMarkableAttempts(quiz.id);
    return NextResponse.json({ ok: true, progress: markingProgress(quiz.questions, after) });
  }

  /*
   * Release. Always the teacher's click, in every configuration — including
   * releasing AI suggestions nobody edited, which is a legitimate choice and
   * not the same thing as an automatic release. Unmarked blanks never block it.
   */
  if (action === "release") {
    const scored = await recomputeQuiz(quiz.id, quiz.questions, quiz.settings);
    await q(`UPDATE quizzes SET phase = 'closed', accepting = false WHERE id = $1`, [quiz.id]);
    return NextResponse.json({ ok: true, phase: "closed", scored });
  }

  if (action === "unrelease") {
    await q(`UPDATE quizzes SET phase = 'reviewing' WHERE id = $1`, [quiz.id]);
    return NextResponse.json({ ok: true, phase: "reviewing" });
  }

  /** Stop taking responses and start marking, without releasing anything. */
  if (action === "startMarking") {
    await q(`UPDATE quizzes SET phase = 'reviewing', accepting = false WHERE id = $1`, [quiz.id]);
    return NextResponse.json({ ok: true, phase: "reviewing" });
  }

  if (action === "reopenResponses") {
    await q(`UPDATE quizzes SET phase = 'responding', accepting = true WHERE id = $1`, [quiz.id]);
    return NextResponse.json({ ok: true, phase: "responding" });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
