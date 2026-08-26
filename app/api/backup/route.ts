/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentTeacher } from "@/lib/auth";

/**
 * Everything one teacher owns, as a single JSON file they can keep.
 *
 * Free database plans suspend and purge projects that go quiet over a holiday,
 * and a question bank plus a term's worth of student results is not something
 * to hold in one place and hope. A teacher only ever gets their own quizzes and
 * their own students' attempts — never anyone else's.
 */
export async function GET(req: NextRequest) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const withResults = new URL(req.url).searchParams.get("results") !== "0";

  const quizzes = await q(
    `SELECT id, slug, title, description, intro_media, questions, settings, theme,
            accepting, phase, preset, created_at
       FROM quizzes WHERE owner = $1 ORDER BY created_at ASC`,
    [owner]
  );

  const quizIds = quizzes.map((z) => z.id as string);
  const attempts = withResults && quizIds.length
    ? await q(
        `SELECT id, quiz_id, student, group_info, answers, per_question, score, max_score,
                teacher_score, flags, status, mst, started_at, submitted_at
           FROM attempts WHERE quiz_id = ANY($1::text[]) ORDER BY submitted_at ASC NULLS LAST`,
        [quizIds]
      )
    : [];

  const aliases = await q(
    `SELECT variant_roll, canonical_roll, created_at FROM roll_aliases WHERE owner = $1`,
    [owner]
  );
  const bands = await q(
    `SELECT id, name, bands, is_default, created_at FROM band_schemes WHERE owner = $1`,
    [owner]
  );

  const stamp = new Date().toISOString().slice(0, 10);
  const body = JSON.stringify(
    {
      app: "quizzine",
      version: 1,
      exportedAt: new Date().toISOString(),
      owner,
      quizzes,
      attempts,
      aliases,
      bands,
    },
    null,
    2
  );

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="quizzine-backup-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
