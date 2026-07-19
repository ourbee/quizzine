import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
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
  }>(`SELECT * FROM quizzes WHERE slug = $1`, [slug]);
  if (!rows.length) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  const quiz = rows[0];
  const settings = quiz.settings;
  const closed = !quiz.accepting || (settings.closesAt ? Date.now() > new Date(settings.closesAt).getTime() : false);

  const questions = quiz.questions as Question[];
  const sanitized = questions.map((qn) => ({
    id: qn.id,
    type: qn.type,
    text: qn.text,
    passage: qn.passage,
    media: qn.media,
    points: qn.points,
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
    },
    questionCount: questions.length,
    totalPoints: questions.reduce((s, qn) => s + qn.points, 0),
    closed,
    questions: closed ? [] : sanitized,
  });
}
