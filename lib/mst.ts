/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * Multistage testing — the adaptive exam.
 *
 * The paper is delivered in stages rather than question by question. Everyone
 * begins on the same stage; how they do on it decides whether the next stage is
 * drawn from harder or easier stock, and so on until the paper is spent.
 *
 * Adaptive BY BLOCK, not by question, and that choice is the whole design. A
 * question-by-question test cannot let a student go back and change an answer,
 * because that answer has already decided what came next — which would gut the
 * palette the exam interface exists to rehearse. Staging keeps navigation free
 * *within* the stage a student is sitting, and makes only the boundary between
 * stages one-way. Real examinations lock sections exactly this way, so the
 * restriction is part of the rehearsal rather than a compromise.
 *
 * Questions are drawn from the quiz's whole bank, so the file holds more
 * questions than anyone sits: 100 in the sheet, 50 in the exam.
 */

import { seededShuffle, hashSeed } from "./normalize.ts";
import { MAX_DIFFICULTY, MIN_DIFFICULTY } from "./tags.ts";
import type { Question } from "./types";

/** Difficulty assumed for a question whose Difficulty cell was left blank. */
export const ASSUMED_DIFFICULTY = 3;

export interface MstConfig {
  /** How many stages the paper runs to. */
  stages: number;
  /** Questions per stage — stages × perStage is what a student actually sits. */
  perStage: number;
  /** Difficulty of the routing stage everybody starts on. */
  startDifficulty: number;
  /** Percentage in a stage at or above which the next stage steps up. */
  routeUpAt: number;
  /** Percentage at or below which the next stage steps down. */
  routeDownAt: number;
  /**
   * "fixed" keeps each question's own marks, so a student is judged on the
   * percentage of what they were actually given. "byDifficulty" pays harder
   * questions more, which makes raw totals incomparable between students who
   * routed differently — the percentage is still sound, the total is not.
   */
  scoring: "fixed" | "byDifficulty";
  /**
   * Also report a Rasch ability estimate: one number placing the student on a
   * difficulty scale, independent of which questions they happened to be given.
   * Off by default — it is the honest way to compare two different papers, and
   * an easy number to over-read.
   */
  abilityScore: boolean;
}

export const DEFAULT_MST: MstConfig = {
  stages: 5,
  perStage: 10,
  startDifficulty: 3,
  routeUpAt: 70,
  routeDownAt: 40,
  scoring: "fixed",
  abilityScore: false,
};

const clampInt = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
};

export function normalizeMstConfig(raw: unknown): MstConfig {
  const r = (raw ?? {}) as Partial<MstConfig>;
  const routeDownAt = clampInt(r.routeDownAt, 0, 100, DEFAULT_MST.routeDownAt);
  // The two thresholds must leave a band in the middle that holds difficulty
  // steady, or a stage would step both up and down at once.
  const routeUpAt = Math.max(routeDownAt + 1, clampInt(r.routeUpAt, 1, 100, DEFAULT_MST.routeUpAt));
  return {
    stages: clampInt(r.stages, 1, 20, DEFAULT_MST.stages),
    perStage: clampInt(r.perStage, 1, 100, DEFAULT_MST.perStage),
    startDifficulty: clampInt(r.startDifficulty, MIN_DIFFICULTY, MAX_DIFFICULTY, DEFAULT_MST.startDifficulty),
    routeUpAt,
    routeDownAt,
    scoring: r.scoring === "byDifficulty" ? "byDifficulty" : "fixed",
    abilityScore: !!r.abilityScore,
  };
}

/** Marks a question is worth in an adaptive paper. */
export function mstPoints(qn: Pick<Question, "points" | "difficulty">, config: MstConfig): number {
  if (config.scoring !== "byDifficulty") return qn.points;
  return qn.difficulty ?? ASSUMED_DIFFICULTY;
}

export const difficultyOf = (qn: Pick<Question, "difficulty">): number => qn.difficulty ?? ASSUMED_DIFFICULTY;

export interface StageResult {
  /** Difficulty the stage was drawn at. */
  difficulty: number;
  awarded: number;
  possible: number;
  percent: number;
}

export interface MstState {
  /** Index of the stage the student is on now. */
  stage: number;
  /** Difficulty the current stage was drawn at. */
  difficulty: number;
  /** Question ids served, stage by stage — index 0 is the first stage. */
  served: string[][];
  /** One entry per stage already completed. */
  results: StageResult[];
  done: boolean;
}

/**
 * Draw one stage. Questions at the target difficulty come first; if the bank is
 * short of them the nearest levels fill the gap, closer levels first and easier
 * before harder at equal distance, so a thin bank degrades into a slightly
 * off-target stage rather than a short one.
 *
 * Order is deterministic unless a seed is given, which is what makes the first
 * stage identical for every student sitting the paper.
 */
export function planStage(
  bank: Question[],
  used: Set<string>,
  target: number,
  count: number,
  seed?: string
): string[] {
  const available = bank.filter((qn) => !used.has(qn.id));
  const ranked = available
    .map((qn, i) => {
      const d = difficultyOf(qn);
      return { qn, i, distance: Math.abs(d - target), harder: d > target ? 1 : 0 };
    })
    .sort((a, b) => a.distance - b.distance || a.harder - b.harder || a.i - b.i);

  const picked = ranked.slice(0, count).map((r) => r.qn.id);
  return seed ? seededShuffle(picked, hashSeed(seed)) : picked;
}

/** Where the next stage is drawn from, given how the last one went. */
export function routeNext(current: number, percent: number, config: MstConfig): number {
  let next = current;
  if (percent >= config.routeUpAt) next = current + 1;
  else if (percent <= config.routeDownAt) next = current - 1;
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, next));
}

/** Open a paper: the first stage, the same one for everybody. */
export function startMst(bank: Question[], config: MstConfig): MstState {
  const served = planStage(bank, new Set(), config.startDifficulty, config.perStage);
  return {
    stage: 0,
    difficulty: config.startDifficulty,
    served: [served],
    results: [],
    done: served.length === 0,
  };
}

/**
 * Close the current stage and draw the next. A paper also ends early when the
 * bank runs dry, which is the honest response to a teacher who asked for five
 * stages of ten from a bank of forty.
 */
export function advanceMst(
  state: MstState,
  bank: Question[],
  config: MstConfig,
  result: StageResult,
  seed?: string
): MstState {
  const results = [...state.results, result];
  const used = new Set(state.served.flat());

  if (results.length >= config.stages) {
    return { ...state, results, done: true };
  }

  const nextDifficulty = routeNext(state.difficulty, result.percent, config);
  const next = planStage(bank, used, nextDifficulty, config.perStage, seed);
  if (!next.length) return { ...state, results, done: true };

  return {
    stage: state.stage + 1,
    difficulty: nextDifficulty,
    served: [...state.served, next],
    results,
    done: false,
  };
}

export interface MstCapacity {
  /** Questions a student would sit if the bank allows it. */
  wanted: number;
  bank: number;
  /** Levels that cannot fill a full stage on their own. */
  thinLevels: { difficulty: number; available: number }[];
  warnings: string[];
}

/**
 * Whether a bank can actually sustain the routing asked of it. A level with
 * fewer questions than a stage needs is not fatal — neighbouring levels fill in
 * — but it means a student who routes there sits an off-target stage, which the
 * teacher should know before publishing rather than after.
 */
export function mstCapacity(bank: Question[], config: MstConfig): MstCapacity {
  const wanted = config.stages * config.perStage;
  const byLevel = new Map<number, number>();
  for (const qn of bank) {
    const d = difficultyOf(qn);
    byLevel.set(d, (byLevel.get(d) ?? 0) + 1);
  }
  const warnings: string[] = [];
  if (bank.length < wanted) {
    warnings.push(
      `This bank holds ${bank.length} questions but ${config.stages} stages of ${config.perStage} need ${wanted}. Papers will end early.`
    );
  }
  const thinLevels: { difficulty: number; available: number }[] = [];
  for (let d = MIN_DIFFICULTY; d <= MAX_DIFFICULTY; d++) {
    const available = byLevel.get(d) ?? 0;
    if (available < config.perStage) thinLevels.push({ difficulty: d, available });
  }
  const untagged = bank.filter((qn) => qn.difficulty === undefined).length;
  if (untagged) {
    warnings.push(
      `${untagged} question${untagged === 1 ? " has" : "s have"} no Difficulty, so ${untagged === 1 ? "it is" : "they are"} treated as level ${ASSUMED_DIFFICULTY}.`
    );
  }
  return { wanted, bank: bank.length, thinLevels, warnings };
}

/**
 * The questions a student was actually served, in the order they were served,
 * with their marks adjusted for the paper's scoring rule.
 *
 * Everything downstream — grading, the review page, the regrade after an edit —
 * works on this list rather than on the whole bank, because a student's paper
 * is only ever the part of the bank they were routed through.
 */
export function servedQuestions(bank: Question[], state: MstState | null, config: MstConfig): Question[] {
  if (!state) return [];
  const byId = new Map(bank.map((qn) => [qn.id, qn]));
  const out: Question[] = [];
  for (const id of state.served.flat()) {
    const qn = byId.get(id);
    if (!qn) continue; // removed from the bank since; the attempt keeps its marks
    const points = mstPoints(qn, config);
    out.push(points === qn.points ? qn : { ...qn, points });
  }
  return out;
}

/** Difficulty-and-outcome pairs for the ability estimate, from a marked paper. */
export function abilityResponses(
  served: Question[],
  per: { qid: string; correct?: boolean; pending?: boolean; ungraded?: boolean }[]
): { difficulty: number; correct: boolean }[] {
  const byId = new Map(served.map((qn) => [qn.id, qn]));
  const out: { difficulty: number; correct: boolean }[] = [];
  for (const p of per) {
    const qn = byId.get(p.qid);
    if (!qn || p.pending || p.ungraded || p.correct === undefined) continue;
    out.push({ difficulty: difficultyOf(qn), correct: p.correct === true });
  }
  return out;
}

/**
 * The current stage as the student may see it: no answer keys, no feedback, and
 * no hint of which difficulty it was drawn at. A student who could read their
 * own routing would be reading their own marks mid-exam.
 */
export function publicStage(bank: Question[], state: MstState) {
  const ids = state.served[state.stage] ?? [];
  const byId = new Map(bank.map((qn) => [qn.id, qn]));
  return ids
    .map((id) => byId.get(id))
    .filter((qn): qn is Question => !!qn)
    .map((qn) => ({
      id: qn.id,
      type: qn.type,
      text: qn.text,
      passage: qn.passage,
      passageTitle: qn.passageTitle,
      media: qn.media,
      points: qn.points,
      graded: qn.graded !== false,
      options: qn.options.map((o) => ({ key: o.key, text: o.text })),
    }));
}

// ---------- ability estimate ----------

/** A question's place on the difficulty scale: level 1–5 mapped to −2…+2 logits. */
export const difficultyLogit = (level: number): number => level - ASSUMED_DIFFICULTY;

export interface AbilityEstimate {
  /** Rasch ability in logits, clamped to ±3 where the estimate stops being meaningful. */
  theta: number;
  /** Standard error of that estimate — small samples give large ones. */
  se: number;
  /** Ability on a 0–100 scale, for reading rather than arithmetic. */
  scaled: number;
  /** True when every answer was right or every one wrong, so the estimate is a bound, not a value. */
  extreme: boolean;
  responses: number;
}

/**
 * Rasch (one-parameter) ability, by Newton–Raphson.
 *
 * The point of this over a percentage is that it does not depend on which
 * questions a student happened to be routed to: getting 60% of hard questions
 * right and 60% of easy ones are different achievements, and this separates
 * them. All-right and all-wrong scripts have no finite estimate, so they are
 * clamped and flagged rather than reported as a precise number.
 */
export function estimateAbility(responses: { difficulty: number; correct: boolean }[]): AbilityEstimate {
  const n = responses.length;
  if (!n) return { theta: 0, se: 0, scaled: 50, extreme: false, responses: 0 };

  const rights = responses.filter((r) => r.correct).length;
  const extreme = rights === 0 || rights === n;

  let theta = 0;
  for (let iter = 0; iter < 40; iter++) {
    let numerator = 0;
    let information = 0;
    for (const r of responses) {
      const p = 1 / (1 + Math.exp(-(theta - difficultyLogit(r.difficulty))));
      numerator += (r.correct ? 1 : 0) - p;
      information += p * (1 - p);
    }
    if (information < 1e-9) break;
    const step = numerator / information;
    theta += Math.max(-1, Math.min(1, step));
    if (Math.abs(step) < 1e-6) break;
  }
  theta = Math.min(3, Math.max(-3, theta));

  let information = 0;
  for (const r of responses) {
    const p = 1 / (1 + Math.exp(-(theta - difficultyLogit(r.difficulty))));
    information += p * (1 - p);
  }
  const se = information > 1e-9 ? 1 / Math.sqrt(information) : 3;

  return {
    theta: Math.round(theta * 100) / 100,
    se: Math.round(Math.min(3, se) * 100) / 100,
    scaled: Math.min(100, Math.max(0, Math.round(50 + theta * 15))),
    extreme,
    responses: n,
  };
}
