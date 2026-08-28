/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { awardedFor, scorePercent, type RubricConfig } from "./rubric.ts";
import { isChoice, isGraded } from "./questions.ts";
import type { PerQuestionResult, Question } from "./types";

/**
 * What a reviewer said about one written answer.
 *
 * Two reviewers write here — the teacher, and the LLM whose reply the teacher
 * pasted back (lib/markpack.ts). Peers keep their own tables, because a peer
 * mark is an aggregate of several people rather than one person's judgement.
 *
 * Precedence is teacher > AI, and it is a tiebreak rather than a pipeline: it
 * decides what a mark means where two reviewers both scored the same answer,
 * and says nothing about which reviewers had to run. An AI suggestion the
 * teacher never touched is still releasable, and a teacher-only quiz never
 * involves the other reviewer at all.
 *
 * Percentages are stored, never only the derived mark. Rescaling a question
 * from 5 points to 20 must not destroy the diagnostic that says the answer was
 * strong on evidence and weak on structure.
 */

export type Reviewer = "teacher" | "ai";

/** Reviewers in precedence order — the first one with an entry wins. */
export const REVIEWERS: Reviewer[] = ["teacher", "ai"];

export interface MarkEntry {
  /** Percentage points awarded per parameter, each within that parameter's weight. */
  params: Record<string, number>;
  /** Derived sum, kept so a stored mark can be audited without the rubric. */
  percent: number;
  comment?: string;
  strengths?: string;
  improvements?: string;
  corrections?: string;
  oneThing?: string;
  at: string;
}

/** Per question, per reviewer. */
export type MarkingRecord = Record<string, Partial<Record<Reviewer, MarkEntry>>>;

const str = (v: unknown, cap = 4000): string | undefined => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, cap) : undefined;
};

function normalizeEntry(raw: unknown): MarkEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Partial<MarkEntry>;
  const params: Record<string, number> = {};
  for (const [id, value] of Object.entries(src.params ?? {})) {
    const n = Number(value);
    if (Number.isFinite(n)) params[id] = Math.max(0, Math.round(n * 100) / 100);
  }
  const percent = Number(src.percent);
  return {
    params,
    percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent * 10) / 10)) : 0,
    comment: str(src.comment),
    strengths: str(src.strengths),
    improvements: str(src.improvements),
    corrections: str(src.corrections),
    oneThing: str(src.oneThing),
    at: typeof src.at === "string" && src.at ? src.at : new Date().toISOString(),
  };
}

export function normalizeMarking(raw: unknown): MarkingRecord {
  if (!raw || typeof raw !== "object") return {};
  const out: MarkingRecord = {};
  for (const [qid, byReviewer] of Object.entries(raw as Record<string, unknown>)) {
    if (!byReviewer || typeof byReviewer !== "object") continue;
    const entries: Partial<Record<Reviewer, MarkEntry>> = {};
    for (const reviewer of REVIEWERS) {
      const entry = normalizeEntry((byReviewer as Record<string, unknown>)[reviewer]);
      if (entry) entries[reviewer] = entry;
    }
    if (Object.keys(entries).length) out[qid] = entries;
  }
  return out;
}

/** Write one reviewer's marking of one question, leaving every other entry alone. */
export function setMark(
  record: MarkingRecord,
  qid: string,
  reviewer: Reviewer,
  entry: Omit<MarkEntry, "at"> & { at?: string }
): MarkingRecord {
  return {
    ...record,
    [qid]: {
      ...(record[qid] ?? {}),
      [reviewer]: normalizeEntry({ ...entry, at: entry.at ?? new Date().toISOString() })!,
    },
  };
}

/** Remove one reviewer's marking — how a teacher discards an AI suggestion. */
export function clearMark(record: MarkingRecord, qid: string, reviewer: Reviewer): MarkingRecord {
  const existing = record[qid];
  if (!existing?.[reviewer]) return record;
  const rest = { ...existing };
  delete rest[reviewer];
  const next = { ...record };
  if (Object.keys(rest).length) next[qid] = rest;
  else delete next[qid];
  return next;
}

/** The entry that counts for this question, and who wrote it. */
export function effectiveMark(
  record: MarkingRecord,
  qid: string
): { reviewer: Reviewer; entry: MarkEntry } | null {
  for (const reviewer of REVIEWERS) {
    const entry = record?.[qid]?.[reviewer];
    if (entry) return { reviewer, entry };
  }
  return null;
}

/** Build a mark entry from raw parameter scores against a set of weights. */
export function buildEntry(
  params: Record<string, number>,
  weights: Record<string, number>,
  feedback: Partial<Pick<MarkEntry, "comment" | "strengths" | "improvements" | "corrections" | "oneThing">> = {}
): Omit<MarkEntry, "at"> {
  const clamped: Record<string, number> = {};
  for (const [id, weight] of Object.entries(weights)) {
    const raw = Number(params?.[id]);
    if (Number.isFinite(raw)) clamped[id] = Math.min(weight, Math.max(0, Math.round(raw * 100) / 100));
  }
  return { params: clamped, percent: scorePercent(clamped, weights), ...feedback };
}

export interface MarkedQuestion {
  qid: string;
  points: number;
  /** Written and scored — the ones that need marking at all. */
  markable: boolean;
  /** No response was typed: nothing to mark, and never a reason to hold up release. */
  blank: boolean;
  marked: boolean;
  reviewer: Reviewer | null;
  percent: number | null;
  awarded: number;
}

/**
 * Where one attempt stands: which written answers are marked, by whom, and what
 * that comes to in marks. A blank answer counts as marked at zero — a student
 * who wrote nothing is not waiting on the teacher.
 */
export function markingStatus(
  questions: Question[],
  answers: Record<string, string> | null,
  record: MarkingRecord
): MarkedQuestion[] {
  return questions.map((qn) => {
    const markable = !isChoice(qn) && isGraded(qn);
    const blank = !(answers?.[qn.id] ?? "").trim();
    const found = markable ? effectiveMark(record, qn.id) : null;
    const percent = found ? found.entry.percent : blank && markable ? 0 : null;
    return {
      qid: qn.id,
      points: qn.points,
      markable,
      blank,
      marked: markable && percent !== null,
      reviewer: found?.reviewer ?? null,
      percent,
      awarded: percent === null ? 0 : awardedFor(percent, qn.points),
    };
  });
}

/** How many written answers on this attempt are still waiting for a reviewer. */
export const unmarkedCount = (status: MarkedQuestion[]): number =>
  status.filter((s) => s.markable && !s.marked).length;

/**
 * Fold marking into an attempt's stored per-question results, so every existing
 * surface — the responses table, the Excel export, the cross-quiz reports and
 * the analytics — reads a rubric-marked question exactly like an auto-marked
 * one. `pending` drops away as each answer is marked, which is what lets the
 * strengths-and-weaknesses report finally see written work.
 *
 * `correct` is set only at full marks, matching what it means everywhere else:
 * the question was got fully right.
 */
export function applyMarking(
  questions: Question[],
  per: PerQuestionResult[],
  answers: Record<string, string> | null,
  record: MarkingRecord
): { per: PerQuestionResult[]; score: number; max: number; pending: number } {
  const status = new Map(markingStatus(questions, answers, record).map((s) => [s.qid, s]));
  const byQid = new Map(questions.map((qn) => [qn.id, qn]));

  let score = 0;
  let max = 0;
  let pending = 0;

  const next = per.map((row) => {
    const qn = byQid.get(row.qid);
    const s = status.get(row.qid);
    if (!qn || !s || !s.markable) {
      if (!row.ungraded) {
        max += qn?.points ?? 0;
        score += row.awarded ?? 0;
        if (row.pending) pending += 1;
      }
      return row;
    }
    max += qn.points;
    if (!s.marked) {
      pending += 1;
      return { ...row, awarded: 0, pending: true, correct: undefined };
    }
    score += s.awarded;
    return {
      ...row,
      awarded: s.awarded,
      pending: false,
      correct: qn.points > 0 ? s.awarded >= qn.points - 0.001 : true,
    };
  });

  return { per: next, score: Math.round(score * 100) / 100, max, pending };
}
