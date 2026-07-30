/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { isChoice } from "./questions.ts";
import type { Question } from "./types";

/**
 * Peer review: a quiz runs in three phases — students respond, then they mark
 * each other's work against a rubric the teacher wrote, then the teacher
 * releases the result. Everything here is pure so the allocation and the
 * arithmetic can be tested without a database.
 */

export type QuizPhase = "responding" | "reviewing" | "closed";

export interface PeerCriterion {
  id: string;
  label: string;
  max: number;
}

export interface PeerConfig {
  /** How many classmates mark each response. */
  reviewsPerResponse: number;
  criteria: PeerCriterion[];
  commentRequired: boolean;
  /** Median resists one hostile or over-generous reviewer; mean uses everything. */
  aggregate: "mean" | "median";
  /** Marks for completing every review assigned to you. 0 turns this off. */
  reviewPoints: number;
  /** Whether students read their peers' comments once the teacher closes the quiz. */
  releaseFeedback: boolean;
}

export const DEFAULT_CRITERIA: PeerCriterion[] = [
  { id: "c1", label: "Argument", max: 5 },
  { id: "c2", label: "Evidence", max: 5 },
  { id: "c3", label: "Clarity", max: 5 },
];

export const DEFAULT_PEER_CONFIG: PeerConfig = {
  reviewsPerResponse: 3,
  criteria: DEFAULT_CRITERIA,
  commentRequired: true,
  aggregate: "mean",
  reviewPoints: 0,
  releaseFeedback: true,
};

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Coerce whatever is stored in settings into a usable config. */
export function normalizePeerConfig(raw: unknown): PeerConfig {
  const src = (raw ?? {}) as Partial<PeerConfig>;
  const criteria = (Array.isArray(src.criteria) ? src.criteria : DEFAULT_CRITERIA)
    .map((c, i) => ({
      id: String(c?.id ?? `c${i + 1}`),
      label: String(c?.label ?? `Criterion ${i + 1}`).trim() || `Criterion ${i + 1}`,
      max: clampInt(c?.max, 1, 100, 5),
    }))
    .slice(0, 10);
  return {
    reviewsPerResponse: clampInt(src.reviewsPerResponse, 1, 10, 3),
    criteria: criteria.length ? criteria : DEFAULT_CRITERIA,
    commentRequired: src.commentRequired !== false,
    aggregate: src.aggregate === "median" ? "median" : "mean",
    reviewPoints: clampInt(src.reviewPoints, 0, 100, 0),
    releaseFeedback: src.releaseFeedback !== false,
  };
}

/** The questions peers actually mark: typed answers, not multiple-choice picks. */
export function reviewableQuestions(questions: Question[]): Question[] {
  return questions.filter((qn) => !isChoice(qn));
}

/** Marks the rubric can award one response in total. */
export function peerMaxScore(criteria: PeerCriterion[], questionCount: number): number {
  return criteria.reduce((sum, c) => sum + c.max, 0) * questionCount;
}

export type ReviewScores = Record<string, Record<string, number>>;

export interface Pair {
  attemptId: string;
  reviewerAttemptId: string;
}

/**
 * Assign reviewers so every response is marked `perResponse` times and the work
 * is spread as evenly as possible. Existing pairs are kept — a teacher can run
 * this again after late submissions arrive and only the gaps are filled.
 *
 * Nobody is ever given their own work. With fewer students than
 * `perResponse + 1`, everyone simply reviews everyone else.
 */
export function topUpAllocation(attemptIds: string[], existing: Pair[], perResponse: number): Pair[] {
  const ids = [...new Set(attemptIds)].sort();
  const wanted = Math.max(1, Math.min(perResponse, ids.length - 1));
  if (ids.length < 2) return [];

  // With nothing assigned yet a ring is perfectly balanced by construction:
  // each student reviews the next `wanted` responses round the circle.
  if (!existing.length) {
    const ring: Pair[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let d = 1; d <= wanted; d++) {
        ring.push({ attemptId: ids[(i + d) % ids.length], reviewerAttemptId: ids[i] });
      }
    }
    return ring;
  }

  const received = new Map<string, number>(ids.map((id) => [id, 0]));
  const load = new Map<string, number>(ids.map((id) => [id, 0]));
  const taken = new Set<string>();
  for (const p of existing) {
    taken.add(`${p.attemptId}|${p.reviewerAttemptId}`);
    received.set(p.attemptId, (received.get(p.attemptId) ?? 0) + 1);
    load.set(p.reviewerAttemptId, (load.get(p.reviewerAttemptId) ?? 0) + 1);
  }

  const added: Pair[] = [];
  for (const attemptId of ids) {
    while ((received.get(attemptId) ?? 0) < wanted) {
      const candidate = ids
        .filter((r) => r !== attemptId && !taken.has(`${attemptId}|${r}`))
        // Least-loaded reviewer first; the id keeps the choice deterministic.
        .sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || a.localeCompare(b))[0];
      if (!candidate) break; // everyone else is already reviewing this one
      taken.add(`${attemptId}|${candidate}`);
      received.set(attemptId, (received.get(attemptId) ?? 0) + 1);
      load.set(candidate, (load.get(candidate) ?? 0) + 1);
      added.push({ attemptId, reviewerAttemptId: candidate });
    }
  }
  return added;
}

/** What one reviewer awarded a response across every question and criterion. */
export function reviewTotal(scores: ReviewScores, criteria: PeerCriterion[], questionIds: string[]): number {
  let total = 0;
  for (const qid of questionIds) {
    const perQuestion = scores?.[qid] ?? {};
    for (const c of criteria) {
      const raw = Number(perQuestion[c.id]);
      if (Number.isFinite(raw)) total += Math.min(c.max, Math.max(0, raw));
    }
  }
  return Math.round(total * 100) / 100;
}

/** Combine the reviewers' totals into the mark for a response. */
export function aggregateScores(totals: number[], mode: "mean" | "median"): number | null {
  if (!totals.length) return null;
  const sorted = [...totals].sort((a, b) => a - b);
  const value =
    mode === "median"
      ? sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : totals.reduce((s, t) => s + t, 0) / totals.length;
  return Math.round(value * 100) / 100;
}

/**
 * How far a reviewer sits from the panel's consensus on the same response, as a
 * share of the marks available. Measured against the median of all the reviews,
 * which a lone dissenter cannot drag towards itself the way a mean can.
 */
export function outlierGap(total: number, allTotals: number[], max: number): number {
  if (allTotals.length < 2 || max <= 0) return 0;
  const median = aggregateScores(allTotals, "median") ?? total;
  return Math.abs(total - median) / max;
}

/** Reviews deviating this much from their peers are surfaced to the teacher. */
export const OUTLIER_THRESHOLD = 0.25;
