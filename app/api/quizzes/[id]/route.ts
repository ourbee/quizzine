import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { isTeacher } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  if (!(await isTeacher())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const quizzes = await q(`SELECT * FROM quizzes WHERE id = $1`, [id]);
  if (!quizzes.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const attempts = await q(
    `SELECT id, student, answers, per_question, score, max_score, flags, status, started_at, submitted_at
       FROM attempts WHERE quiz_id = $1 AND status = 'submitted'
      ORDER BY submitted_at ASC`,
    [id]
  );
  return NextResponse.json({ quiz: quizzes[0], attempts });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!(await isTeacher())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (typeof body.accepting === "boolean") {
    await q(`UPDATE quizzes SET accepting = $1 WHERE id = $2`, [body.accepting, id]);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  if (!(await isTeacher())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  await q(`DELETE FROM quizzes WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
