/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

// Allotted tests: every student on a roster is dealt their own question(s)
// from the quiz's bank, keyed by roll number. The map lives on the quiz in
// its own column — never inside `settings`, which partially reaches the
// browser through the public route. See SPEC-allotted-tests.md.

import { hashSeed, normRoll, seededShuffle } from "./normalize.ts";
import type { Question } from "./types";

export interface AllotmentEntry {
  /** Normalized via normRoll; rolls are digits-only by the start route's rule. */
  roll: string;
  /** The questions dealt to this roll, in the order the student sees them. */
  qids: string[];
  /** True when the teacher overrode the deal for this roll by hand. */
  manual?: boolean;
}

export interface Allotment {
  /** The whole roster sits one semester; the student never picks one. */
  semester: number;
  /** Questions dealt to each roll. */
  perStudent: number;
  /** Seed of the last deal, so it can be reproduced or re-dealt afresh. */
  seed: string;
  entries: AllotmentEntry[];
}

export interface RosterParse {
  /** Normalized, deduplicated, in first-seen order. */
  rolls: string[];
  /** Rolls that appeared more than once (each listed once). */
  duplicates: string[];
  /** Tokens that are not digits-only rolls, as typed. */
  invalid: string[];
}

/** A roll is digits only, 1–15 long — the same rule the start route enforces. */
const ROLL_RE = /^\d{1,15}$/;

/**
 * Read a pasted roster: one roll per line, or several to a line separated by
 * commas, spaces or tabs. Forgiving on separators, strict on what a roll is.
 */
export function parseRoster(text: string): RosterParse {
  const seen = new Set<string>();
  const dup = new Set<string>();
  const rolls: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const token = raw.trim();
    if (!token) continue;
    if (!ROLL_RE.test(token)) {
      invalid.push(token);
      continue;
    }
    const roll = normRoll(token);
    if (seen.has(roll)) {
      dup.add(roll);
      continue;
    }
    seen.add(roll);
    rolls.push(roll);
  }
  return { rolls, duplicates: [...dup], invalid };
}

/**
 * Deal `perStudent` questions to every roll, deterministically from the seed.
 * The bank is shuffled once, then dealt in consecutive runs, cycling back to
 * the start when the roster outnumbers it — so no student repeats a question
 * of their own (as long as perStudent ≤ bank size), and reuse across students
 * is spread as evenly as the arithmetic allows.
 */
export function dealAllotment(
  bankQids: string[],
  rolls: string[],
  perStudent: number,
  seed: string
): AllotmentEntry[] {
  if (!bankQids.length) return rolls.map((roll) => ({ roll, qids: [] }));
  const per = Math.max(1, Math.min(Math.floor(perStudent) || 1, bankQids.length));
  const deck = seededShuffle(bankQids, hashSeed(seed));
  return rolls.map((roll, i) => ({
    roll,
    qids: Array.from({ length: per }, (_, j) => deck[(i * per + j) % deck.length]),
  }));
}

/** A fresh seed for a deal or re-deal. */
export function newSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Coax whatever is in the quiz row into an Allotment, or null when there is
 * nothing usable. Entries pointing at questions no longer in the quiz keep
 * their roll but lose the dead qids — the coverage check then names them.
 */
export function normalizeAllotment(raw: unknown, validQids?: Set<string>): Allotment | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Partial<Allotment>;
  const semester = Number(a.semester);
  if (!Number.isInteger(semester)) return null;
  const entries: AllotmentEntry[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(a.entries) ? a.entries : []) {
    if (!e || typeof e.roll !== "string") continue;
    const roll = normRoll(e.roll);
    if (!roll || seen.has(roll)) continue;
    seen.add(roll);
    // Empty strings are the editor's "no question yet" hole; they never
    // survive into a stored allotment.
    const qids = (Array.isArray(e.qids) ? e.qids : []).filter(
      (id): id is string => typeof id === "string" && id.length > 0 && (!validQids || validQids.has(id))
    );
    entries.push({ roll, qids: [...new Set(qids)], ...(e.manual ? { manual: true } : {}) });
  }
  return {
    semester,
    perStudent: Math.max(1, Math.floor(Number(a.perStudent)) || 1),
    seed: typeof a.seed === "string" ? a.seed : "",
    entries,
  };
}

/** The qids dealt to a roll, or null when the roll is not on the roster. */
export function allottedFor(allotment: Allotment, roll: string): string[] | null {
  const norm = normRoll(roll);
  const entry = allotment.entries.find((e) => e.roll === norm);
  return entry ? entry.qids : null;
}

export interface AllotmentCoverage {
  rosterSize: number;
  /** Rolls with no dealt question — the guardrail that blocks opening. */
  unassigned: string[];
  /** Rolls dealt fewer questions than `perStudent` (unassigned ones included). */
  incomplete: string[];
  /** How many times each question in the bank is used (0 for unused ones). */
  usage: Map<string, number>;
  /** Questions dealt to more than one student. */
  reused: number;
  /** Questions never dealt to anyone. */
  unused: number;
}

export function allotmentCoverage(allotment: Allotment, questions: Question[]): AllotmentCoverage {
  const usage = new Map<string, number>(questions.map((q) => [q.id, 0]));
  const unassigned: string[] = [];
  const incomplete: string[] = [];
  for (const e of allotment.entries) {
    // The editor leaves "" in a slot the teacher has not filled yet; those are
    // holes, not questions, so nothing here may count them as dealt.
    const dealt = e.qids.filter(Boolean);
    if (!dealt.length) unassigned.push(e.roll);
    if (dealt.length < allotment.perStudent) incomplete.push(e.roll);
    for (const id of dealt) usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  let reused = 0;
  let unused = 0;
  for (const [, n] of usage) {
    if (n > 1) reused++;
    if (n === 0) unused++;
  }
  return { rosterSize: allotment.entries.length, unassigned, incomplete, usage, reused, unused };
}

/**
 * Why this quiz must not open for responses yet. Empty means it may.
 * Used by the quizzes route when `accepting` (or a share/publish) is asked for.
 */
export function allotmentProblems(allotment: Allotment | null, questions: Question[]): string[] {
  const problems: string[] = [];
  if (!allotment || !allotment.entries.length) {
    problems.push("No roster yet — add roll numbers and deal questions before opening the quiz.");
    return problems;
  }
  const valid = new Set(questions.map((q) => q.id));
  const broken = allotment.entries.filter(
    (e) => !e.qids.filter(Boolean).length || e.qids.some((id) => !id || !valid.has(id))
  );
  if (broken.length) {
    const rolls = broken.map((e) => e.roll);
    const shown = rolls.slice(0, 8).join(", ");
    problems.push(
      `${rolls.length} roll${rolls.length === 1 ? " has" : "s have"} no question dealt (${shown}${
        rolls.length > 8 ? ", …" : ""
      }) — deal questions again before opening the quiz.`
    );
  }
  return problems;
}

/**
 * Set one slot of one roll's hand, returning a new allotment.
 *
 * This exists because the obvious `qids.map((old, j) => ...)` cannot write a
 * slot that does not exist yet: a roll dealt nothing has an empty array, so
 * every hand-picked question for it was silently dropped and the row snapped
 * back to "— no question —". The hand is padded with "" holes to the width the
 * editor is showing, so slot indices always line up with the dropdowns.
 *
 * A question already sitting in another slot of the same hand is swapped with
 * the one being replaced, so no student is ever dealt the same question twice.
 * Passing an empty `qid` clears the slot.
 */
export function setAllottedQid(
  allotment: Allotment,
  roll: string,
  slot: number,
  qid: string,
  perStudent = allotment.perStudent
): Allotment {
  const norm = normRoll(roll);
  const width = Math.max(1, perStudent, slot + 1);
  return {
    ...allotment,
    entries: allotment.entries.map((e) => {
      if (e.roll !== norm) return e;
      const qids = Array.from({ length: width }, (_, j) => e.qids[j] ?? "");
      const previous = qids[slot] ?? "";
      if (qid) {
        const clash = qids.findIndex((id, j) => j !== slot && id === qid);
        if (clash >= 0) qids[clash] = previous;
      }
      qids[slot] = qid;
      return { ...e, qids, manual: true };
    }),
  };
}

/**
 * Deal a question into every empty slot, spreading the bank as evenly as the
 * arithmetic allows: each hole takes the least-used question the student does
 * not already hold. Hands the teacher set by hand are left exactly as they are,
 * which is what makes this safe to run after an edit rather than only on a
 * fresh deal. Returns a new allotment.
 */
export function fillAllotmentGaps(
  allotment: Allotment,
  bankQids: string[],
  seed: string,
  perStudent = allotment.perStudent
): Allotment {
  if (!bankQids.length) return allotment;
  const width = Math.max(1, perStudent);
  const order = seededShuffle(bankQids, hashSeed(seed || allotment.seed || "fill"));
  const usage = new Map<string, number>(order.map((id) => [id, 0]));
  for (const e of allotment.entries) {
    for (const id of e.qids) if (id && usage.has(id)) usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  return {
    ...allotment,
    entries: allotment.entries.map((e) => {
      const qids = Array.from({ length: Math.max(width, e.qids.length) }, (_, j) => e.qids[j] ?? "");
      if (qids.every(Boolean)) return { ...e, qids };
      const held = new Set(qids.filter(Boolean));
      for (let j = 0; j < qids.length; j++) {
        if (qids[j]) continue;
        // Least used first, the shuffled order breaking ties so two runs of a
        // flat bank do not both start at the same question.
        let pick = "";
        let best = Infinity;
        for (const id of order) {
          if (held.has(id)) continue;
          const n = usage.get(id) ?? 0;
          if (n < best) {
            best = n;
            pick = id;
          }
        }
        if (!pick) break;
        qids[j] = pick;
        held.add(pick);
        usage.set(pick, (usage.get(pick) ?? 0) + 1);
      }
      return { ...e, qids };
    }),
  };
}
