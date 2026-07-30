/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

// Cross-quiz reporting: turns the attempts of several quizzes into per-student
// and per-semester performance rows. Roll number is the identity anchor — names
// are only ever displayed, never used to match a student across quizzes, since
// students capitalise and space them differently from one test to the next.

import type { AttemptFlags, GroupInfo, StudentInfo } from "./types";

export interface Band {
  label: string;
  /** Lowest percentage that falls in this band, inclusive. */
  min: number;
  color: BandColor;
}

export type BandColor = "emerald" | "blue" | "indigo" | "amber" | "rose" | "slate";

export const BAND_COLORS: BandColor[] = ["emerald", "blue", "indigo", "amber", "rose", "slate"];

export interface BandScheme {
  id: string;
  name: string;
  bands: Band[];
  isDefault: boolean;
}

export const DEFAULT_BANDS: Band[] = [
  { label: "Outstanding", min: 85, color: "emerald" },
  { label: "Very good", min: 70, color: "blue" },
  { label: "Good", min: 55, color: "indigo" },
  { label: "Satisfactory", min: 40, color: "amber" },
  { label: "Needs support", min: 0, color: "rose" },
];

/**
 * Sorts bands high to low, clamps the cut-offs, drops duplicates and forces the
 * lowest band down to 0 so that every percentage lands in exactly one band.
 */
export function normalizeBands(bands: Band[]): Band[] {
  const cleaned = bands
    .filter((b) => b && typeof b.label === "string" && b.label.trim())
    .map((b) => ({
      label: b.label.trim().slice(0, 40),
      min: Math.min(100, Math.max(0, Math.round(Number(b.min) || 0))),
      color: BAND_COLORS.includes(b.color) ? b.color : "slate",
    }))
    .sort((a, b) => b.min - a.min);

  const out: Band[] = [];
  for (const b of cleaned) {
    if (out.some((x) => x.min === b.min)) continue; // first one at this cut-off wins
    out.push(b);
  }
  if (!out.length) return DEFAULT_BANDS.map((b) => ({ ...b }));
  out[out.length - 1] = { ...out[out.length - 1], min: 0 };
  return out;
}

export function bandFor(percent: number, bands: Band[]): Band {
  for (const b of bands) {
    if (percent >= b.min) return b;
  }
  return bands[bands.length - 1];
}

/** Upper edge of a band, for display ("70–84%"). */
export function bandRange(bands: Band[], i: number): [number, number] {
  const min = bands[i].min;
  const max = i === 0 ? 100 : Math.max(min, bands[i - 1].min - 1);
  return [min, max];
}

export interface ReportQuiz {
  id: string;
  title: string;
  created_at: string;
  group_mode: boolean;
  /** false for surveys and other unscored quizzes; absent means scored. */
  scored?: boolean;
}

export interface ReportAttempt {
  id: string;
  quiz_id: string;
  student: StudentInfo;
  group_info: GroupInfo | null;
  score: number | null;
  max_score: number | null;
  flags: AttemptFlags | null;
  submitted_at: string;
}

/** Equal weight per quiz, or every mark counts the same across the whole set. */
export type Weighting = "equal" | "marks";
/** A quiz a student never sat: leave it out of their average, or score it zero. */
export type Missing = "exclude" | "zero";
/** Which attempt counts when a quiz allowed several tries. */
export type Repeats = "best" | "latest";

export interface ReportOptions {
  weighting: Weighting;
  missing: Missing;
  repeats: Repeats;
  bands: Band[];
  /** Restrict to one semester, or report on all of them. */
  semester: number | "all";
}

export const DEFAULT_OPTIONS: Omit<ReportOptions, "bands"> = {
  weighting: "equal",
  missing: "exclude",
  repeats: "best",
  semester: "all",
};

export interface StudentQuizResult {
  quizId: string;
  score: number;
  max: number;
  percent: number;
  late: boolean;
  /** Credited through a group submission rather than an individual one. */
  viaGroup: string | null;
  submittedAt: string;
  /** Attempts on this quiz that were set aside by the `repeats` rule. */
  discarded: number;
}

export interface StudentReportRow {
  roll: string;
  name: string;
  /** Every spelling this roll number submitted under, most recent first. */
  nameVariants: string[];
  semester: number;
  semesters: number[];
  byQuiz: Record<string, StudentQuizResult>;
  attempted: number;
  missed: number;
  totalScore: number;
  totalMax: number;
  percent: number;
  band: Band;
  lateCount: number;
  groupCount: number;
}

export interface SemesterReportRow {
  semester: number;
  students: number;
  /** Mean of the students' overall percentages. */
  average: number;
  median: number;
  best: number;
  worst: number;
  /** Attempts sat, out of students × quizzes. */
  participation: number;
  bandCounts: { band: Band; count: number }[];
  /** Average percentage per quiz for this semester, keyed by quiz id. */
  byQuiz: Record<string, { average: number; sat: number }>;
}

export interface Report {
  quizzes: ReportQuiz[];
  students: StudentReportRow[];
  semesters: SemesterReportRow[];
  overall: SemesterReportRow | null;
  /** Quizzes in the selection that nobody has submitted yet. */
  emptyQuizzes: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function attemptPercent(a: ReportAttempt): number {
  const max = Number(a.max_score) || 0;
  if (!max) return 0;
  return ((Number(a.score) || 0) / max) * 100;
}

/** Everyone an attempt should be credited to — the group's whole team, or one student. */
function participants(a: ReportAttempt): { roll: string; name: string; semester: number }[] {
  if (a.group_info) {
    return a.group_info.members.map((m) => ({
      roll: m.roll,
      name: m.name,
      semester: a.group_info!.semester,
    }));
  }
  return [{ roll: a.student.rollNorm, name: a.student.name, semester: a.student.semester }];
}

function pickMode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[values.length - 1];
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function buildReport(
  quizzes: ReportQuiz[],
  attempts: ReportAttempt[],
  options: ReportOptions
): Report {
  const bands = normalizeBands(options.bands);
  // A survey carries no marks, so including it would drag every average towards
  // zero. Unscored quizzes are dropped before anything is totalled.
  const scoredQuizzes = quizzes.filter((z) => z.scored !== false);
  const quizIds = scoredQuizzes.map((z) => z.id);
  const quizSet = new Set(quizIds);
  const relevant = attempts.filter((a) => quizSet.has(a.quiz_id));

  // Marks a quiz is out of — taken from its attempts, which all share a max.
  const quizMax = new Map<string, number>();
  for (const a of relevant) {
    const max = Number(a.max_score) || 0;
    if (max > (quizMax.get(a.quiz_id) ?? 0)) quizMax.set(a.quiz_id, max);
  }

  interface Acc {
    roll: string;
    names: { name: string; at: number }[];
    semesters: { semester: number; at: number }[];
    byQuiz: Record<string, StudentQuizResult>;
  }
  const acc = new Map<string, Acc>();

  for (const a of relevant) {
    const at = new Date(a.submitted_at).getTime() || 0;
    const percent = attemptPercent(a);
    for (const p of participants(a)) {
      if (!p.roll) continue;
      let entry = acc.get(p.roll);
      if (!entry) {
        entry = { roll: p.roll, names: [], semesters: [], byQuiz: {} };
        acc.set(p.roll, entry);
      }
      entry.names.push({ name: p.name, at });
      entry.semesters.push({ semester: p.semester, at });

      const existing = entry.byQuiz[a.quiz_id];
      const candidate: StudentQuizResult = {
        quizId: a.quiz_id,
        score: Number(a.score) || 0,
        max: Number(a.max_score) || 0,
        percent,
        late: !!a.flags?.late,
        viaGroup: a.group_info ? a.group_info.name : null,
        submittedAt: a.submitted_at,
        discarded: 0,
      };
      if (!existing) {
        entry.byQuiz[a.quiz_id] = candidate;
        continue;
      }
      const keepNew =
        options.repeats === "best"
          ? candidate.percent > existing.percent
          : at >= new Date(existing.submittedAt).getTime();
      const discarded = existing.discarded + 1;
      entry.byQuiz[a.quiz_id] = keepNew ? { ...candidate, discarded } : { ...existing, discarded };
    }
  }

  const students: StudentReportRow[] = [];
  for (const entry of acc.values()) {
    const byRecent = [...entry.names].sort((x, y) => y.at - x.at);
    const nameVariants: string[] = [];
    for (const n of byRecent) {
      if (!nameVariants.some((v) => v.toLowerCase() === n.name.toLowerCase())) nameVariants.push(n.name);
    }
    const semesterValues = [...entry.semesters].sort((x, y) => y.at - x.at).map((s) => s.semester);
    const semester = pickMode(semesterValues);
    const semesters = [...new Set(semesterValues)].sort((a, b) => a - b);

    const counted = options.missing === "zero" ? quizIds : quizIds.filter((id) => entry.byQuiz[id]);
    const results = counted.map((id) => entry.byQuiz[id]);
    const attempted = quizIds.filter((id) => entry.byQuiz[id]).length;

    let percent = 0;
    let totalScore = 0;
    let totalMax = 0;
    for (const [i, r] of results.entries()) {
      totalScore += r?.score ?? 0;
      totalMax += r?.max ?? quizMax.get(counted[i]) ?? 0;
    }
    if (options.weighting === "marks") {
      percent = totalMax ? (totalScore / totalMax) * 100 : 0;
    } else if (counted.length) {
      percent = results.reduce((s, r) => s + (r?.percent ?? 0), 0) / counted.length;
    }

    students.push({
      roll: entry.roll,
      name: nameVariants[0] ?? entry.roll,
      nameVariants,
      semester,
      semesters,
      byQuiz: entry.byQuiz,
      attempted,
      missed: quizIds.length - attempted,
      totalScore: round1(totalScore),
      totalMax: round1(totalMax),
      percent: round1(percent),
      band: bandFor(percent, bands),
      lateCount: Object.values(entry.byQuiz).filter((r) => r.late).length,
      groupCount: Object.values(entry.byQuiz).filter((r) => r.viaGroup).length,
    });
  }

  const inScope =
    options.semester === "all" ? students : students.filter((s) => s.semester === options.semester);

  inScope.sort((a, b) => b.percent - a.percent || a.roll.localeCompare(b.roll));

  const summarise = (rows: StudentReportRow[], semester: number): SemesterReportRow => {
    const percents = rows.map((r) => r.percent);
    const sat = rows.reduce((s, r) => s + r.attempted, 0);
    const byQuiz: Record<string, { average: number; sat: number }> = {};
    for (const id of quizIds) {
      const taken = rows.map((r) => r.byQuiz[id]).filter(Boolean) as StudentQuizResult[];
      byQuiz[id] = {
        average: taken.length ? round1(taken.reduce((s, r) => s + r.percent, 0) / taken.length) : 0,
        sat: taken.length,
      };
    }
    return {
      semester,
      students: rows.length,
      average: percents.length ? round1(percents.reduce((s, p) => s + p, 0) / percents.length) : 0,
      median: round1(median(percents)),
      best: percents.length ? round1(Math.max(...percents)) : 0,
      worst: percents.length ? round1(Math.min(...percents)) : 0,
      participation: rows.length && quizIds.length ? round1((sat / (rows.length * quizIds.length)) * 100) : 0,
      bandCounts: bands.map((band) => ({
        band,
        count: rows.filter((r) => r.band.label === band.label && r.band.min === band.min).length,
      })),
      byQuiz,
    };
  };

  const semesterNumbers = [...new Set(inScope.map((s) => s.semester))].sort((a, b) => a - b);
  const semesters = semesterNumbers.map((n) =>
    summarise(inScope.filter((s) => s.semester === n), n)
  );

  return {
    quizzes: scoredQuizzes,
    students: inScope,
    semesters,
    overall: inScope.length ? summarise(inScope, 0) : null,
    emptyQuizzes: quizIds.filter((id) => !relevant.some((a) => a.quiz_id === id)),
  };
}
