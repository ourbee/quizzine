/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { correctKeysOf, isChoice, isGraded, splitKeys } from "./questions.ts";
import type { MultiScoring, PerQuestionResult, Question } from "./types";

/**
 * Marks a multi-answer set that is not an exact match.
 *
 * Under "exact" that is simply zero — the rule students find easiest to
 * understand. Under "partial" each correct tick earns a share and each wrong
 * tick cancels one, floored at zero, so ticking everything scores nothing.
 */
function gradePartial(picked: string[], correct: string[], points: number, mode: MultiScoring): number {
  if (mode !== "partial" || !picked.length || !correct.length) return 0;
  const hits = picked.filter((k) => correct.includes(k)).length;
  const misses = picked.length - hits;
  const share = (hits - misses) / correct.length;
  return share <= 0 ? 0 : Math.round(points * Math.min(1, share) * 100) / 100;
}

export function grade(questions: Question[], answers: Record<string, string>, multiScoring: MultiScoring = "exact") {
  const per: PerQuestionResult[] = [];
  let score = 0;
  let max = 0;
  let pending = 0;

  for (const qn of questions) {
    const raw = answers[qn.id];
    const answer = typeof raw === "string" ? raw.trim() : "";

    // Collected but never scored: no marks, no marking queue, no denominator.
    if (!isGraded(qn)) {
      per.push({ qid: qn.id, answer: answer || undefined, awarded: 0, pending: false, ungraded: true });
      continue;
    }

    max += qn.points;

    if (!isChoice(qn)) {
      pending++;
      per.push({ qid: qn.id, answer: answer || undefined, awarded: 0, pending: true });
      continue;
    }

    const correctKeys = correctKeysOf(qn);
    let exact: boolean;
    let awarded: number;
    if (qn.type === "multi") {
      const picked = splitKeys(answer);
      exact = picked.length === correctKeys.length && picked.every((k) => correctKeys.includes(k)) && picked.length > 0;
      awarded = exact ? qn.points : gradePartial(picked, correctKeys, qn.points, multiScoring);
    } else {
      exact = answer !== "" && answer === qn.correct;
      awarded = exact ? qn.points : 0;
    }

    score += awarded;
    per.push({ qid: qn.id, answer: answer || undefined, correct: exact, awarded, pending: false });
  }

  return { per, score: Math.round(score * 100) / 100, max, pending };
}
