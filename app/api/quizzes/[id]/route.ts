/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentTeacher } from "@/lib/auth";
import { planEdit } from "@/lib/edit";
import { grade } from "@/lib/grade";
import { applyMarking, normalizeMarking } from "@/lib/marking";
import { normalizeMstConfig, servedQuestions } from "@/lib/mst";
import { normalizePeerConfig } from "@/lib/peer";
import { bandCriteria, normalizeRubricConfig } from "@/lib/rubric";
import { validateQuestions } from "@/lib/validate";
import { buildVocabulary, canonicalizeTags, findPreset } from "@/lib/tags";
import type { MstState } from "@/lib/mst";
import type { PerQuestionResult, Question, QuizSettings, RawQuestion } from "@/lib/types";

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

/**
 * Save an edit. The plan is worked out first and only applied once the teacher
 * has confirmed anything that changes what an existing attempt means — see
 * lib/edit.ts for why ids are never reissued. Post `confirm: false` (the
 * default) to preview: nothing is written and the plan comes back for the
 * teacher to read.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const stored = await ownedQuiz(id, owner);
  if (!stored) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  const before = (stored.questions ?? []) as Question[];
  const settingsBefore = (stored.settings ?? {}) as QuizSettings;

  const submitted = await q<{ n: string }>(
    `SELECT count(*) AS n FROM attempts WHERE quiz_id = $1 AND status = 'submitted'`,
    [id]
  );
  const attemptCount = Number(submitted[0]?.n ?? 0);

  // Questions arrive in the same loose shape an upload uses, so an edit gets the
  // same validation an upload does — one place decides what a valid question is.
  let questions = before;
  let plan = planEdit(before, before, attemptCount > 0);
  if (Array.isArray(body.questions)) {
    const gradingMode = body.settings?.gradingMode ?? settingsBefore.gradingMode ?? "graded";
    const parsed = { questions: body.questions as RawQuestion[] };
    const result = validateQuestions(parsed, gradingMode, body.preset ?? stored.preset ?? null);
    if (result.errors.length) {
      return NextResponse.json({ error: result.errors[0], errors: result.errors }, { status: 400 });
    }
    // validateQuestions renumbers positionally; the incoming ids are what map an
    // edited question back to the one students answered, so they are restored.
    // The validator rebuilds each question from the loose upload shape, so
    // anything it does not know about has to be carried across by hand. Ids are
    // what map an edited question back to the one students answered; the
    // per-question rubric weights are simply not a validated field.
    const withIds = result.questions.map((qn, i) => {
      const incoming = (body.questions as RawQuestion[])[i] as RawQuestion & {
        id?: string;
        rubricWeights?: Record<string, number>;
      };
      const weights = incoming?.rubricWeights;
      return {
        ...qn,
        id: incoming?.id ?? "",
        ...(weights && Object.keys(weights).length ? { rubricWeights: weights } : {}),
      };
    });
    // The same hygiene an upload gets: an edited tag that matches an existing
    // spelling is stored in that spelling rather than founding a variant.
    const owned = await q<{ questions: Question[] }>(
      `SELECT questions FROM quizzes WHERE owner = $1 AND id <> $2`,
      [owner, id]
    );
    const vocabulary = buildVocabulary(owned.flatMap((z) => (z.questions ?? []).flatMap((qn) => qn.tags ?? [])));
    const canonical = vocabulary.tags.length
      ? withIds.map((qn) => (qn.tags?.length ? { ...qn, tags: canonicalizeTags(qn.tags, vocabulary) } : qn))
      : withIds;

    plan = planEdit(before, canonical, attemptCount > 0);
    questions = plan.questions;

    if (!body.confirm && plan.tier !== "safe") {
      return NextResponse.json({ preview: true, plan: { ...plan, questions: undefined }, attemptCount });
    }
  }

  // Group work: the bounds only mean anything while it is on, and are cleared
  // with it so a quiz turned back to individual work carries nothing stale.
  const groupMode = !!(body.settings?.groupMode ?? settingsBefore.groupMode);
  const groupMin = groupMode
    ? Math.min(50, Math.max(1, Math.floor(Number(body.settings?.groupMin ?? settingsBefore.groupMin)) || 1))
    : undefined;
  const groupMax = groupMode
    ? Math.min(50, Math.max(groupMin ?? 1, Math.floor(Number(body.settings?.groupMax ?? settingsBefore.groupMax)) || groupMin || 1))
    : undefined;

  const examMode = body.settings?.examMode ?? settingsBefore.examMode ?? false;
  const mstMode = body.settings?.mstMode ?? settingsBefore.mstMode ?? false;
  const rawTimerMode = ["none", "quiz", "question"].includes(body.settings?.timerMode)
    ? body.settings.timerMode
    : (settingsBefore.timerMode ?? "none");
  const timerMode = (examMode || mstMode) && rawTimerMode === "question" ? "none" : rawTimerMode;

  const gradingMode = ["graded", "survey", "peer", "rubric"].includes(body.settings?.gradingMode)
    ? body.settings.gradingMode
    : (settingsBefore.gradingMode ?? "graded");
  const peerFromRubric =
    gradingMode === "peer" && !!(body.settings?.peerFromRubric ?? settingsBefore.peerFromRubric);
  const rubric =
    gradingMode === "rubric" || peerFromRubric
      ? normalizeRubricConfig(body.settings?.rubric ?? settingsBefore.rubric)
      : undefined;

  const settings: QuizSettings = {
    ...settingsBefore,
    shuffleQuestions: !!(body.settings?.shuffleQuestions ?? settingsBefore.shuffleQuestions),
    shuffleOptions: !!(body.settings?.shuffleOptions ?? settingsBefore.shuffleOptions),
    gradingMode,
    multiScoring: (body.settings?.multiScoring ?? settingsBefore.multiScoring) === "partial" ? "partial" : "exact",
    peer:
      gradingMode === "peer"
        ? normalizePeerConfig(
            peerFromRubric && rubric
              ? { ...(body.settings?.peer ?? settingsBefore.peer ?? {}), criteria: bandCriteria(rubric) }
              : (body.settings?.peer ?? settingsBefore.peer)
          )
        : undefined,
    rubric,
    peerFromRubric: peerFromRubric || undefined,
    pasteGuard: (body.settings?.pasteGuard ?? settingsBefore.pasteGuard) ? true : undefined,
    hardWordLimit: (body.settings?.hardWordLimit ?? settingsBefore.hardWordLimit) ? true : undefined,
    timerMode,
    maxMinutes: Number(body.settings?.maxMinutes ?? settingsBefore.maxMinutes) > 0
      ? Number(body.settings?.maxMinutes ?? settingsBefore.maxMinutes)
      : undefined,
    perQuestionSeconds:
      timerMode === "question" && Number(body.settings?.perQuestionSeconds ?? settingsBefore.perQuestionSeconds) > 0
        ? Number(body.settings?.perQuestionSeconds ?? settingsBefore.perQuestionSeconds)
        : undefined,
    examMode,
    mstMode,
    mst: mstMode ? normalizeMstConfig(body.settings?.mst ?? settingsBefore.mst) : undefined,
    closesAt: body.settings?.closesAt !== undefined ? body.settings.closesAt || undefined : settingsBefore.closesAt,
    allowMultiple: !!(body.settings?.allowMultiple ?? settingsBefore.allowMultiple),
    groupMode,
    groupMin,
    groupMax,
  };

  const preset = body.preset !== undefined ? (findPreset(body.preset)?.id ?? null) : (stored.preset ?? null);

  await q(
    `UPDATE quizzes
        SET title = $1, description = $2, intro_media = $3, questions = $4,
            settings = $5, theme = $6, preset = $7
      WHERE id = $8`,
    [
      typeof body.title === "string" && body.title.trim() ? body.title.trim() : stored.title,
      body.description !== undefined
        ? (typeof body.description === "string" && body.description.trim() ? body.description.trim() : null)
        : (stored.description ?? null),
      body.introMedia !== undefined
        ? (typeof body.introMedia === "string" && body.introMedia.trim() ? body.introMedia.trim() : null)
        : (stored.intro_media ?? null),
      JSON.stringify(questions),
      JSON.stringify(settings),
      typeof body.theme === "string" ? body.theme : stored.theme,
      preset,
      id,
    ]
  );

  let regraded = 0;
  if (attemptCount > 0 && (plan.regrade.length || plan.removed.length || plan.added.length)) {
    regraded = await regradeAttempts(id, questions, settings);
  }

  return NextResponse.json({ ok: true, plan: { ...plan, questions: undefined }, regraded });
}

/**
 * Re-mark every submitted attempt from the answers already stored. The answers
 * themselves are never touched — only the marks derived from them — so this is
 * repeatable and always reflects the quiz as it stands now.
 */
async function regradeAttempts(quizId: string, questions: Question[], settings: QuizSettings): Promise<number> {
  const attempts = await q<{
    id: string;
    answers: Record<string, string> | null;
    mst: MstState | null;
    marking: unknown;
  }>(`SELECT id, answers, mst, marking FROM attempts WHERE quiz_id = $1 AND status = 'submitted'`, [quizId]);

  let count = 0;
  for (const attempt of attempts) {
    // An adaptive paper is marked on the questions that student was served, not
    // on the whole bank they were drawn from.
    const paper =
      settings.mstMode && attempt.mst
        ? servedQuestions(questions, attempt.mst, normalizeMstConfig(settings.mst))
        : questions;
    const graded = grade(paper, attempt.answers ?? {}, settings.multiScoring ?? "exact");
    // Re-marking from the answers must not discard the marking a reviewer has
    // already done: it is folded back in, so an edit to a question's wording or
    // its points rescales the mark instead of losing it.
    const { per, score, max } = applyMarking(
      paper,
      graded.per,
      attempt.answers,
      normalizeMarking(attempt.marking)
    );
    await q(`UPDATE attempts SET per_question = $1, score = $2, max_score = $3 WHERE id = $4`, [
      JSON.stringify(per satisfies PerQuestionResult[]),
      score,
      max,
      attempt.id,
    ]);
    count += 1;
  }
  return count;
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
