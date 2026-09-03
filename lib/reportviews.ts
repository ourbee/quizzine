/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

// The two ways a teacher reads a term's marks that the cross-quiz table cannot
// answer on its own: one student down the page, and one semester across it.
//
// None of this re-derives marks. `buildReport` already turns quizzes and
// attempts into per-student rows, so each view here decides which quizzes are
// in scope, hands that subset to `buildReport`, and arranges what comes back.
// Two places computing a percentage is two places for them to disagree.

import { participants, type AliasMap, type ReportAttempt, type ReportQuiz, type Report, type StudentQuizResult, type StudentReportRow } from "./report.ts";

/** Quiz ids a roll number sat, individually or credited through a group. */
export function quizzesSatBy(
  roll: string,
  attempts: ReportAttempt[],
  aliases: AliasMap = {}
): Set<string> {
  const ids = new Set<string>();
  for (const a of attempts) {
    if (participants(a, aliases).some((p) => p.roll === roll)) ids.add(a.quiz_id);
  }
  return ids;
}

/**
 * Quiz ids a roll number sat while registered in one semester. A student who
 * moves up mid-year has work under both, and each belongs to its own semester.
 */
export function quizzesSatBySemester(
  roll: string,
  semester: number,
  attempts: ReportAttempt[],
  aliases: AliasMap = {}
): Set<string> {
  const ids = new Set<string>();
  for (const a of attempts) {
    if (participants(a, aliases).some((p) => p.roll === roll && p.semester === semester)) {
      ids.add(a.quiz_id);
    }
  }
  return ids;
}

/** Semesters a roll number has submitted under, ascending. */
export function semestersSatBy(
  roll: string,
  attempts: ReportAttempt[],
  aliases: AliasMap = {}
): number[] {
  const set = new Set<number>();
  for (const a of attempts) {
    for (const p of participants(a, aliases)) if (p.roll === roll) set.add(p.semester);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Quiz ids a semester actually sat — the closest thing the data has to "the
 * quizzes assigned to that semester", since a quiz is never labelled with one.
 */
export function quizzesForSemester(
  semester: number,
  attempts: ReportAttempt[],
  aliases: AliasMap = {}
): Set<string> {
  const ids = new Set<string>();
  for (const a of attempts) {
    if (participants(a, aliases).some((p) => p.semester === semester)) ids.add(a.quiz_id);
  }
  return ids;
}

/** Every semester anyone submitted under, ascending. */
export function semestersPresent(attempts: ReportAttempt[], aliases: AliasMap = {}): number[] {
  const set = new Set<number>();
  for (const a of attempts) for (const p of participants(a, aliases)) set.add(p.semester);
  return [...set].sort((a, b) => a - b);
}

/** Keeps the quizzes whose ids are in the set, in their original order. */
export function pickQuizzes(quizzes: ReportQuiz[], ids: Set<string> | string[]): ReportQuiz[] {
  const set = ids instanceof Set ? ids : new Set(ids);
  return quizzes.filter((z) => set.has(z.id));
}

/** Matches a student on either spelling of their name or on their roll number. */
export function matchStudent(
  row: { name: string; roll: string; nameVariants?: string[] },
  search: string
): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const hay = [row.name, row.roll, ...(row.nameVariants ?? [])].join(" ").toLowerCase();
  return hay.includes(needle);
}

export type StudentSort = "rank" | "lowest" | "name" | "roll" | "sat" | "semester";

export const STUDENT_SORTS: [StudentSort, string][] = [
  ["rank", "Highest marks first"],
  ["lowest", "Lowest marks first"],
  ["name", "Name A–Z"],
  ["roll", "Roll number"],
  ["sat", "Most quizzes sat"],
  ["semester", "Semester"],
];

export function sortStudents(rows: StudentReportRow[], sort: StudentSort): StudentReportRow[] {
  const byName = (a: StudentReportRow, b: StudentReportRow) => a.name.localeCompare(b.name);
  return [...rows].sort((a, b) => {
    switch (sort) {
      case "lowest":
        return a.percent - b.percent || byName(a, b);
      case "name":
        return byName(a, b);
      case "roll":
        return a.roll.localeCompare(b.roll, undefined, { numeric: true });
      case "sat":
        return b.attempted - a.attempted || b.percent - a.percent || byName(a, b);
      case "semester":
        return a.semester - b.semester || b.percent - a.percent || byName(a, b);
      default:
        return b.percent - a.percent || byName(a, b);
    }
  });
}

/** One quiz on a student's record, set against how everyone else did on it. */
export interface StudentQuizLine {
  quiz: ReportQuiz;
  /** null when the student never sat this one. */
  result: StudentQuizResult | null;
  /** Average of everyone in scope who sat it, or null if nobody did. */
  classAverage: number | null;
  classSat: number;
  /** The student's percentage less the class average. */
  vsClass: number | null;
}

/**
 * A student's quizzes in the order they were set, each with the class average
 * beside it. A mark means little on its own — 58% is a good week or a bad one
 * depending entirely on what the rest of the class managed.
 */
export function studentQuizLines(report: Report, roll: string): StudentQuizLine[] {
  const student = report.students.find((s) => s.roll === roll);
  return report.quizzes.map((quiz) => {
    const result = student?.byQuiz[quiz.id] ?? null;
    const overall = report.overall?.byQuiz[quiz.id];
    const classSat = overall?.sat ?? 0;
    const classAverage = classSat ? overall!.average : null;
    return {
      quiz,
      result,
      classAverage,
      classSat,
      vsClass:
        result && classAverage !== null ? Math.round((result.percent - classAverage) * 10) / 10 : null,
    };
  });
}

export type QuizLineSort = "recent" | "oldest" | "title" | "best" | "worst";

export const QUIZ_LINE_SORTS: [QuizLineSort, string][] = [
  ["recent", "Most recent first"],
  ["oldest", "Oldest first"],
  ["title", "Title A–Z"],
  ["best", "Best mark first"],
  ["worst", "Worst mark first"],
];

/** Quizzes never sat always sink to the bottom — an empty row is not a low mark. */
export function sortStudentQuizLines(lines: StudentQuizLine[], sort: QuizLineSort): StudentQuizLine[] {
  const at = (l: StudentQuizLine) => new Date(l.quiz.created_at).getTime() || 0;
  return [...lines].sort((a, b) => {
    if (sort === "best" || sort === "worst") {
      if (!a.result && !b.result) return at(b) - at(a);
      if (!a.result) return 1;
      if (!b.result) return -1;
      return sort === "best" ? b.result.percent - a.result.percent : a.result.percent - b.result.percent;
    }
    if (sort === "title") return a.quiz.title.localeCompare(b.quiz.title);
    if (sort === "oldest") return at(a) - at(b);
    return at(b) - at(a);
  });
}

/** One quiz as a semester sat it. */
export interface SemesterQuizLine {
  quiz: ReportQuiz;
  average: number;
  median: number;
  best: number;
  worst: number;
  sat: number;
  missed: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Quiz by quiz for one cohort, with the spread the summary table leaves out.
 * A quiz averaging 55% because everyone scored 55, and one averaging 55%
 * because half the room scored 90 and half scored 20, are different problems.
 */
export function semesterQuizLines(quizzes: ReportQuiz[], students: StudentReportRow[]): SemesterQuizLine[] {
  return quizzes.map((quiz) => {
    const percents = students
      .map((s) => s.byQuiz[quiz.id])
      .filter((r): r is StudentQuizResult => !!r)
      .map((r) => r.percent);
    return {
      quiz,
      average: percents.length ? round1(percents.reduce((a, b) => a + b, 0) / percents.length) : 0,
      median: round1(median(percents)),
      best: percents.length ? round1(Math.max(...percents)) : 0,
      worst: percents.length ? round1(Math.min(...percents)) : 0,
      sat: percents.length,
      missed: students.length - percents.length,
    };
  });
}

export type SemesterQuizSort = "recent" | "oldest" | "title" | "hardest" | "easiest" | "sat";

export const SEMESTER_QUIZ_SORTS: [SemesterQuizSort, string][] = [
  ["recent", "Most recent first"],
  ["oldest", "Oldest first"],
  ["title", "Title A–Z"],
  ["hardest", "Lowest average first"],
  ["easiest", "Highest average first"],
  ["sat", "Most sat"],
];

export function sortSemesterQuizLines(
  lines: SemesterQuizLine[],
  sort: SemesterQuizSort
): SemesterQuizLine[] {
  const at = (l: SemesterQuizLine) => new Date(l.quiz.created_at).getTime() || 0;
  return [...lines].sort((a, b) => {
    switch (sort) {
      case "title":
        return a.quiz.title.localeCompare(b.quiz.title);
      case "oldest":
        return at(a) - at(b);
      // A quiz nobody sat has an average of zero, which would otherwise head the
      // "hardest" list without a single mark behind it.
      case "hardest":
        return (a.sat ? 0 : 1) - (b.sat ? 0 : 1) || a.average - b.average || at(b) - at(a);
      case "easiest":
        return (a.sat ? 0 : 1) - (b.sat ? 0 : 1) || b.average - a.average || at(b) - at(a);
      case "sat":
        return b.sat - a.sat || at(b) - at(a);
      default:
        return at(b) - at(a);
    }
  });
}
