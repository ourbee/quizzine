/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { splitKeys } from "./questions.ts";
import type { GradingMode, ParsedQuiz, Question, QType, RawQuestion } from "./types";

/**
 * A file names a question's *control* (single choice, multi choice, typed) and,
 * separately, whether it is scored. Some aliases imply both: "poll" is an
 * unscored single choice, "open" an unscored typed answer.
 */
interface TypeSpec {
  type: QType;
  graded?: false;
}

const TYPE_ALIASES: Record<string, TypeSpec> = {
  mcq: { type: "mcq" },
  "multiple choice": { type: "mcq" },
  multiplechoice: { type: "mcq" },
  choice: { type: "mcq" },
  single: { type: "mcq" },
  singlechoice: { type: "mcq" },
  radio: { type: "mcq" },

  multi: { type: "multi" },
  multiselect: { type: "multi" },
  "multi select": { type: "multi" },
  multianswer: { type: "multi" },
  "multiple answers": { type: "multi" },
  "multiple answer": { type: "multi" },
  msq: { type: "multi" },
  checkbox: { type: "multi" },
  checkboxes: { type: "multi" },
  selectall: { type: "multi" },
  "select all": { type: "multi" },
  "select all that apply": { type: "multi" },

  short: { type: "short" },
  shortanswer: { type: "short" },
  "short answer": { type: "short" },
  text: { type: "short" },

  essay: { type: "essay" },
  long: { type: "essay" },
  longanswer: { type: "essay" },
  "long answer": { type: "essay" },
  subjective: { type: "essay" },
  paragraph: { type: "essay" },

  // Unscored kinds — collected, shown back to the teacher, never marked.
  poll: { type: "mcq", graded: false },
  opinion: { type: "mcq", graded: false },
  survey: { type: "mcq", graded: false },
  vote: { type: "mcq", graded: false },
  rating: { type: "mcq", graded: false },
  pollmulti: { type: "multi", graded: false },
  "poll multi": { type: "multi", graded: false },
  multipoll: { type: "multi", graded: false },
  open: { type: "essay", graded: false },
  openresponse: { type: "essay", graded: false },
  "open response": { type: "essay", graded: false },
  freeresponse: { type: "essay", graded: false },
  "free response": { type: "essay", graded: false },
  reflection: { type: "essay", graded: false },
  comment: { type: "essay", graded: false },
};

const NO_RE = /^(no|false|0|n|off|ungraded|unmarked|none)$/i;
const YES_RE = /^(yes|true|1|y|on|graded|marked)$/i;

/** Reads an explicit Graded column / field. Undefined means "not stated". */
function readGradedFlag(raw: RawQuestion["graded"]): boolean | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).trim();
  if (NO_RE.test(s)) return false;
  if (YES_RE.test(s)) return true;
  return undefined;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  questions: Question[];
}

export function validateQuestions(parsed: ParsedQuiz, gradingMode: GradingMode = "graded"): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const questions: Question[] = [];
  // Survey and peer-reviewed quizzes both leave every question unmarked at
  // submission; peers supply the marks for the latter, later.
  const surveyQuiz = gradingMode !== "graded";

  if (!parsed.questions.length) {
    return { errors: ["No questions found. Check that the file follows the template."], warnings, questions };
  }

  parsed.questions.forEach((raw: RawQuestion, i) => {
    const row = `Question ${i + 1}`;
    const text = (raw.text ?? "").toString().trim();
    if (!text) {
      errors.push(`${row}: question text is empty.`);
      return;
    }

    const typeKey = (raw.type ?? "mcq").toString().trim().toLowerCase();
    const spec = TYPE_ALIASES[typeKey];
    if (!spec) {
      errors.push(`${row}: unknown Type "${raw.type}". Use mcq, multi, short, essay, poll or open.`);
      return;
    }
    const { type } = spec;

    // Quiz-wide survey mode wins; otherwise an explicit flag beats the type's own default.
    const explicit = readGradedFlag(raw.graded);
    const graded = surveyQuiz ? false : (explicit ?? spec.graded !== false);

    let points = 1;
    if (raw.points !== undefined && raw.points !== "") {
      points = Number(raw.points);
      if (!Number.isFinite(points) || points <= 0) {
        errors.push(`${row}: Points must be a positive number (got "${raw.points}").`);
        return;
      }
    }
    if (!graded) {
      if (raw.points !== undefined && raw.points !== "" && Number(raw.points) > 0 && !surveyQuiz) {
        warnings.push(`${row}: Points are ignored because this question is not scored.`);
      }
      points = 0;
    }

    const media = (raw.media ?? "").toString().trim() || undefined;
    if (media && !/^https?:\/\//i.test(media)) {
      warnings.push(`${row}: MediaURL "${media}" does not look like a link (should start with http/https).`);
    }

    const question: Question = {
      id: `q${i + 1}`,
      type,
      text,
      passage: (raw.passage ?? "").toString().trim() || undefined,
      media,
      options: [],
      points,
      feedbackCorrect: (raw.feedbackCorrect ?? "").toString().trim() || undefined,
      feedbackIncorrect: (raw.feedbackIncorrect ?? "").toString().trim() || undefined,
    };
    if (!graded) question.graded = false;

    if (type === "mcq" || type === "multi") {
      const options = raw.options
        .map((o) => ({
          key: o.key.toUpperCase(),
          text: (o.text ?? "").toString().trim(),
          feedback: (o.feedback ?? "").toString().trim() || undefined,
        }))
        .filter((o) => o.text !== "");
      if (options.length < 2) {
        errors.push(`${row}: a choice question needs at least two options (found ${options.length}).`);
        return;
      }
      question.options = options;

      const correctRaw = (raw.correct ?? "").toString().trim();

      if (!graded) {
        if (correctRaw) warnings.push(`${row}: CorrectAnswer is ignored because this question is not scored.`);
        questions.push(question);
        return;
      }

      if (!correctRaw) {
        errors.push(
          `${row}: CorrectAnswer is missing. Add one, or set Type to "poll" (or Graded to "no") if this question has no right answer.`
        );
        return;
      }

      // Accept letters ("B", or "A,C" for multi) or the full option text.
      const { resolved, unmatched } = resolveCorrect(correctRaw, options);
      if (unmatched.length) {
        errors.push(
          `${row}: CorrectAnswer ${unmatched.map((u) => `"${u}"`).join(", ")} matches none of the options (${options.map((o) => o.key).join(", ")}).`
        );
        return;
      }

      if (type === "mcq") {
        if (resolved.length > 1) {
          errors.push(
            `${row}: CorrectAnswer lists ${resolved.length} answers (${resolved.join(", ")}) but the Type is mcq. Set Type to "multi" to allow several correct answers.`
          );
          return;
        }
        question.correct = resolved[0];
      } else {
        question.correctKeys = resolved.sort();
        if (resolved.length === 1) {
          warnings.push(`${row}: only one correct answer on a multi question — students must still tick exactly that one.`);
        }
        if (resolved.length === options.length) {
          warnings.push(`${row}: every option is marked correct, so the question cannot be got wrong.`);
        }
      }

      const noFeedback = options.every((o) => !o.feedback) && !question.feedbackCorrect && !question.feedbackIncorrect;
      if (noFeedback) warnings.push(`${row}: no feedback provided — students will only see right/wrong.`);
    } else if (raw.correct || raw.options.some((o) => (o.text ?? "").toString().trim())) {
      warnings.push(`${row}: options/CorrectAnswer are ignored for ${type} questions (graded manually).`);
    }

    questions.push(question);
  });

  return { errors, warnings, questions };
}

type Opt = { key: string; text: string };

const matchOne = (token: string, options: Opt[]): string | undefined =>
  options.find((o) => o.key === token.trim().toUpperCase())?.key ??
  options.find((o) => o.text.toLowerCase() === token.trim().toLowerCase())?.key;

/**
 * Turn a CorrectAnswer cell into option keys.
 *
 * The whole cell is tried as one answer first, so an option whose text happens
 * to be a run of A–F letters ("face", "cab") is never mistaken for a list of
 * keys. Only if that fails is the cell split.
 */
function resolveCorrect(value: string, options: Opt[]): { resolved: string[]; unmatched: string[] } {
  const whole = matchOne(value, options);
  if (whole) return { resolved: [whole], unmatched: [] };

  let tokens = value
    .split(/[,;|/\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (tokens.length === 1) {
    const only = tokens[0];
    // Shorthand for several keys: "AC", "ABD", or "A C D".
    if (/^[A-Fa-f]{2,6}$/.test(only)) tokens = only.split("");
    else if (/^[A-Fa-f](\s+[A-Fa-f])+$/.test(only)) tokens = splitKeys(only);
  }

  const resolved: string[] = [];
  const unmatched: string[] = [];
  for (const token of tokens) {
    const key = matchOne(token, options);
    if (!key) unmatched.push(token);
    else if (!resolved.includes(key)) resolved.push(key);
  }
  return { resolved, unmatched };
}
