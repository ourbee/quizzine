import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { isTeacher } from "@/lib/auth";
import { genId, slugify } from "@/lib/normalize";
import type { Question, QuizSettings } from "@/lib/types";

export async function GET() {
  if (!(await isTeacher())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await q(
    `SELECT z.id, z.slug, z.title, z.theme, z.accepting, z.created_at,
            count(a.id) FILTER (WHERE a.status = 'submitted') AS responses
       FROM quizzes z
       LEFT JOIN attempts a ON a.quiz_id = z.id
      GROUP BY z.id
      ORDER BY z.created_at DESC`
  );
  return NextResponse.json({ quizzes: rows });
}

export async function POST(req: NextRequest) {
  if (!(await isTeacher())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || !body.title.trim() || !Array.isArray(body.questions) || body.questions.length === 0) {
    return NextResponse.json({ error: "A title and at least one question are required." }, { status: 400 });
  }
  const questions = body.questions as Question[];
  for (const [i, qn] of questions.entries()) {
    if (!qn.text || typeof qn.points !== "number" || qn.points <= 0) {
      return NextResponse.json({ error: `Question ${i + 1} is malformed.` }, { status: 400 });
    }
    if (qn.type === "mcq" && (!qn.correct || !qn.options?.some((o) => o.key === qn.correct))) {
      return NextResponse.json({ error: `Question ${i + 1}: correct answer does not match its options.` }, { status: 400 });
    }
  }
  const settings: QuizSettings = {
    shuffleQuestions: !!body.settings?.shuffleQuestions,
    shuffleOptions: !!body.settings?.shuffleOptions,
    timerMode: ["none", "quiz", "question"].includes(body.settings?.timerMode) ? body.settings.timerMode : "none",
    maxMinutes: Number(body.settings?.maxMinutes) > 0 ? Number(body.settings.maxMinutes) : undefined,
    perQuestionSeconds: Number(body.settings?.perQuestionSeconds) > 0 ? Number(body.settings.perQuestionSeconds) : undefined,
    closesAt: body.settings?.closesAt || undefined,
    allowMultiple: !!body.settings?.allowMultiple,
  };
  const id = genId();
  const slug = slugify(body.title);
  await q(
    `INSERT INTO quizzes (id, slug, title, description, intro_media, questions, settings, theme)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      slug,
      body.title.trim(),
      typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
      typeof body.introMedia === "string" && body.introMedia.trim() ? body.introMedia.trim() : null,
      JSON.stringify(questions),
      JSON.stringify(settings),
      typeof body.theme === "string" ? body.theme : "slate",
    ]
  );
  return NextResponse.json({ id, slug });
}
