import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentTeacher } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

async function ownedQuiz(id: string, owner: string) {
  const rows = await q<{ owner: string | null } & Record<string, unknown>>(
    `SELECT * FROM quizzes WHERE id = $1`,
    [id]
  );
  if (!rows.length || rows[0].owner !== owner) return null;
  return rows[0];
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const quiz = await ownedQuiz(id, owner);
  if (!quiz) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const attempts = await q(
    `SELECT id, student, group_info, answers, per_question, score, max_score, flags, status, started_at, submitted_at
       FROM attempts WHERE quiz_id = $1 AND status = 'submitted'
      ORDER BY submitted_at ASC`,
    [id]
  );
  return NextResponse.json({ quiz, attempts });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await ownedQuiz(id, owner))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.accepting === "boolean") {
    await q(`UPDATE quizzes SET accepting = $1 WHERE id = $2`, [body.accepting, id]);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await ownedQuiz(id, owner))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await q(`DELETE FROM quizzes WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
