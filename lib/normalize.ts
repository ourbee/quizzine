/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

export function normRoll(roll: string): string {
  return roll.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Semesters a student can pick. -1 is "not applicable" — for open quizzes,
 * staff, visitors or mixed groups. It cannot be 0, because the reports already
 * use semester 0 for their "all semesters" summary row.
 */
export const NO_SEMESTER = -1;
export const SEMESTER_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];

export function semesterLabel(n: number): string {
  return n === NO_SEMESTER ? "N/A" : `Sem ${n}`;
}

/**
 * Read a semester off a request. Returns null for anything that is not a
 * deliberate choice, so an empty field can never be silently taken as "not
 * applicable" — `Number("")` is 0, which is exactly the trap to avoid.
 */
export function readSemester(raw: unknown): number | null {
  if (raw === "" || raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n === NO_SEMESTER) return NO_SEMESTER;
  return n >= 1 && n <= 8 ? n : null;
}

export function normName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|\s|[-'])\p{L}/gu, (c) => c.toUpperCase());
}

export function genId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function slugify(title: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "quiz";
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Deterministic seed from a string (for per-student shuffling). */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rnd = mulberry32(seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
