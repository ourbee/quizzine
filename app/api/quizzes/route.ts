/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentTeacher } from "@/lib/auth";
import { checkQuota } from "@/lib/access";
import { genId, slugify } from "@/lib/normalize";
import { correctKeysOf, isGraded } from "@/lib/questions";
import { normalizePeerConfig } from "@/lib/peer";
import { bandCriteria, normalizeRubricConfig } from "@/lib/rubric";
import { normalizeMstConfig } from "@/lib/mst";
import { buildVocabulary, canonicalizeTags, findPreset } from "@/lib/tags";
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

  // Rationing is per teacher, not per quiz, so a hundred one-question quizzes
  // cost the same as one hundred-question quiz.
  const quota = await checkQuota(owner, questions.length);
  if (!quota.ok) {
    return NextResponse.json(
      {
        error: `That would publish ${questions.length} questions, and ${quota.remaining} of your daily allowance of ${quota.limit} are left. The allowance frees up 24 hours after each quiz was created.`,
      },
      { status: 429 }
    );
  }

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
  // An allotted test deals every roster roll its own question, which rules out
  // anything that shares or re-deals the paper: group submissions, the adaptive
  // router, and peer review (a reviewer would meet a question they never sat).
  const allotMode = !!body.settings?.allotMode;
  if (allotMode && body.settings?.gradingMode === "peer") {
    return NextResponse.json({ error: "An allotted test cannot be peer-reviewed." }, { status: 400 });
  }
  const groupMode = !allotMode && !!body.settings?.groupMode;
  const groupMin = groupMode ? Math.min(50, Math.max(1, Math.floor(Number(body.settings?.groupMin)) || 1)) : undefined;
  const groupMax = groupMode ? Math.min(50, Math.max(groupMin ?? 1, Math.floor(Number(body.settings?.groupMax)) || groupMin || 1)) : undefined;
  const examMode = !!body.settings?.examMode;
  const mstMode = !allotMode && !!body.settings?.mstMode;
  // The exam interface lets a student roam the paper by its palette, which the
  // per-question timer exists to forbid. Exam mode wins; the teacher form offers
  // the same two timers it leaves standing.
  const rawTimerMode = ["none", "quiz", "question"].includes(body.settings?.timerMode) ? body.settings.timerMode : "none";
  // An adaptive paper rules the per-question timer out for the same reason the
  // exam interface does: the student must be free to move around the stage they
  // are sitting.
  const timerMode = (examMode || mstMode) && rawTimerMode === "question" ? "none" : rawTimerMode;
  const gradingMode: QuizSettings["gradingMode"] = ["survey", "peer", "rubric"].includes(body.settings?.gradingMode)
    ? body.settings.gradingMode
    : "graded";
  // A rubric is stored whenever anything marks against it: rubric mode itself,
  // or a peer round whose criteria are the rubric's own bands.
  const peerFromRubric = gradingMode === "peer" && !!body.settings?.peerFromRubric;
  const wantsRubric = gradingMode === "rubric" || peerFromRubric;
  const rubric = wantsRubric ? normalizeRubricConfig(body.settings?.rubric) : undefined;
  const settings: QuizSettings = {
    shuffleQuestions: !!body.settings?.shuffleQuestions,
    shuffleOptions: !!body.settings?.shuffleOptions,
    gradingMode,
    multiScoring: body.settings?.multiScoring === "partial" ? "partial" : "exact",
    peer:
      gradingMode === "peer"
        ? normalizePeerConfig(
            peerFromRubric && rubric
              ? { ...(body.settings?.peer ?? {}), criteria: bandCriteria(rubric) }
              : body.settings?.peer
          )
        : undefined,
    rubric,
    peerFromRubric: peerFromRubric || undefined,
    pasteGuard: !!body.settings?.pasteGuard || undefined,
    hardWordLimit: !!body.settings?.hardWordLimit || undefined,
    timerMode,
    maxMinutes: Number(body.settings?.maxMinutes) > 0 ? Number(body.settings.maxMinutes) : undefined,
    perQuestionSeconds:
      timerMode === "question" && Number(body.settings?.perQuestionSeconds) > 0
        ? Number(body.settings.perQuestionSeconds)
        : undefined,
    examMode,
    mstMode,
    mst: mstMode ? normalizeMstConfig(body.settings?.mst) : undefined,
    closesAt: body.settings?.closesAt || undefined,
    allowMultiple: !!body.settings?.allowMultiple,
    groupMode,
    groupMin,
    groupMax,
    allotMode: allotMode || undefined,
  };
  /*
   * Tag hygiene at the door: an incoming tag that matches one the teacher
   * already uses is stored in THEIR spelling, so a case or spacing variant can
   * never found a second bucket and split a report in half. Done here rather
   * than only in the browser, because this is the gate every quiz passes
   * through however it was created.
   */
  const owned = await q<{ questions: Question[] }>(`SELECT questions FROM quizzes WHERE owner = $1`, [owner]);
  const vocabulary = buildVocabulary(owned.flatMap((z) => (z.questions ?? []).flatMap((qn) => qn.tags ?? [])));
  if (vocabulary.tags.length) {
    for (const qn of questions) {
      if (qn.tags?.length) qn.tags = canonicalizeTags(qn.tags, vocabulary);
    }
  }

  const id = genId();
  const slug = slugify(body.title);
  const preset = findPreset(body.preset)?.id ?? null;
  // An allotted quiz is born closed: nobody can sit it until the roster is in
  // and every roll has a question — opening it is what the guardrail checks.
  await q(
    `INSERT INTO quizzes (id, slug, title, description, intro_media, questions, settings, theme, owner, preset, accepting)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
      preset,
      !allotMode,
    ]
  );
  return NextResponse.json({ id, slug });
}
