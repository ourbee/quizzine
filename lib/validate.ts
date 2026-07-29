/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import type { ParsedQuiz, Question, QType, RawQuestion } from "./types";

const TYPE_ALIASES: Record<string, QType> = {
  mcq: "mcq",
  "multiple choice": "mcq",
  multiplechoice: "mcq",
  choice: "mcq",
  short: "short",
  shortanswer: "short",
  "short answer": "short",
  essay: "essay",
  long: "essay",
  longanswer: "essay",
  "long answer": "essay",
  subjective: "essay",
};

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  questions: Question[];
}

export function validateQuestions(parsed: ParsedQuiz): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const questions: Question[] = [];

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
    const type = TYPE_ALIASES[typeKey];
    if (!type) {
      errors.push(`${row}: unknown Type "${raw.type}". Use mcq, short or essay.`);
      return;
    }

    let points = 1;
    if (raw.points !== undefined && raw.points !== "") {
      points = Number(raw.points);
      if (!Number.isFinite(points) || points <= 0) {
        errors.push(`${row}: Points must be a positive number (got "${raw.points}").`);
        return;
      }
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

    if (type === "mcq") {
      const options = raw.options
        .map((o) => ({ key: o.key.toUpperCase(), text: (o.text ?? "").toString().trim(), feedback: (o.feedback ?? "").toString().trim() || undefined }))
        .filter((o) => o.text !== "");
      if (options.length < 2) {
        errors.push(`${row}: an MCQ needs at least two options (found ${options.length}).`);
        return;
      }
      const correctRaw = (raw.correct ?? "").toString().trim();
      if (!correctRaw) {
        errors.push(`${row}: CorrectAnswer is missing.`);
        return;
      }
      // Accept a letter ("B") or the full option text.
      let correct = correctRaw.toUpperCase();
      if (!options.some((o) => o.key === correct)) {
        const byText = options.find((o) => o.text.toLowerCase() === correctRaw.toLowerCase());
        if (byText) correct = byText.key;
        else {
          errors.push(`${row}: CorrectAnswer "${correctRaw}" matches none of the options (${options.map((o) => o.key).join(", ")}).`);
          return;
        }
      }
      question.options = options;
      question.correct = correct;
      const noFeedback = options.every((o) => !o.feedback) && !question.feedbackCorrect && !question.feedbackIncorrect;
      if (noFeedback) warnings.push(`${row}: no feedback provided — students will only see right/wrong.`);
    } else if (raw.correct || raw.options.some((o) => (o.text ?? "").toString().trim())) {
      warnings.push(`${row}: options/CorrectAnswer are ignored for ${type} questions (graded manually).`);
    }

    questions.push(question);
  });

  return { errors, warnings, questions };
}
