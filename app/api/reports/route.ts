/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentTeacher } from "@/lib/auth";
import type { ReportAttempt, ReportQuiz } from "@/lib/report";

/**
 * Source rows for a cross-quiz report: the selected quizzes the teacher owns and
 * every submitted attempt on them. Per-question detail is deliberately left out —
 * reports work on totals, and ten quizzes' worth of answers is a heavy payload.
 */
export async function POST(req: NextRequest) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.quizIds)
    ? body.quizIds.filter((x: unknown): x is string => typeof x === "string").slice(0, 100)
    : [];
  if (!ids.length) return NextResponse.json({ error: "Pick at least one quiz." }, { status: 400 });

  const quizzes = await q<ReportQuiz & { settings: { groupMode?: boolean; gradingMode?: string } }>(
    `SELECT id, title, created_at, settings FROM quizzes
      WHERE owner = $1 AND id = ANY($2::text[])
      ORDER BY created_at ASC`,
    [owner, ids]
  );
  if (!quizzes.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ownedIds = quizzes.map((z) => z.id);
  const attempts = await q<ReportAttempt>(
    `SELECT id, quiz_id, student, group_info, score, max_score, flags, submitted_at
       FROM attempts
      WHERE quiz_id = ANY($1::text[]) AND status = 'submitted'
      ORDER BY submitted_at ASC`,
    [ownedIds]
  );

  return NextResponse.json({
    quizzes: quizzes.map((z) => ({
      id: z.id,
      title: z.title,
      created_at: z.created_at,
      group_mode: !!z.settings?.groupMode,
      scored: z.settings?.gradingMode !== "survey",
    })),
    attempts,
  });
}
