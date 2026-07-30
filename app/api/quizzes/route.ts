/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentTeacher } from "@/lib/auth";
import { genId, slugify } from "@/lib/normalize";
import { correctKeysOf, isGraded } from "@/lib/questions";
import { normalizePeerConfig } from "@/lib/peer";
import type { Question, QuizSettings } from "@/lib/types";

export async function GET() {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await q(
    `SELECT z.id, z.slug, z.title, z.theme, z.accepting, z.created_at,
            count(a.id) FILTER (WHERE a.status = 'submitted') AS responses
       FROM quizzes z
       LEFT JOIN attempts a ON a.quiz_id = z.id
      WHERE z.owner = $1
      GROUP BY z.id
      ORDER BY z.created_at DESC`,
    [owner]
  );
  return NextResponse.json({ owner, quizzes: rows });
}

export async function POST(req: NextRequest) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || !body.title.trim() || !Array.isArray(body.questions) || body.questions.length === 0) {
    return NextResponse.json({ error: "A title and at least one question are required." }, { status: 400 });
  }
  const questions = body.questions as Question[];
  for (const [i, qn] of questions.entries()) {
    const scored = isGraded(qn);
    // Unscored questions are worth exactly nothing; scored ones must be worth something.
    const pointsOk = typeof qn.points === "number" && (scored ? qn.points > 0 : qn.points === 0);
    if (!qn.text || !pointsOk) {
      return NextResponse.json({ error: `Question ${i + 1} is malformed.` }, { status: 400 });
    }
    if (!scored) continue;
    if (qn.type === "mcq" && (!qn.correct || !qn.options?.some((o) => o.key === qn.correct))) {
      return NextResponse.json({ error: `Question ${i + 1}: correct answer does not match its options.` }, { status: 400 });
    }
    if (qn.type === "multi") {
      const keys = correctKeysOf(qn);
      if (!keys.length || !keys.every((k) => qn.options?.some((o) => o.key === k))) {
        return NextResponse.json(
          { error: `Question ${i + 1}: the correct answers do not match its options.` },
          { status: 400 }
        );
      }
    }
  }
  const groupMode = !!body.settings?.groupMode;
  const groupMin = groupMode ? Math.min(50, Math.max(1, Math.floor(Number(body.settings?.groupMin)) || 1)) : undefined;
  const groupMax = groupMode ? Math.min(50, Math.max(groupMin ?? 1, Math.floor(Number(body.settings?.groupMax)) || groupMin || 1)) : undefined;
  const settings: QuizSettings = {
    shuffleQuestions: !!body.settings?.shuffleQuestions,
    shuffleOptions: !!body.settings?.shuffleOptions,
    gradingMode: ["survey", "peer"].includes(body.settings?.gradingMode) ? body.settings.gradingMode : "graded",
    multiScoring: body.settings?.multiScoring === "partial" ? "partial" : "exact",
    peer: body.settings?.gradingMode === "peer" ? normalizePeerConfig(body.settings?.peer) : undefined,
    timerMode: ["none", "quiz", "question"].includes(body.settings?.timerMode) ? body.settings.timerMode : "none",
    maxMinutes: Number(body.settings?.maxMinutes) > 0 ? Number(body.settings.maxMinutes) : undefined,
    perQuestionSeconds: Number(body.settings?.perQuestionSeconds) > 0 ? Number(body.settings.perQuestionSeconds) : undefined,
    closesAt: body.settings?.closesAt || undefined,
    allowMultiple: !!body.settings?.allowMultiple,
    groupMode,
    groupMin,
    groupMax,
  };
  const id = genId();
  const slug = slugify(body.title);
  await q(
    `INSERT INTO quizzes (id, slug, title, description, intro_media, questions, settings, theme, owner)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      slug,
      body.title.trim(),
      typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
      typeof body.introMedia === "string" && body.introMedia.trim() ? body.introMedia.trim() : null,
      JSON.stringify(questions),
      JSON.stringify(settings),
      typeof body.theme === "string" ? body.theme : "slate",
      owner,
    ]
  );
  return NextResponse.json({ id, slug });
}
