/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentTeacher } from "@/lib/auth";
import { isOwner, questionQuota } from "@/lib/access";

// Only the owner of the deployment manages who else may sign in — an invited
// teacher cannot pass their invitation on.
async function requireOwner(): Promise<string | null> {
  const email = await currentTeacher();
  return email && isOwner(email) ? email : null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function GET() {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const invites = await q(
    `SELECT i.email, i.note, i.created_at, i.last_seen_at,
            (SELECT count(*) FROM quizzes z WHERE z.owner = i.email) AS quizzes
       FROM teacher_invites i
      ORDER BY i.created_at DESC`
  );
  return NextResponse.json({ invites, quota: questionQuota() });
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "That does not look like an email address." }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 120) : null;
  await q(
    `INSERT INTO teacher_invites (email, invited_by, note) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET note = EXCLUDED.note`,
    [email, owner, note || null]
  );
  return NextResponse.json({ ok: true, email });
}

export async function DELETE(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const email = new URL(req.url).searchParams.get("email")?.toLowerCase();
  if (!email) return NextResponse.json({ error: "Which invitation?" }, { status: 400 });
  // Their quizzes and their students' results stay exactly where they are —
  // withdrawing an invitation stops them signing in, it does not delete work.
  await q(`DELETE FROM teacher_invites WHERE email = $1`, [email]);
  return NextResponse.json({ ok: true });
}
