/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * The state behind the exam interface — the palette a student reads to see, at a
 * glance, what they have done with every question in the paper.
 *
 * Two things are remembered per attempt: which questions have been *landed on*,
 * and which have been *flagged*. Every status in the legend falls out of those
 * two plus the answer itself, so there is no fifth state to keep in step with
 * the other four.
 *
 * Answers here mean saved answers. Choosing an option in this interface does
 * nothing until the student presses one of the Save buttons — navigating away
 * from an unsaved choice discards it, exactly as the real examination does. That
 * is the single most common way a first-timer loses marks, so rehearsing it is
 * the point rather than a rough edge. See `ExamShell`, which holds the pending
 * choice as a draft and only writes through on save.
 *
 * None of this reaches the server. Flagging a question is a note a student
 * leaves themselves; a flagged answer is marked no differently from any other.
 */

export type ExamStatus =
  | "notVisited"
  | "notAnswered"
  | "answered"
  | "marked"
  | "answeredMarked";

/** What the student has touched so far. Sets, because order never matters. */
export interface ExamProgress {
  visited: Set<string>;
  marked: Set<string>;
}

export const emptyProgress = (): ExamProgress => ({ visited: new Set(), marked: new Set() });

/** A saved answer counts when it is more than whitespace — the same test the
 *  scrolling quiz uses, so multi ("A,C"), short and essay answers all work. */
export const hasAnswer = (answer: string | undefined): boolean => (answer ?? "").trim() !== "";

export function statusOf(qid: string, answers: Record<string, string>, progress: ExamProgress): ExamStatus {
  const answered = hasAnswer(answers[qid]);
  const marked = progress.marked.has(qid);
  // A question can be flagged from the very first visit without an answer, so
  // "marked" is tested before "not visited" would otherwise claim it.
  if (marked) return answered ? "answeredMarked" : "marked";
  // A saved answer is its own proof the student was here, so it outranks the
  // visited set. Nothing should be able to save without visiting, but a palette
  // showing a filled-in question as untouched would be a lie worth ruling out.
  if (answered) return "answered";
  return progress.visited.has(qid) ? "notAnswered" : "notVisited";
}

export interface StatusCounts {
  notVisited: number;
  notAnswered: number;
  answered: number;
  marked: number;
  answeredMarked: number;
}

export function countStatuses(
  qids: string[],
  answers: Record<string, string>,
  progress: ExamProgress
): StatusCounts {
  const counts: StatusCounts = { notVisited: 0, notAnswered: 0, answered: 0, marked: 0, answeredMarked: 0 };
  for (const qid of qids) counts[statusOf(qid, answers, progress)] += 1;
  return counts;
}

/** Everything the student has actually committed — what the submit summary counts
 *  and what the confirmation warns about. Flagged-and-answered counts as answered
 *  because it is marked for evaluation like any other saved answer. */
export function submitSummary(qids: string[], answers: Record<string, string>, progress: ExamProgress) {
  const counts = countStatuses(qids, answers, progress);
  return {
    total: qids.length,
    answered: counts.answered + counts.answeredMarked,
    notAnswered: counts.notVisited + counts.notAnswered + counts.marked,
    flagged: counts.marked + counts.answeredMarked,
  };
}

// ---------- persistence ----------

/**
 * One key per attempt holding both sets, so the two can never be restored out of
 * step with each other. Sets do not survive JSON, hence the arrays.
 */
export interface StoredProgress {
  visited: string[];
  marked: string[];
}

export const examKey = (attemptId: string) => `qd-exam-${attemptId}`;

export const serializeProgress = (p: ExamProgress): string =>
  JSON.stringify({ visited: [...p.visited], marked: [...p.marked] } satisfies StoredProgress);

export function parseProgress(raw: string | null): ExamProgress {
  if (!raw) return emptyProgress();
  try {
    const parsed = JSON.parse(raw) as Partial<StoredProgress>;
    return {
      visited: new Set(Array.isArray(parsed.visited) ? parsed.visited : []),
      marked: new Set(Array.isArray(parsed.marked) ? parsed.marked : []),
    };
  } catch {
    return emptyProgress();
  }
}

// ---------- the palette's colours ----------

/**
 * Fixed on purpose. These five colours are what the student is here to learn, so
 * they do not follow the quiz's chosen theme — a familiar interface in unfamiliar
 * colours would teach the wrong thing.
 */
export interface StatusStyle {
  label: string;
  bg: string;
  fg: string;
  border: string;
  /** The palette tile's shape, which carries as much meaning as its colour. */
  shape: "square" | "flag" | "circle";
}

export const STATUS_STYLES: Record<ExamStatus, StatusStyle> = {
  notVisited: { label: "Not Visited", bg: "#e2e8f0", fg: "#1e293b", border: "#94a3b8", shape: "square" },
  notAnswered: { label: "Not Answered", bg: "#dc2626", fg: "#ffffff", border: "#dc2626", shape: "flag" },
  answered: { label: "Answered", bg: "#16a34a", fg: "#ffffff", border: "#16a34a", shape: "flag" },
  marked: { label: "Marked for Review", bg: "#7e22ce", fg: "#ffffff", border: "#7e22ce", shape: "circle" },
  answeredMarked: {
    label: "Answered & Marked for Review",
    bg: "#7e22ce",
    fg: "#ffffff",
    border: "#7e22ce",
    shape: "circle",
  },
};

/** The legend's order, top-left to bottom, as the reference interface lists it. */
export const LEGEND_ORDER: ExamStatus[] = [
  "notVisited",
  "notAnswered",
  "answered",
  "marked",
  "answeredMarked",
];
