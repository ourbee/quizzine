/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * Editing a quiz that students have already sat.
 *
 * Every stored result is keyed to a question id, so the one rule that matters
 * is that an id must always mean the same question it meant when someone
 * answered it. Ids are handed out positionally at upload — q1, q2, q3 — which
 * makes renumbering the obvious way to save an edit and the one way to corrupt
 * every attempt ever submitted: delete question 3 and, under renumbering, last
 * term's answer to q4 silently becomes an answer to a different question.
 *
 * So ids are never reissued. A question keeps its id through reordering and
 * rewording; a new question gets an id no question in this quiz has ever held;
 * a deleted question's id simply stops resolving, and everything downstream is
 * already built to skip a result whose question has gone.
 *
 * Edits fall into three tiers:
 *
 *   safe      wording, feedback, tags, difficulty, media, settings, theme —
 *             nothing that was marked changes meaning, so they always apply.
 *   regrade   the answer key, the marks, or whether a question is scored at
 *             all. Existing attempts are still valid answers to the same
 *             question, they were simply marked against a rule that has since
 *             changed, so they are re-marked from the answers already stored.
 *   structural  adding or removing questions once attempts exist. Allowed, but
 *             it leaves students who sat different versions of the paper, which
 *             the teacher is told before it happens rather than after.
 */

import { correctKeysOf, isGraded } from "./questions.ts";
import type { Question } from "./types";

/** The next id no question in this quiz has held, given the ids already in use. */
export function nextQuestionId(existing: Question[]): (taken?: Set<string>) => string {
  let highest = 0;
  for (const qn of existing) {
    const m = /^q(\d+)$/.exec(qn.id);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return (taken = new Set()) => {
    do {
      highest += 1;
    } while (taken.has(`q${highest}`));
    return `q${highest}`;
  };
}

export type EditTier = "safe" | "regrade" | "structural";

export interface QuestionChange {
  qid: string;
  /** How the question is described in the teacher's warning. */
  label: string;
  reason: string;
}

export interface EditPlan {
  tier: EditTier;
  questions: Question[];
  /** Marked questions whose rule changed — these force a regrade. */
  regrade: QuestionChange[];
  added: QuestionChange[];
  removed: QuestionChange[];
  /** Plain-language notes for the confirmation step. */
  warnings: string[];
}

const shortLabel = (text: string): string =>
  text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text;

/** Whether two questions would be marked differently from the same answer. */
function markingChanged(before: Question, after: Question): string | null {
  if (before.type !== after.type) return `its type changed from ${before.type} to ${after.type}`;
  if (isGraded(before) !== isGraded(after)) {
    return isGraded(after) ? "it is now scored" : "it is no longer scored";
  }
  if (!isGraded(after)) return null;
  if (before.points !== after.points) return `its marks changed from ${before.points} to ${after.points}`;
  const beforeKeys = correctKeysOf(before).join(",");
  const afterKeys = correctKeysOf(after).join(",");
  if (beforeKeys !== afterKeys) return "its correct answer changed";
  // An option's text is what a student actually chose; renaming one after the
  // fact rewrites history, so it is treated as a marking change too.
  const beforeOptions = before.options.map((o) => `${o.key}:${o.text}`).join("|");
  const afterOptions = after.options.map((o) => `${o.key}:${o.text}`).join("|");
  if (beforeOptions !== afterOptions) return "its options changed";
  return null;
}

/**
 * Work out what an edit actually does, without applying it. Incoming questions
 * are matched to stored ones by id; anything unmatched is new.
 */
export function planEdit(before: Question[], incoming: Question[], hasAttempts: boolean): EditPlan {
  const byId = new Map(before.map((qn) => [qn.id, qn]));
  const nextId = nextQuestionId(before);
  const taken = new Set(before.map((qn) => qn.id));

  const questions: Question[] = [];
  const regrade: QuestionChange[] = [];
  const added: QuestionChange[] = [];
  const seen = new Set<string>();

  for (const raw of incoming) {
    const existing = raw.id ? byId.get(raw.id) : undefined;
    if (!existing) {
      const id = nextId(taken);
      taken.add(id);
      const question = { ...raw, id };
      questions.push(question);
      added.push({ qid: id, label: shortLabel(question.text), reason: "added" });
      continue;
    }
    seen.add(existing.id);
    const question = { ...raw, id: existing.id };
    questions.push(question);
    const reason = markingChanged(existing, question);
    if (reason) regrade.push({ qid: existing.id, label: shortLabel(question.text), reason });
  }

  const removed = before
    .filter((qn) => !seen.has(qn.id))
    .map((qn) => ({ qid: qn.id, label: shortLabel(qn.text), reason: "removed" }));

  const warnings: string[] = [];
  if (hasAttempts) {
    if (regrade.length) {
      warnings.push(
        `${regrade.length} question${regrade.length === 1 ? "" : "s"} would be marked differently. Every submitted attempt will be re-marked from the answers already stored.`
      );
    }
    if (removed.length) {
      warnings.push(
        `${removed.length} question${removed.length === 1 ? " is" : "s are"} being removed. Answers already given to ${removed.length === 1 ? "it" : "them"} stay in the record but stop counting towards anyone's total.`
      );
    }
    if (added.length) {
      warnings.push(
        `${added.length} new question${added.length === 1 ? "" : "s"} will only be seen by students who have not submitted yet, so earlier attempts will be marked out of a smaller total.`
      );
    }
  }

  const tier: EditTier =
    hasAttempts && (added.length || removed.length)
      ? "structural"
      : regrade.length
        ? "regrade"
        : "safe";

  return { tier, questions, regrade, added, removed, warnings };
}
