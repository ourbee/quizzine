/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { normRoll, readSemester } from "@/lib/normalize";
import { isChoice, isGraded, splitKeys } from "@/lib/questions";
import { effectiveMark, markingStatus, normalizeMarking } from "@/lib/marking";
import { bandPercents, normalizeRubricConfig, weightsForQuestion } from "@/lib/rubric";
import { countWords } from "@/lib/words";
import type { GroupInfo, PerQuestionResult, Question, QuizSettings, StudentInfo } from "@/lib/types";

/**
 * A student coming back for a rubric-marked result.
 *
 * They identify themselves exactly as they did when responding — roll number
 * and semester, the app's identity anchor — and get back what the teacher
 * released: the mark, the rubric band by band, and the written feedback.
 *
 * Nothing is served before the teacher releases. That is not caution about the
 * marks; rubric feedback quotes and compares against the model answer, so an
 * early release would hand the answer to students still writing.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const roll = normRoll(String(body?.roll ?? ""));
  const semester = readSemester(body?.semester);
  if (!slug || !roll || semester === null) {
    return NextResponse.json({ error: "Enter your roll number and semester." }, { status: 400 });
  }

  const quizzes = await q<{
    id: string;
    title: string;
    theme: string;
    questions: Question[];
    settings: QuizSettings;
    phase: string | null;
  }>(`SELECT id, title, theme, questions, settings, phase FROM quizzes WHERE slug = $1`, [slug]);
  if (!quizzes.length) return NextResponse.json({ error: "Quiz not found." }, { status: 404 });
  const quiz = quizzes[0];
  const phase = quiz.phase ?? "responding";

  if (phase !== "closed") {
    return NextResponse.json(
      {
        error: "Your teacher has not released the marking for this quiz yet.",
        phase,
      },
      { status: 400 }
    );
  }

  const attempts = await q<{
    id: string;
    student: StudentInfo;
    group_info: GroupInfo | null;
    answers: Record<string, string> | null;
    per_question: PerQuestionResult[] | null;
    marking: unknown;
    score: number | null;
    max_score: number | null;
    submitted_at: string;
    allotted: string[] | null;
  }>(
    `SELECT id, student, group_info, answers, per_question, marking, score, max_score, submitted_at, allotted
       FROM attempts WHERE quiz_id = $1 AND status = 'submitted'`,
    [quiz.id]
  );

  // A group submission belongs to every member, so any member's roll finds it.
  const mine = attempts.find((a) =>
    a.group_info
      ? a.group_info.semester === semester && a.group_info.members.some((m) => normRoll(m.roll) === roll)
      : a.student.rollNorm === roll && a.student.semester === semester
  );
  if (!mine) {
    return NextResponse.json(
      { error: "No submission was found for that roll number and semester." },
      { status: 404 }
    );
  }

  const rubric = normalizeRubricConfig(quiz.settings.rubric);
  const marking = normalizeMarking(mine.marking);
  // An allotted student gets back their own hand, never the bank — releasing
  // the other questions would release their classmates' model answers too.
  const paper =
    quiz.settings.allotMode && mine.allotted?.length
      ? mine.allotted
          .map((qid) => quiz.questions.find((qn) => qn.id === qid))
          .filter((qn): qn is Question => !!qn)
      : quiz.questions;
  const status = new Map(markingStatus(paper, mine.answers, marking).map((s) => [s.qid, s]));

  const questions = paper.map((qn) => {
    const written = !isChoice(qn) && isGraded(qn);
    const stored = mine.answers?.[qn.id] ?? "";
    const per = mine.per_question?.find((p) => p.qid === qn.id);
    const found = written ? effectiveMark(marking, qn.id) : null;
    const weights = written ? weightsForQuestion(rubric, qn) : {};
    const entry = found?.entry;
    const state = status.get(qn.id);
    // A choice question was marked when it was submitted, and its result lives
    // where it always has. Only a written answer waits for a reviewer, so only
    // a written answer reads its mark out of the marking record.
    const awarded = written ? (state?.awarded ?? 0) : (per?.awarded ?? 0);
    const marked = written ? !!state?.marked : !per?.pending;
    // Students never saw the option keys — the options are shuffled per student
    // — so a choice answer comes back as the text they actually clicked.
    const answer =
      isChoice(qn) && stored
        ? splitKeys(stored)
            .map((k) => qn.options.find((o) => o.key === k)?.text ?? k)
            .join(", ")
        : stored;
    return {
      id: qn.id,
      text: qn.text,
      passage: qn.passage,
      passageTitle: qn.passageTitle,
      type: qn.type,
      points: qn.points,
      graded: isGraded(qn),
      written,
      answer,
      words: written ? countWords(answer) : 0,
      wordLimit: qn.wordLimit,
      awarded,
      percent: written ? (state?.percent ?? null) : null,
      marked,
      // Released, so the model answer may travel now — and it is the single most
      // useful thing a student gets back from a written question.
      modelAnswer: written ? qn.feedbackCorrect : undefined,
      bands: entry ? bandPercents(rubric, entry.params, weights) : [],
      strengths: entry?.strengths,
      improvements: entry?.improvements,
      corrections: entry?.corrections,
      oneThing: entry?.oneThing,
      comment: entry?.comment,
    };
  });

  return NextResponse.json({
    quizTitle: quiz.title,
    theme: quiz.theme,
    who: mine.group_info ? mine.group_info.name : mine.student.name,
    score: mine.score ?? 0,
    max: mine.max_score ?? 0,
    submittedAt: mine.submitted_at,
    bands: rubric.bands.map((b) => ({ id: b.id, label: b.label })),
    questions,
  });
}
