/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentTeacher } from "@/lib/auth";
import { DEFAULT_ANALYTICS, buildAnalytics, type AnalyticsAttempt, type AnalyticsOptions, type AnalyticsQuiz } from "@/lib/analytics";
import { isChoice, isGraded } from "@/lib/questions";
import type { AliasMap } from "@/lib/report";
import type { Question, QuizSettings } from "@/lib/types";

/**
 * The strengths-and-weaknesses report.
 *
 * Unlike the marks report, this one aggregates on the SERVER. It needs every
 * question of every attempt, which for a class of forty across five quizzes is
 * on the order of a megabyte of answer rows — far too much to hand to a browser
 * so it can boil it down to a few dozen tag percentages. What comes back is the
 * finished aggregate.
 */
export async function POST(req: NextRequest) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.quizIds)
    ? body.quizIds.filter((x: unknown): x is string => typeof x === "string").slice(0, 100)
    : [];
  if (!ids.length) return NextResponse.json({ error: "Pick at least one quiz." }, { status: 400 });

  const rows = await q<{
    id: string;
    title: string;
    created_at: string;
    questions: Question[];
    settings: QuizSettings;
  }>(
    `SELECT id, title, created_at, questions, settings FROM quizzes
      WHERE owner = $1 AND id = ANY($2::text[])
      ORDER BY created_at ASC`,
    [owner, ids]
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const quizzes: AnalyticsQuiz[] = rows.map((z) => ({
    id: z.id,
    title: z.title,
    created_at: z.created_at,
    questions: (z.questions ?? []).map((qn) => ({
      id: qn.id,
      text: qn.text,
      tags: qn.tags ?? [],
      difficulty: qn.difficulty,
      points: qn.points,
      graded: isGraded(qn),
      // Typed answers are marked as a whole attempt, so they carry no
      // per-question result to attribute to a tag.
      autoMarked: isChoice(qn),
    })),
  }));

  const attempts = await q<AnalyticsAttempt>(
    `SELECT id, quiz_id, student, group_info, per_question, score, max_score, submitted_at
       FROM attempts
      WHERE quiz_id = ANY($1::text[]) AND status = 'submitted'
      ORDER BY submitted_at ASC`,
    [rows.map((z) => z.id)]
  );

  const aliasRows = await q<{ variant_roll: string; canonical_roll: string }>(
    `SELECT variant_roll, canonical_roll FROM roll_aliases WHERE owner = $1`,
    [owner]
  );
  const aliases: AliasMap = {};
  for (const a of aliasRows) aliases[a.variant_roll] = a.canonical_roll;

  const number = (value: unknown, fallback: number, lo: number, hi: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
  };

  const options: AnalyticsOptions = {
    minEvidence: number(body?.minEvidence, DEFAULT_ANALYTICS.minEvidence, 1, 50),
    margin: number(body?.margin, DEFAULT_ANALYTICS.margin, 1, 50),
    passMark: number(body?.passMark, DEFAULT_ANALYTICS.passMark, 0, 100),
    repeats: body?.repeats === "latest" ? "latest" : "best",
    semester: body?.semester === "all" || body?.semester === undefined ? "all" : number(body.semester, -1, -1, 8),
    aliases,
    rolls: Array.isArray(body?.rolls)
      ? body.rolls.filter((r: unknown): r is string => typeof r === "string").slice(0, 200)
      : undefined,
  };

  return NextResponse.json(buildAnalytics(quizzes, attempts, options));
}
