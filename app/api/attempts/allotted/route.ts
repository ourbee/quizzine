/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { isGraded } from "@/lib/questions";
import type { Question } from "@/lib/types";

/**
 * A reload mid-attempt on an allotted test: the student's hand comes back from
 * the server, keyed by their attempt, so a cleared browser does not end the
 * attempt — the same recovery an adaptive paper gets from the stage route.
 * Nothing here reveals anyone else's question: the attempt id is the ticket,
 * and it names exactly one hand.
 */
export async function GET(req: NextRequest) {
  const attemptId = req.nextUrl.searchParams.get("attemptId") ?? "";
  if (!attemptId) return NextResponse.json({ error: "Missing attempt id." }, { status: 400 });

  const attempts = await q<{ quiz_id: string; status: string; allotted: string[] | null }>(
    `SELECT quiz_id, status, allotted FROM attempts WHERE id = $1`,
    [attemptId]
  );
  if (!attempts.length) return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
  const attempt = attempts[0];
  if (attempt.status === "submitted") return NextResponse.json({ done: true });
  if (!attempt.allotted?.length) {
    return NextResponse.json({ error: "This attempt has no allotted questions." }, { status: 400 });
  }

  const quizzes = await q<{ questions: Question[] }>(`SELECT questions FROM quizzes WHERE id = $1`, [
    attempt.quiz_id,
  ]);
  if (!quizzes.length) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
  const byId = new Map(quizzes[0].questions.map((qn) => [qn.id, qn]));

  return NextResponse.json({
    questions: attempt.allotted
      .map((qid) => byId.get(qid))
      .filter((qn): qn is Question => !!qn)
      .map((qn) => ({
        id: qn.id,
        type: qn.type,
        text: qn.text,
        passage: qn.passage,
        passageTitle: qn.passageTitle,
        media: qn.media,
        points: qn.points,
        graded: isGraded(qn),
        wordLimit: qn.wordLimit,
        options: qn.options.map((o) => ({ key: o.key, text: o.text })),
      })),
  });
}
