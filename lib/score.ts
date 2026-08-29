/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * Saying what a mark is worth.
 *
 * Marks out of a round number read themselves: 8 out of 10 is plainly 80%. Marks
 * out of anything else do not, and written answers make uneven totals the norm
 * rather than the exception — a rubric-marked paper is out of whatever its
 * questions happen to add up to. "8 / 13" makes a student do arithmetic before
 * they know how they did, and makes a teacher do it thirty times to compare a
 * class. So the percentage travels with the mark everywhere the mark is shown.
 *
 * It goes in brackets after the mark, never instead of it: the mark is what was
 * awarded and what gets recorded, and the percentage is a gloss on it.
 */

/** The percentage a mark represents, or null when there is nothing to be out of. */
export function percentOf(score: number | null | undefined, max: number | null | undefined): number | null {
  const s = Number(score);
  const m = Number(max);
  if (!Number.isFinite(s) || !Number.isFinite(m) || m <= 0) return null;
  return Math.round((s / m) * 100);
}

/** "(62%)", or "" when a percentage would be meaningless. */
export function percentSuffix(score: number | null | undefined, max: number | null | undefined): string {
  const pct = percentOf(score, max);
  return pct === null ? "" : `(${pct}%)`;
}

/**
 * The whole thing: "8 / 13 (62%)". A mark out of nothing keeps its slash and
 * loses the bracket rather than claiming 0%.
 */
export function scoreLabel(score: number | null | undefined, max: number | null | undefined): string {
  const s = Number.isFinite(Number(score)) ? Number(score) : 0;
  const m = Number.isFinite(Number(max)) ? Number(max) : 0;
  const suffix = percentSuffix(s, m);
  return suffix ? `${s} / ${m} ${suffix}` : `${s} / ${m}`;
}
