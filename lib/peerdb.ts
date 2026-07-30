/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { q } from "./db.ts";
import { genId } from "./normalize.ts";
import {
  aggregateScores,
  normalizePeerConfig,
  peerMaxScore,
  reviewTotal,
  reviewableQuestions,
  topUpAllocation,
  type PeerConfig,
  type ReviewScores,
} from "./peer.ts";
import type { GroupInfo, Question, QuizSettings, StudentInfo } from "./types";

/**
 * The database side of peer review: handing out assignments, and turning the
 * reviews that come back into a mark on the attempt. Keeping the writes here
 * means the teacher route, the student route and the export all agree on how a
 * peer mark is arrived at.
 */

export interface PeerReviewRow {
  id: string;
  quiz_id: string;
  attempt_id: string;
  reviewer_attempt_id: string;
  scores: ReviewScores | null;
  comments: Record<string, string> | null;
  status: string;
  submitted_at: string | null;
}

export interface PeerAttemptRow {
  id: string;
  student: StudentInfo;
  group_info: GroupInfo | null;
  answers: Record<string, string> | null;
  teacher_score: number | null;
  submitted_at: string;
}

export const listReviews = (quizId: string) =>
  q<PeerReviewRow>(
    `SELECT id, quiz_id, attempt_id, reviewer_attempt_id, scores, comments, status, submitted_at
       FROM peer_reviews WHERE quiz_id = $1`,
    [quizId]
  );

export const listSubmittedAttempts = (quizId: string) =>
  q<PeerAttemptRow>(
    `SELECT id, student, group_info, answers, teacher_score, submitted_at
       FROM attempts WHERE quiz_id = $1 AND status = 'submitted' ORDER BY submitted_at ASC`,
    [quizId]
  );

/**
 * Give every submitted response its full quota of reviewers, leaving any
 * assignment that already exists alone. Safe to call again after late
 * submissions arrive. Returns how many new assignments were made.
 */
export async function assignReviews(quizId: string, config: PeerConfig): Promise<number> {
  const attempts = await listSubmittedAttempts(quizId);
  const existing = await listReviews(quizId);
  const pairs = topUpAllocation(
    attempts.map((a) => a.id),
    existing.map((r) => ({ attemptId: r.attempt_id, reviewerAttemptId: r.reviewer_attempt_id })),
    config.reviewsPerResponse
  );
  for (const pair of pairs) {
    await q(
      `INSERT INTO peer_reviews (id, quiz_id, attempt_id, reviewer_attempt_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (attempt_id, reviewer_attempt_id) DO NOTHING`,
      [genId(), quizId, pair.attemptId, pair.reviewerAttemptId]
    );
  }
  return pairs.length;
}

export interface PeerOutcome {
  attemptId: string;
  /** Mean or median of the reviewers' totals; null when nobody reviewed it. */
  peerScore: number | null;
  reviewsIn: number;
  reviewsAssigned: number;
  /** Reviews this student owed, and how many they actually did. */
  reviewsOwed: number;
  reviewsDone: number;
  /** Marks awarded for completing their own reviewing. */
  reviewCredit: number;
  /** What finally counts: the teacher's override if set, otherwise peers + credit. */
  finalScore: number;
  teacherScore: number | null;
}

/** Work out where every response stands, without writing anything. */
export function summarisePeer(
  questions: Question[],
  attempts: PeerAttemptRow[],
  reviews: PeerReviewRow[],
  config: PeerConfig
): { outcomes: PeerOutcome[]; max: number; rubricMax: number } {
  const qids = reviewableQuestions(questions).map((qn) => qn.id);
  const rubricMax = peerMaxScore(config.criteria, qids.length);
  const max = rubricMax + config.reviewPoints;

  const byAttempt = new Map<string, PeerReviewRow[]>();
  const byReviewer = new Map<string, PeerReviewRow[]>();
  for (const r of reviews) {
    byAttempt.set(r.attempt_id, [...(byAttempt.get(r.attempt_id) ?? []), r]);
    byReviewer.set(r.reviewer_attempt_id, [...(byReviewer.get(r.reviewer_attempt_id) ?? []), r]);
  }

  const outcomes = attempts.map((a) => {
    const received = byAttempt.get(a.id) ?? [];
    const done = received.filter((r) => r.status === "submitted");
    const peerScore = aggregateScores(
      done.map((r) => reviewTotal(r.scores ?? {}, config.criteria, qids)),
      config.aggregate
    );

    const owedRows = byReviewer.get(a.id) ?? [];
    const reviewsDone = owedRows.filter((r) => r.status === "submitted").length;
    // Credit is all-or-nothing: you get it for finishing what you were given.
    const reviewCredit = owedRows.length && reviewsDone === owedRows.length ? config.reviewPoints : 0;

    const fromPeers = Math.round(((peerScore ?? 0) + reviewCredit) * 100) / 100;
    return {
      attemptId: a.id,
      peerScore,
      reviewsIn: done.length,
      reviewsAssigned: received.length,
      reviewsOwed: owedRows.length,
      reviewsDone,
      reviewCredit,
      teacherScore: a.teacher_score,
      finalScore: a.teacher_score ?? fromPeers,
    };
  });

  return { outcomes, max, rubricMax };
}

/**
 * Write the peer marks onto the attempts so every existing surface — the
 * responses table, the Excel export, the cross-quiz reports and the bands —
 * reads a peer-reviewed quiz exactly like any other scored one.
 */
export async function writePeerScores(quizId: string, questions: Question[], settings: QuizSettings): Promise<number> {
  const config = normalizePeerConfig(settings.peer);
  const [attempts, reviews] = await Promise.all([listSubmittedAttempts(quizId), listReviews(quizId)]);
  const { outcomes, max } = summarisePeer(questions, attempts, reviews, config);
  for (const o of outcomes) {
    await q(`UPDATE attempts SET score = $1, max_score = $2 WHERE id = $3`, [o.finalScore, max, o.attemptId]);
  }
  return outcomes.length;
}
