/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

// What a link preview shows when a quiz is shared on WhatsApp, Telegram, Slack
// or anywhere else that reads Open Graph tags. Only things a student would see
// on the intro screen anyway are exposed here — never answers or responses.

import { cache } from "react";
import { q } from "./db.ts";
import { isSurvey, maxPoints } from "./questions.ts";
import type { Question, QuizSettings } from "./types";

export interface ShareQuiz {
  title: string;
  description?: string;
  theme: string;
  questionCount: number;
  totalPoints: number;
  survey: boolean;
  peerReview: boolean;
  groupMode: boolean;
  settings: QuizSettings;
  phase: string;
  open: boolean;
}

/**
 * Memoized for the request, so the page's `generateMetadata` and the Open Graph
 * image do not each pay for a lookup when they run in the same render.
 */
export const shareQuiz = cache(async (slug: string): Promise<ShareQuiz | null> => {
  const rows = await q<{
    title: string;
    description: string | null;
    questions: Question[];
    settings: QuizSettings;
    theme: string;
    accepting: boolean;
    phase: string | null;
  }>(
    `SELECT title, description, questions, settings, theme, accepting, phase FROM quizzes WHERE slug = $1`,
    [slug],
  );
  if (!rows.length) return null;
  const row = rows[0];
  const settings = row.settings;
  const phase = row.phase ?? "responding";
  const closesAt = settings.closesAt ? new Date(settings.closesAt).getTime() : null;
  return {
    title: row.title,
    description: row.description?.trim() || undefined,
    theme: row.theme,
    questionCount: row.questions.length,
    totalPoints: maxPoints(row.questions),
    // A peer-reviewed quiz carries no marks at submission either, but calling it
    // a survey on the card would be wrong — it is marked, only later and by the class.
    survey:
      settings.gradingMode !== "peer" &&
      (settings.gradingMode === "survey" || isSurvey(row.questions)),
    peerReview: settings.gradingMode === "peer",
    groupMode: !!settings.groupMode,
    settings,
    phase,
    open: phase === "responding" && row.accepting && (closesAt === null || Date.now() <= closesAt),
  };
});

/** "12 questions · 30 minutes · 40 marks" — the facts that fit on a card. */
export function shareFacts(quiz: ShareQuiz): string[] {
  const facts = [`${quiz.questionCount} question${quiz.questionCount === 1 ? "" : "s"}`];
  const { timerMode, maxMinutes, perQuestionSeconds } = quiz.settings;
  if (timerMode === "quiz" && maxMinutes) facts.push(`${maxMinutes} minutes`);
  if (timerMode === "question" && perQuestionSeconds) facts.push(`${perQuestionSeconds}s per question`);
  if (quiz.survey) facts.push("survey");
  else if (quiz.totalPoints > 0) facts.push(`${quiz.totalPoints} marks`);
  if (quiz.groupMode) facts.push("group work");
  if (quiz.peerReview) facts.push("peer reviewed");
  return facts;
}

/** The line under the title in a link preview. */
export function shareDescription(quiz: ShareQuiz): string {
  if (quiz.description) return quiz.description;
  const facts = shareFacts(quiz);
  const facts0 = facts[0].charAt(0).toUpperCase() + facts[0].slice(1);
  const summary = [facts0, ...facts.slice(1)].join(" · ");
  if (!quiz.open) {
    const state = quiz.phase === "reviewing" ? "Now in peer review." : "This quiz is closed.";
    return `${summary}. ${state}`;
  }
  const how = quiz.survey
    ? "Open the link to answer — your responses are collected, not marked."
    : "Open the link to take it on any device. No account needed.";
  return `${summary}. ${how}`;
}
