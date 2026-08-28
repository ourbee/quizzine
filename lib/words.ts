/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * Counting words, the way a teacher setting a 200-word limit means it.
 *
 * A hyphenated compound is one word, an em-dash between two words is not a word
 * of its own, and a number is a word. The count only has to agree with what a
 * word processor would say closely enough that nobody argues about it: the
 * limit is advisory by default, and the penalty for overrunning is a rubric
 * judgement rather than an arithmetic one.
 */
export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  const cleaned = String(text)
    // Dashes used as punctuation separate words; hyphens inside them do not.
    .replace(/[—–]+/g, " ")
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Past this share of the limit the counter warns before it accuses. */
export const WORD_WARN_RATIO = 0.9;

export type WordState = "none" | "under" | "near" | "over";

export function wordState(count: number, limit?: number): WordState {
  if (!limit || limit <= 0) return "none";
  if (count > limit) return "over";
  if (count >= limit * WORD_WARN_RATIO) return "near";
  return "under";
}

/** Trim typed text to a word limit — only used when the limit is hard. */
export function truncateToWords(text: string, limit: number): string {
  if (limit <= 0) return text;
  const pieces = text.split(/(\s+)/);
  let count = 0;
  let out = "";
  // Whitespace is held back until a word follows it, so cutting at the limit
  // does not leave a trailing space the student cannot see and cannot delete.
  let pending = "";
  for (const piece of pieces) {
    if (/^\s+$/.test(piece)) {
      pending += piece;
      continue;
    }
    if (/[\p{L}\p{N}]/u.test(piece)) {
      if (count >= limit) return out;
      count += 1;
    }
    out += pending + piece;
    pending = "";
  }
  return out + pending;
}
