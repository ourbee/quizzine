import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { genId, normName, normRoll } from "@/lib/normalize";
import type { Question, QuizSettings, StudentInfo } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const roll = typeof body?.roll === "string" ? body.roll.trim() : "";
  const semester = Number(body?.semester);
  if (!body?.slug || !name || !roll || !(semester >= 1 && semester <= 8)) {
    return NextResponse.json({ error: "Please fill in your name, roll number and semester." }, { status: 400 });
  }
  if (!/^\d{1,15}$/.test(roll)) {
    return NextResponse.json({ error: "Roll number must contain digits only." }, { status: 400 });
  }

  const rows = await q<{ id: string; questions: Question[]; settings: QuizSettings; accepting: boolean }>(
    `SELECT id, questions, settings, accepting FROM quizzes WHERE slug = $1`,
    [body.slug]
  );
  if (!rows.length) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
  const quiz = rows[0];
  const settings = quiz.settings;
  if (!quiz.accepting || (settings.closesAt && Date.now() > new Date(settings.closesAt).getTime())) {
    return NextResponse.json({ error: "This quiz is no longer accepting responses." }, { status: 403 });
  }

  const student: StudentInfo = {
    name: normName(name),
    roll,
    semester,
    nameNorm: normName(name).toLowerCase(),
    rollNorm: normRoll(roll),
  };

  if (!settings.allowMultiple) {
    const dup = await q(
      `SELECT id FROM attempts
        WHERE quiz_id = $1 AND status = 'submitted'
          AND student->>'rollNorm' = $2 AND (student->>'semester')::int = $3
        LIMIT 1`,
      [quiz.id, student.rollNorm, semester]
    );
    if (dup.length) {
      return NextResponse.json(
        { error: "A response with this roll number has already been submitted. Ask your teacher if you need another attempt." },
        { status: 409 }
      );
    }
  }

  const id = genId();
  await q(`INSERT INTO attempts (id, quiz_id, student) VALUES ($1, $2, $3)`, [id, quiz.id, JSON.stringify(student)]);

  const startedAt = Date.now();
  let deadlineAt: number | undefined;
  if (settings.timerMode === "quiz" && settings.maxMinutes) {
    deadlineAt = startedAt + settings.maxMinutes * 60_000;
  } else if (settings.timerMode === "question" && settings.perQuestionSeconds) {
    deadlineAt = startedAt + (quiz.questions as Question[]).length * settings.perQuestionSeconds * 1000;
  }
  if (settings.closesAt) {
    const closes = new Date(settings.closesAt).getTime();
    deadlineAt = deadlineAt ? Math.min(deadlineAt, closes) : undefined;
  }

  return NextResponse.json({ attemptId: id, serverNow: startedAt, deadlineAt });
}
