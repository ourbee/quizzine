/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * Strengths and weaknesses: what a student's marks say about the *topics* they
 * know, rather than the totals they scored.
 *
 * Every counted question contributes its marks to each tag it carries, so one
 * question about a Tennyson poem lifts or lowers Period: Victorian, Genre:
 * Poetry and Author: Tennyson at once. Buckets deliberately overlap; a tag's
 * percentage answers "how does this student do when this topic comes up", which
 * is exactly the question a teacher plans around.
 *
 * Two rules keep the output honest, and they matter more than the arithmetic:
 *
 * 1. Small buckets lie. Two wrong answers out of three is not a weakness, it is
 *    noise, and a report that calls it one sends a teacher off to reteach a
 *    topic on no evidence. Below `minEvidence` questions a tag is reported as
 *    "not enough evidence yet" — never hidden, because knowing what has not
 *    been tested enough is itself worth having.
 *
 * 2. "Weak" has three meanings, and they disagree usefully. Against the
 *    student's own average it says what to work on next; against a pass mark it
 *    says whether they are ready; against the class it says whether the problem
 *    is the student or the teaching. All three are computed, none is collapsed
 *    into a single verdict.
 *
 * Only auto-marked questions can be counted. Typed answers are marked as a
 * whole attempt rather than question by question, so they have no per-question
 * result to attribute — they are counted as unanalysable and reported as such.
 */

import { canonicalRoll, type AliasMap, type Repeats } from "./report.ts";
import { DIFFICULTY_DIMENSION, difficultyLabel, formatTag, parseTag, tagKey } from "./tags.ts";
import type { GroupInfo, PerQuestionResult, StudentInfo } from "./types";

export interface AnalyticsQuestion {
  id: string;
  text: string;
  tags: string[];
  difficulty?: number;
  points: number;
  /** false for polls, surveys and anything else collected but not scored. */
  graded: boolean;
  /** mcq and multi only — the kinds with a per-question mark to attribute. */
  autoMarked: boolean;
}

export interface AnalyticsQuiz {
  id: string;
  title: string;
  created_at: string;
  questions: AnalyticsQuestion[];
}

export interface AnalyticsAttempt {
  id: string;
  quiz_id: string;
  student: StudentInfo;
  group_info: GroupInfo | null;
  per_question: PerQuestionResult[] | null;
  score: number | null;
  max_score: number | null;
  submitted_at: string;
}

export interface AnalyticsOptions {
  /** Fewest counted questions before a tag is called a strength or a weakness. */
  minEvidence: number;
  /** Percentage points away from the student's own average that counts as a real gap. */
  margin: number;
  /** Below this percentage a tag is flagged as not yet exam-ready. */
  passMark: number;
  repeats: Repeats;
  semester: number | "all";
  aliases?: AliasMap;
  /** Report on these roll numbers only — the group view. Empty means everyone. */
  rolls?: string[];
}

export const DEFAULT_ANALYTICS: AnalyticsOptions = {
  minEvidence: 5,
  margin: 10,
  passMark: 40,
  repeats: "best",
  semester: "all",
};

export type Verdict = "strength" | "weakness" | "steady" | "insufficient";

interface Tally {
  attempted: number;
  correct: number;
  awarded: number;
  possible: number;
  /** Per-quiz totals, for the trend line. */
  byQuiz: Map<string, { attempted: number; awarded: number; possible: number }>;
}

const newTally = (): Tally => ({ attempted: 0, correct: 0, awarded: 0, possible: 0, byQuiz: new Map() });

function add(tally: Tally, quizId: string, awarded: number, possible: number, correct: boolean) {
  tally.attempted += 1;
  tally.awarded += awarded;
  tally.possible += possible;
  if (correct) tally.correct += 1;
  const row = tally.byQuiz.get(quizId) ?? { attempted: 0, awarded: 0, possible: 0 };
  row.attempted += 1;
  row.awarded += awarded;
  row.possible += possible;
  tally.byQuiz.set(quizId, row);
}

const pct = (awarded: number, possible: number) => (possible > 0 ? (awarded / possible) * 100 : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface TrendPoint {
  quizId: string;
  percent: number;
  attempted: number;
}

export interface TagRow {
  /** Stored tag, e.g. "Period: Victorian". */
  tag: string;
  dimension: string;
  value: string;
  attempted: number;
  correct: number;
  awarded: number;
  possible: number;
  percent: number;
}

export interface StudentTagRow extends TagRow {
  /** Percentage points above (+) or below (−) this student's own average. */
  vsSelf: number;
  /** Against everyone else in the selection on the same tag; null when nobody else has data. */
  vsClass: number | null;
  classPercent: number | null;
  /** Below the pass mark on enough questions to mean it. */
  belowPass: boolean;
  verdict: Verdict;
  trend: TrendPoint[];
  /** Later quizzes minus earlier ones, in percentage points; null when too thin to say. */
  delta: number | null;
}

export interface MissedQuestion {
  quizId: string;
  quizTitle: string;
  qid: string;
  text: string;
  tags: string[];
  difficulty?: number;
}

export interface StudentQuizLine {
  quizId: string;
  percent: number;
  awarded: number;
  possible: number;
  submittedAt: string;
  viaGroup: string | null;
}

export interface StudentProfile {
  roll: string;
  name: string;
  nameVariants: string[];
  semester: number;
  /** Auto-marked totals across the selection — the baseline every gap is measured from. */
  attempted: number;
  correct: number;
  awarded: number;
  possible: number;
  percent: number;
  quizzesSat: number;
  quizLines: StudentQuizLine[];
  rows: StudentTagRow[];
  difficultyRows: StudentTagRow[];
  strengths: StudentTagRow[];
  weaknesses: StudentTagRow[];
  insufficient: StudentTagRow[];
  misses: MissedQuestion[];
}

export interface ClassTagRow extends TagRow {
  /** Students with any data on this tag. */
  students: number;
  /** Students who have met the evidence threshold on it. */
  reliableStudents: number;
  belowPass: boolean;
  /** Students below the pass mark on this tag, among the reliable ones. */
  strugglingStudents: number;
}

export interface AnalyticsResult {
  quizzes: { id: string; title: string; created_at: string; taggedQuestions: number; totalQuestions: number }[];
  students: StudentProfile[];
  classRows: ClassTagRow[];
  classDifficultyRows: ClassTagRow[];
  /** Auto-marked, scored questions in the selection that carry no tag at all. */
  untaggedQuestions: number;
  /** Typed answers, which have no per-question mark to attribute. */
  unanalysableQuestions: number;
  options: AnalyticsOptions;
}

/** Everyone an attempt counts for — a group submission credits every member. */
function participants(a: AnalyticsAttempt, aliases: AliasMap) {
  const rows = a.group_info
    ? a.group_info.members.map((m) => ({ roll: m.roll, name: m.name, semester: a.group_info!.semester }))
    : [{ roll: a.student.rollNorm, name: a.student.name, semester: a.student.semester }];
  return rows.map((r) => ({ ...r, roll: canonicalRoll(r.roll, aliases) }));
}

/**
 * One attempt per student per quiz. A quiz that allowed several tries would
 * otherwise let a student's repeated topics outvote everyone else's.
 */
function pickAttempts(
  attempts: AnalyticsAttempt[],
  repeats: Repeats,
  aliases: AliasMap
): Map<string, Map<string, AnalyticsAttempt>> {
  const byStudent = new Map<string, Map<string, AnalyticsAttempt>>();
  for (const a of attempts) {
    if (!a.per_question) continue;
    for (const p of participants(a, aliases)) {
      if (!p.roll) continue;
      let quizzes = byStudent.get(p.roll);
      if (!quizzes) {
        quizzes = new Map();
        byStudent.set(p.roll, quizzes);
      }
      const held = quizzes.get(a.quiz_id);
      if (!held) {
        quizzes.set(a.quiz_id, a);
        continue;
      }
      const better =
        repeats === "latest"
          ? new Date(a.submitted_at).getTime() > new Date(held.submitted_at).getTime()
          : pct(Number(a.score) || 0, Number(a.max_score) || 0) > pct(Number(held.score) || 0, Number(held.max_score) || 0);
      if (better) quizzes.set(a.quiz_id, a);
    }
  }
  return byStudent;
}

/**
 * Earlier quizzes against later ones. The selection is split down the middle by
 * date rather than fitted with a line, because five noisy points do not support
 * a slope and a teacher reads "was 48, now 71" more readily than a gradient.
 */
function trendDelta(trend: TrendPoint[], minEvidence: number): number | null {
  if (trend.length < 2) return null;
  const counted = trend.reduce((n, t) => n + t.attempted, 0);
  if (counted < minEvidence) return null;
  const half = Math.floor(trend.length / 2);
  const early = trend.slice(0, half);
  const late = trend.slice(trend.length - half);
  const mean = (xs: TrendPoint[]) => xs.reduce((s, x) => s + x.percent, 0) / (xs.length || 1);
  return round1(mean(late) - mean(early));
}

function toRow(tag: string, tally: Tally): TagRow {
  const parsed = parseTag(tag) ?? { dimension: "Topic", value: tag };
  return {
    tag,
    dimension: parsed.dimension,
    value: parsed.value,
    attempted: tally.attempted,
    correct: tally.correct,
    awarded: round1(tally.awarded),
    possible: round1(tally.possible),
    percent: round1(pct(tally.awarded, tally.possible)),
  };
}

export function buildAnalytics(
  quizzes: AnalyticsQuiz[],
  attempts: AnalyticsAttempt[],
  options: AnalyticsOptions
): AnalyticsResult {
  const aliases = options.aliases ?? {};
  const order = [...quizzes].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const quizIndex = new Map(order.map((z, i) => [z.id, i]));
  const questionIndex = new Map<string, Map<string, AnalyticsQuestion>>();
  for (const z of order) questionIndex.set(z.id, new Map(z.questions.map((qn) => [qn.id, qn])));

  let untaggedQuestions = 0;
  let unanalysableQuestions = 0;
  for (const z of order) {
    for (const qn of z.questions) {
      if (!qn.graded) continue;
      if (!qn.autoMarked) unanalysableQuestions += 1;
      else if (!qn.tags.length && qn.difficulty === undefined) untaggedQuestions += 1;
    }
  }

  const wanted = options.rolls?.length
    ? new Set(options.rolls.map((r) => canonicalRoll(r, aliases)))
    : null;

  const chosen = pickAttempts(attempts, options.repeats, aliases);

  interface Working {
    roll: string;
    names: { name: string; at: number }[];
    semester: number;
    overall: Tally;
    tags: Map<string, Tally>;
    difficulty: Map<string, Tally>;
    tagLabels: Map<string, string>;
    quizLines: StudentQuizLine[];
    misses: MissedQuestion[];
  }

  const working = new Map<string, Working>();
  const classTags = new Map<string, Tally>();
  const classDifficulty = new Map<string, Tally>();
  const classLabels = new Map<string, string>();
  // Per tag, which students have data and how much — for the class row's counts.
  const tagStudents = new Map<string, Map<string, { attempted: number; percent: number }>>();

  for (const [roll, quizMap] of chosen) {
    if (wanted && !wanted.has(roll)) continue;

    for (const attempt of quizMap.values()) {
      const quiz = order.find((z) => z.id === attempt.quiz_id);
      if (!quiz) continue;
      const lookup = questionIndex.get(quiz.id)!;
      const who = participants(attempt, aliases).find((p) => p.roll === roll);
      if (!who) continue;
      if (options.semester !== "all" && who.semester !== options.semester) continue;

      let entry = working.get(roll);
      if (!entry) {
        entry = {
          roll,
          names: [],
          semester: who.semester,
          overall: newTally(),
          tags: new Map(),
          difficulty: new Map(),
          tagLabels: new Map(),
          quizLines: [],
          misses: [],
        };
        working.set(roll, entry);
      }
      entry.names.push({ name: who.name, at: new Date(attempt.submitted_at).getTime() });

      let lineAwarded = 0;
      let linePossible = 0;

      for (const per of attempt.per_question ?? []) {
        const qn = lookup.get(per.qid);
        if (!qn || !qn.graded || !qn.autoMarked) continue;
        // Not yet marked: no result to attribute either way.
        if (per.pending || per.ungraded) continue;

        const awarded = Number(per.awarded) || 0;
        const possible = qn.points;
        const right = per.correct === true;
        lineAwarded += awarded;
        linePossible += possible;

        add(entry.overall, quiz.id, awarded, possible, right);

        for (const tag of qn.tags) {
          const parsed = parseTag(tag);
          if (!parsed) continue;
          const key = tagKey(parsed);
          entry.tagLabels.set(key, tag);
          classLabels.set(key, tag);
          let tally = entry.tags.get(key);
          if (!tally) {
            tally = newTally();
            entry.tags.set(key, tally);
          }
          add(tally, quiz.id, awarded, possible, right);

          let pooled = classTags.get(key);
          if (!pooled) {
            pooled = newTally();
            classTags.set(key, pooled);
          }
          add(pooled, quiz.id, awarded, possible, right);
        }

        if (qn.difficulty !== undefined) {
          const label = formatTag({
            dimension: DIFFICULTY_DIMENSION,
            value: `${qn.difficulty} — ${difficultyLabel(qn.difficulty)}`,
          });
          const key = tagKey(parseTag(label)!);
          entry.tagLabels.set(key, label);
          classLabels.set(key, label);
          let tally = entry.difficulty.get(key);
          if (!tally) {
            tally = newTally();
            entry.difficulty.set(key, tally);
          }
          add(tally, quiz.id, awarded, possible, right);

          let pooled = classDifficulty.get(key);
          if (!pooled) {
            pooled = newTally();
            classDifficulty.set(key, pooled);
          }
          add(pooled, quiz.id, awarded, possible, right);
        }

        if (!right && entry.misses.length < 200) {
          entry.misses.push({
            quizId: quiz.id,
            quizTitle: quiz.title,
            qid: qn.id,
            text: qn.text,
            tags: qn.tags,
            difficulty: qn.difficulty,
          });
        }
      }

      if (linePossible > 0) {
        entry.quizLines.push({
          quizId: quiz.id,
          percent: round1(pct(lineAwarded, linePossible)),
          awarded: round1(lineAwarded),
          possible: round1(linePossible),
          submittedAt: attempt.submitted_at,
          viaGroup: attempt.group_info?.name ?? null,
        });
      }
    }
  }

  // Second pass: per-student percentages per tag feed the class row's counts.
  for (const entry of working.values()) {
    for (const [key, tally] of [...entry.tags, ...entry.difficulty]) {
      let per = tagStudents.get(key);
      if (!per) {
        per = new Map();
        tagStudents.set(key, per);
      }
      per.set(entry.roll, { attempted: tally.attempted, percent: pct(tally.awarded, tally.possible) });
    }
  }

  const buildStudentRows = (
    entry: Working,
    source: Map<string, Tally>,
    selfPercent: number
  ): StudentTagRow[] => {
    const rows: StudentTagRow[] = [];
    for (const [key, tally] of source) {
      const label = entry.tagLabels.get(key) ?? key;
      const base = toRow(label, tally);
      const trend: TrendPoint[] = [...tally.byQuiz.entries()]
        .sort((a, b) => (quizIndex.get(a[0]) ?? 0) - (quizIndex.get(b[0]) ?? 0))
        .map(([quizId, v]) => ({
          quizId,
          percent: round1(pct(v.awarded, v.possible)),
          attempted: v.attempted,
        }));

      // The class figure a student is compared against excludes their own marks,
      // so a small cohort does not quietly measure them against themselves.
      const pooled = classTags.get(key) ?? classDifficulty.get(key);
      let classPercent: number | null = null;
      if (pooled) {
        const othersAwarded = pooled.awarded - tally.awarded;
        const othersPossible = pooled.possible - tally.possible;
        classPercent = othersPossible > 0 ? round1(pct(othersAwarded, othersPossible)) : null;
      }

      const enough = base.attempted >= options.minEvidence;
      const vsSelf = round1(base.percent - selfPercent);
      const verdict: Verdict = !enough
        ? "insufficient"
        : vsSelf >= options.margin
          ? "strength"
          : vsSelf <= -options.margin
            ? "weakness"
            : "steady";

      rows.push({
        ...base,
        vsSelf,
        vsClass: classPercent === null ? null : round1(base.percent - classPercent),
        classPercent,
        belowPass: enough && base.percent < options.passMark,
        verdict,
        trend,
        delta: trendDelta(trend, options.minEvidence),
      });
    }
    return rows.sort((a, b) => a.dimension.localeCompare(b.dimension) || a.value.localeCompare(b.value));
  };

  const students: StudentProfile[] = [];
  for (const entry of working.values()) {
    const selfPercent = round1(pct(entry.overall.awarded, entry.overall.possible));
    const rows = buildStudentRows(entry, entry.tags, selfPercent);
    const difficultyRows = buildStudentRows(entry, entry.difficulty, selfPercent);

    // Most recent spelling first — the same convention the marks report uses.
    const nameVariants: string[] = [];
    for (const n of [...entry.names].sort((a, b) => b.at - a.at)) {
      if (!nameVariants.includes(n.name)) nameVariants.push(n.name);
    }

    const weakTagKeys = new Set(
      rows.filter((r) => r.verdict === "weakness" || r.belowPass).map((r) => tagKey(parseTag(r.tag)!))
    );

    students.push({
      roll: entry.roll,
      name: nameVariants[0] ?? entry.roll,
      nameVariants,
      semester: entry.semester,
      attempted: entry.overall.attempted,
      correct: entry.overall.correct,
      awarded: round1(entry.overall.awarded),
      possible: round1(entry.overall.possible),
      percent: selfPercent,
      quizzesSat: entry.quizLines.length,
      quizLines: entry.quizLines.sort(
        (a, b) => (quizIndex.get(a.quizId) ?? 0) - (quizIndex.get(b.quizId) ?? 0)
      ),
      rows,
      difficultyRows,
      strengths: rows.filter((r) => r.verdict === "strength").sort((a, b) => b.percent - a.percent),
      weaknesses: rows
        .filter((r) => r.verdict === "weakness" || r.belowPass)
        .sort((a, b) => a.percent - b.percent),
      insufficient: rows.filter((r) => r.verdict === "insufficient").sort((a, b) => b.attempted - a.attempted),
      // Wrong answers are only worth listing where the topic is actually weak —
      // otherwise every student gets an undifferentiated pile of slips.
      misses: entry.misses.filter((m) =>
        m.tags.some((t) => {
          const parsed = parseTag(t);
          return parsed ? weakTagKeys.has(tagKey(parsed)) : false;
        })
      ),
    });
  }

  students.sort((a, b) => b.percent - a.percent || a.roll.localeCompare(b.roll));

  const buildClassRows = (source: Map<string, Tally>): ClassTagRow[] =>
    [...source.entries()]
      .map(([key, tally]) => {
        const label = classLabels.get(key) ?? key;
        const per = tagStudents.get(key);
        const reliable = per ? [...per.values()].filter((v) => v.attempted >= options.minEvidence) : [];
        const base = toRow(label, tally);
        return {
          ...base,
          students: per ? per.size : 0,
          reliableStudents: reliable.length,
          belowPass: base.percent < options.passMark,
          strugglingStudents: reliable.filter((v) => v.percent < options.passMark).length,
        };
      })
      .sort((a, b) => a.dimension.localeCompare(b.dimension) || a.value.localeCompare(b.value));

  return {
    quizzes: order.map((z) => ({
      id: z.id,
      title: z.title,
      created_at: z.created_at,
      taggedQuestions: z.questions.filter((qn) => qn.tags.length || qn.difficulty !== undefined).length,
      totalQuestions: z.questions.length,
    })),
    students,
    classRows: buildClassRows(classTags),
    classDifficultyRows: buildClassRows(classDifficulty),
    untaggedQuestions,
    unanalysableQuestions,
    options,
  };
}

/** Group flat tag rows for display, dimension by dimension. */
export function groupByDimension<T extends TagRow>(rows: T[]): { dimension: string; rows: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    groups.set(row.dimension, [...(groups.get(row.dimension) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([dimension, list]) => ({ dimension, rows: list.sort((a, b) => b.percent - a.percent) }))
    .sort((a, b) => a.dimension.localeCompare(b.dimension));
}
