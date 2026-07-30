/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
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
  // Whether a question is scored is safe to reveal; which option is right is not.
  const sanitized = questions.map((qn) => ({
    id: qn.id,
    type: qn.type,
    text: qn.text,
    passage: qn.passage,
    media: qn.media,
    points: qn.points,
    graded: isGraded(qn),
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
      closesAt: settings.closesAt,
      shuffleQuestions: settings.shuffleQuestions,
      shuffleOptions: settings.shuffleOptions,
      allowMultiple: settings.allowMultiple,
      groupMode: settings.groupMode,
      groupMin: settings.groupMin,
      groupMax: settings.groupMax,
      multiScoring: settings.multiScoring,
    },
    questionCount: questions.length,
    totalPoints: maxPoints(questions),
    survey: settings.gradingMode === "survey" || isSurvey(questions),
    peerReview: settings.gradingMode === "peer",
    phase,
    closed,
    questions: closed ? [] : sanitized,
  });
}
