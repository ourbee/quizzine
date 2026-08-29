/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { normalizeAllotment } from "@/lib/allot";
import { normalizeMstConfig } from "@/lib/mst";
import { isGraded, isSurvey, maxPoints } from "@/lib/questions";
import type { Question, QuizSettings } from "@/lib/types";

// Returns quiz metadata always; question content only while the quiz is open,
// and always WITHOUT correct answers or feedback (grading happens server-side).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const rows = await q<{
    id: string;
    title: string;
    description: string | null;
    intro_media: string | null;
    questions: Question[];
    settings: QuizSettings;
    theme: string;
    accepting: boolean;
    phase: string | null;
  }>(`SELECT * FROM quizzes WHERE slug = $1`, [slug]);
  if (!rows.length) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  const quiz = rows[0];
  const settings = quiz.settings;
  const phase = quiz.phase ?? "responding";
  const closed =
    phase !== "responding" ||
    !quiz.accepting ||
    (settings.closesAt ? Date.now() > new Date(settings.closesAt).getTime() : false);

  const questions = quiz.questions as Question[];
  // An adaptive paper is dealt stage by stage from the server, so the bank never
  // leaves it — a student who could fetch all hundred questions would be reading
  // the ones they have not been routed to yet.
  const mst = settings.mstMode ? normalizeMstConfig(settings.mst) : null;
  // An allotted test's bank must not leave the server either: a student's
  // question(s) arrive from the start route once their roll is verified. Only
  // the semester and how many questions they will sit are safe to say here.
  const allot = settings.allotMode
    ? normalizeAllotment((quiz as unknown as { allotment?: unknown }).allotment)
    : null;
  // Whether a question is scored is safe to reveal; which option is right is not.
  const sanitized = questions.map((qn) => ({
    id: qn.id,
    type: qn.type,
    text: qn.text,
    passage: qn.passage,
    passageTitle: qn.passageTitle,
    media: qn.media,
    points: qn.points,
    graded: isGraded(qn),
    wordLimit: qn.wordLimit,
    options: qn.options.map((o) => ({ key: o.key, text: o.text })),
  }));

  return NextResponse.json({
    title: quiz.title,
    description: quiz.description ?? undefined,
    introMedia: quiz.intro_media ?? undefined,
    theme: quiz.theme,
    settings: {
      timerMode: settings.timerMode,
      maxMinutes: settings.maxMinutes,
      perQuestionSeconds: settings.perQuestionSeconds,
      examMode: settings.examMode,
      mstMode: !!settings.mstMode,
      closesAt: settings.closesAt,
      shuffleQuestions: settings.shuffleQuestions,
      shuffleOptions: settings.shuffleOptions,
      allowMultiple: settings.allowMultiple,
      groupMode: settings.groupMode,
      groupMin: settings.groupMin,
      groupMax: settings.groupMax,
      multiScoring: settings.multiScoring,
      pasteGuard: !!settings.pasteGuard,
      hardWordLimit: !!settings.hardWordLimit,
    },
    questionCount:
      settings.allotMode
        ? (allot?.perStudent ?? 1)
        : mst
          ? Math.min(questions.length, mst.stages * mst.perStage)
          : questions.length,
    totalPoints: mst || settings.allotMode ? undefined : maxPoints(questions),
    mst: mst ? { stages: mst.stages, perStage: mst.perStage } : undefined,
    allotted: settings.allotMode ? true : undefined,
    allotSemester: allot?.semester,
    survey: settings.gradingMode === "survey" || isSurvey(questions),
    peerReview: settings.gradingMode === "peer",
    // Nothing is marked as the student answers; the teacher marks against the
    // rubric and releases. The model answer never reaches the browser before
    // then, which is why marks wait for the release rather than appearing at
    // submission — see lib/rubric.ts.
    rubricMode: settings.gradingMode === "rubric",
    phase,
    closed,
    questions: closed || mst || settings.allotMode ? [] : sanitized,
  });
}
