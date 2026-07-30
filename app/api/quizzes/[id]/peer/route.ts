/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentTeacher } from "@/lib/auth";
import { normalizePeerConfig, reviewTotal, reviewableQuestions, OUTLIER_THRESHOLD, outlierGap } from "@/lib/peer";
import { assignReviews, listReviews, listSubmittedAttempts, summarisePeer, writePeerScores } from "@/lib/peerdb";
import type { Question, QuizSettings } from "@/lib/types";

type QuizRow = { id: string; title: string; questions: Question[]; settings: QuizSettings; phase: string };

async function loadOwned(id: string, owner: string): Promise<QuizRow | null> {
  const rows = await q<QuizRow>(
    `SELECT id, title, questions, settings, phase FROM quizzes WHERE id = $1 AND owner = $2`,
    [id, owner]
  );
  return rows[0] ?? null;
}

/** Everything the teacher's peer-review tab shows: who reviewed whom, and where each mark stands. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const quiz = await loadOwned(id, owner);
  if (!quiz) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const config = normalizePeerConfig(quiz.settings.peer);
  const [attempts, reviews] = await Promise.all([listSubmittedAttempts(quiz.id), listReviews(quiz.id)]);
  const { outcomes, max, rubricMax } = summarisePeer(quiz.questions, attempts, reviews, config);
  const qids = reviewableQuestions(quiz.questions).map((qn) => qn.id);

  // Totals per response, so a reviewer can be measured against the rest of the panel.
  const totalsByAttempt = new Map<string, number[]>();
  for (const r of reviews) {
    if (r.status !== "submitted") continue;
    const total = reviewTotal(r.scores ?? {}, config.criteria, qids);
    totalsByAttempt.set(r.attempt_id, [...(totalsByAttempt.get(r.attempt_id) ?? []), total]);
  }

  const nameOf = (attemptId: string) => {
    const a = attempts.find((x) => x.id === attemptId);
    if (!a) return "—";
    return a.group_info ? a.group_info.name : `${a.student.name} (${a.student.rollNorm})`;
  };

  return NextResponse.json({
    phase: quiz.phase ?? "responding",
    config,
    max,
    rubricMax,
    criteria: config.criteria,
    questions: reviewableQuestions(quiz.questions).map((qn) => ({ id: qn.id, text: qn.text })),
    outcomes: outcomes.map((o) => ({ ...o, name: nameOf(o.attemptId) })),
    reviews: reviews.map((r) => {
      const total = r.status === "submitted" ? reviewTotal(r.scores ?? {}, config.criteria, qids) : null;
      const panel = totalsByAttempt.get(r.attempt_id) ?? [];
      return {
        id: r.id,
        attemptId: r.attempt_id,
        of: nameOf(r.attempt_id),
        by: nameOf(r.reviewer_attempt_id),
        status: r.status,
        total,
        comments: r.comments ?? {},
        outlier: total !== null && outlierGap(total, panel, rubricMax) > OUTLIER_THRESHOLD,
        submittedAt: r.submitted_at,
      };
    }),
  });
}

/** Teacher actions: open reviewing, top up assignments, override a mark, release results. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const quiz = await loadOwned(id, owner);
  if (!quiz) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const action = body?.action;
  const config = normalizePeerConfig(quiz.settings.peer);

  if (action === "open") {
    const attempts = await listSubmittedAttempts(quiz.id);
    if (attempts.length < 2) {
      return NextResponse.json(
        { error: "At least two responses are needed before classmates can review each other." },
        { status: 400 }
      );
    }
    const added = await assignReviews(quiz.id, config);
    // Reviewing implies responding is over, so new attempts stop here.
    await q(`UPDATE quizzes SET phase = 'reviewing', accepting = false WHERE id = $1`, [quiz.id]);
    return NextResponse.json({ ok: true, phase: "reviewing", assigned: added });
  }

  if (action === "assign") {
    const added = await assignReviews(quiz.id, config);
    return NextResponse.json({ ok: true, assigned: added });
  }

  if (action === "close") {
    const scored = await writePeerScores(quiz.id, quiz.questions, quiz.settings);
    await q(`UPDATE quizzes SET phase = 'closed' WHERE id = $1`, [quiz.id]);
    return NextResponse.json({ ok: true, phase: "closed", scored });
  }

  if (action === "reopen") {
    await q(`UPDATE quizzes SET phase = 'reviewing' WHERE id = $1`, [quiz.id]);
    return NextResponse.json({ ok: true, phase: "reviewing" });
  }

  if (action === "respond") {
    await q(`UPDATE quizzes SET phase = 'responding', accepting = true WHERE id = $1`, [quiz.id]);
    return NextResponse.json({ ok: true, phase: "responding" });
  }

  if (action === "override") {
    const attemptId = typeof body.attemptId === "string" ? body.attemptId : "";
    if (!attemptId) return NextResponse.json({ error: "Missing attempt." }, { status: 400 });
    // An empty score clears the override and hands the mark back to the peers.
    const raw = body.score;
    const score = raw === null || raw === "" ? null : Number(raw);
    if (score !== null && (!Number.isFinite(score) || score < 0)) {
      return NextResponse.json({ error: "A mark must be zero or more." }, { status: 400 });
    }
    const owned = await q<{ id: string }>(`SELECT id FROM attempts WHERE id = $1 AND quiz_id = $2`, [attemptId, quiz.id]);
    if (!owned.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await q(`UPDATE attempts SET teacher_score = $1 WHERE id = $2`, [score, attemptId]);
    // Keep the visible mark in step if results are already out.
    if ((quiz.phase ?? "responding") === "closed") await writePeerScores(quiz.id, quiz.questions, quiz.settings);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
