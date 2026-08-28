/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentTeacher } from "@/lib/auth";
import { checkQuota, isInvited } from "@/lib/access";
import { genId, slugify } from "@/lib/normalize";
import type { Question } from "@/lib/types";

/**
 * Hand a quiz to a colleague.
 *
 * Sharing makes them a COPY, not a view of yours: their own id, their own link,
 * their own QR code, their own response pool. That is the whole point — their
 * students' names and marks belong on their dashboard and nowhere else, and no
 * later edit of yours can change a paper their class has already sat.
 *
 * The copy carries the questions, the settings, the rubric and the theme, and
 * nothing else: not one attempt, not one mark, not one student's name.
 *
 * A colleague must already be allowed to sign in. Sharing is not a back door
 * into the deployment — it hands a quiz to someone who is already here.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Ctx = { params: Promise<{ id: string }> };

async function ownedQuiz(id: string, owner: string) {
  const rows = await q<{ owner: string | null } & Record<string, unknown>>(
    `SELECT * FROM quizzes WHERE id = $1`,
    [id]
  );
  if (!rows.length || rows[0].owner !== owner) return null;
  return rows[0];
}

/** Who this quiz has already been given to, newest first. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await ownedQuiz(id, owner))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const shares = await q(
    `SELECT s.shared_with, s.created_at, s.copy_quiz_id,
            (SELECT count(*) FROM attempts a
              WHERE a.quiz_id = s.copy_quiz_id AND a.status = 'submitted') AS responses,
            EXISTS (SELECT 1 FROM quizzes z WHERE z.id = s.copy_quiz_id) AS still_there
       FROM quiz_shares s
      WHERE s.source_quiz_id = $1
      ORDER BY s.created_at DESC`,
    [id]
  );
  return NextResponse.json({ shares });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const source = await ownedQuiz(id, owner);
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "That does not look like an email address." }, { status: 400 });
  }
  if (email === owner) {
    return NextResponse.json({ error: "That is your own account — the quiz is already yours." }, { status: 400 });
  }
  if (!(await isInvited(email))) {
    return NextResponse.json(
      {
        error: `${email} cannot sign in to Quizzine yet, so there is nowhere to put the copy. Ask the owner of this site to invite them first — then share it.`,
      },
      { status: 400 }
    );
  }

  const questions = (source.questions ?? []) as Question[];
  // The copy lands in their allowance, because it lands in their account. Said
  // plainly rather than half-copied: a quiz that arrives with questions missing
  // would be worse than one that does not arrive.
  const quota = await checkQuota(email, questions.length);
  if (!quota.ok) {
    return NextResponse.json(
      {
        error: `${email} has ${quota.remaining} of their daily allowance of ${quota.limit} questions left, and this quiz has ${questions.length}. Their allowance frees up 24 hours after each quiz they made — try again tomorrow.`,
      },
      { status: 429 }
    );
  }

  const copyId = genId();
  const title = String(source.title ?? "Untitled");
  await q(
    `INSERT INTO quizzes (id, slug, title, description, intro_media, questions, settings, theme, owner, preset,
                          shared_from, shared_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      copyId,
      slugify(title),
      title,
      source.description ?? null,
      source.intro_media ?? null,
      JSON.stringify(questions),
      JSON.stringify(source.settings ?? {}),
      source.theme ?? "slate",
      email,
      source.preset ?? null,
      id,
      owner,
    ]
  );
  await q(
    `INSERT INTO quiz_shares (id, source_quiz_id, copy_quiz_id, shared_by, shared_with)
     VALUES ($1, $2, $3, $4, $5)`,
    [genId(), id, copyId, owner, email]
  );

  return NextResponse.json({ ok: true, email, copyId, questions: questions.length });
}
