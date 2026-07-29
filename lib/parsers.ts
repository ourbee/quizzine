/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import type { ParsedQuiz, RawQuestion } from "./types";

const OPTION_KEYS = ["A", "B", "C", "D", "E", "F"];

function emptyQuestion(): RawQuestion {
  return { options: [] };
}

function setOption(q: RawQuestion, key: string, field: "text" | "feedback", value: string) {
  let opt = q.options.find((o) => o.key === key);
  if (!opt) {
    opt = { key, text: "" };
    q.options.push(opt);
  }
  opt[field] = value;
}

/** Parse rows from a spreadsheet (SheetJS sheet_to_json output, header row as keys). */
export function parseSheetRows(rows: Record<string, unknown>[]): ParsedQuiz {
  const questions: RawQuestion[] = [];
  let title: string | undefined;
  let description: string | undefined;
  for (const row of rows) {
    // Normalize headers: lowercase, strip spaces/underscores.
    const norm: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === undefined || v === null) continue;
      norm[k.toLowerCase().replace(/[\s_-]+/g, "")] = String(v);
    }
    const get = (...keys: string[]) => {
      for (const k of keys) if (norm[k] !== undefined && norm[k] !== "") return norm[k];
      return undefined;
    };
    // Optional columns naming the quiz itself — handy when one workbook holds several.
    title ??= get("quiztitle", "formtitle");
    description ??= get("quizdescription", "formdescription");
    const text = get("question", "questiontext", "q");
    if (!text) continue;
    const question: RawQuestion = {
      ...emptyQuestion(),
      text,
      type: get("type", "questiontype"),
      passage: get("passage", "context"),
      media: get("mediaurl", "media", "imageurl", "image", "url"),
      correct: get("correctanswer", "correct", "answer", "key"),
      points: get("points", "marks", "score"),
      feedbackCorrect: get("feedbackcorrect", "correctfeedback"),
      feedbackIncorrect: get("feedbackincorrect", "feedbackwrong", "incorrectfeedback"),
    };
    for (const key of OPTION_KEYS) {
      const lower = key.toLowerCase();
      const optText = get(`option${lower}`, lower);
      if (optText) setOption(question, key, "text", optText);
      const fb = get(`feedback${lower}`, `fb${lower}`);
      if (fb) setOption(question, key, "feedback", fb);
    }
    questions.push(question);
  }
  return { title, description, questions };
}

export interface SheetInput {
  name: string;
  rows: Record<string, unknown>[];
}

/** Sheet names spreadsheet apps invent, which say nothing about the quiz. */
const GENERIC_SHEET_RE = /^(sheet\s*\d*|questions?|quiz|data|table\s*\d*|form\s*responses?\s*\d*)$/i;

/**
 * One quiz per sheet: a workbook with several sheets yields several quizzes.
 * Sheets with no question rows (instructions, keys, scratch work) are ignored.
 */
export function parseWorkbookSheets(sheets: SheetInput[]): { sheet: string; quiz: ParsedQuiz }[] {
  const found: { sheet: string; quiz: ParsedQuiz }[] = [];
  for (const sheet of sheets) {
    const parsed = parseSheetRows(sheet.rows);
    if (!parsed.questions.length) continue;
    const sheetName = sheet.name.trim();
    found.push({
      sheet: sheetName,
      quiz: { ...parsed, title: parsed.title ?? (GENERIC_SHEET_RE.test(sheetName) ? undefined : sheetName) },
    });
  }
  return found;
}

/** Parse a pasted/uploaded JSON quiz: either {title, description, questions:[...]} or a bare array. */
export function parseJsonText(text: string): ParsedQuiz {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.questions;
  if (!Array.isArray(list)) throw new Error('JSON must be an array of questions or an object with a "questions" array.');
  const questions: RawQuestion[] = list.map((item: Record<string, unknown>) => {
    const question: RawQuestion = {
      ...emptyQuestion(),
      text: item.question !== undefined ? String(item.question) : item.text !== undefined ? String(item.text) : undefined,
      type: item.type !== undefined ? String(item.type) : undefined,
      passage: item.passage !== undefined ? String(item.passage) : undefined,
      media: (item.media ?? item.mediaUrl ?? item.imageUrl) !== undefined ? String(item.media ?? item.mediaUrl ?? item.imageUrl) : undefined,
      correct: (item.correct ?? item.correctAnswer ?? item.answer) !== undefined ? String(item.correct ?? item.correctAnswer ?? item.answer) : undefined,
      points: item.points as number | undefined,
      feedbackCorrect: item.feedbackCorrect !== undefined ? String(item.feedbackCorrect) : undefined,
      feedbackIncorrect: item.feedbackIncorrect !== undefined ? String(item.feedbackIncorrect) : undefined,
    };
    const opts = item.options;
    if (Array.isArray(opts)) {
      opts.forEach((o, idx) => {
        const key = OPTION_KEYS[idx];
        if (!key) return;
        if (typeof o === "string") setOption(question, key, "text", o);
        else if (o && typeof o === "object") {
          const obj = o as Record<string, unknown>;
          const k = obj.key ? String(obj.key).toUpperCase() : key;
          if (obj.text !== undefined) setOption(question, k, "text", String(obj.text));
          if (obj.feedback !== undefined) setOption(question, k, "feedback", String(obj.feedback));
        }
      });
    } else if (opts && typeof opts === "object") {
      for (const [k, v] of Object.entries(opts as Record<string, unknown>)) {
        setOption(question, k.toUpperCase(), "text", String(v));
      }
    }
    return question;
  });
  const meta = Array.isArray(data) ? {} : data;
  return {
    title: meta.title ? String(meta.title) : undefined,
    description: meta.description ? String(meta.description) : undefined,
    questions,
  };
}

/**
 * Parse the plain-text/markdown block format:
 *   Title: ... / Description: ... at the top, then per question:
 *   Q: text | Type: | Passage: | Media: | A:..F: options | FA:..FF: option feedback |
 *   Correct: A | Points: 1 | FeedbackCorrect: | FeedbackIncorrect:
 * Lines that don't start with a key continue the previous value.
 */
export function parseMarkdownText(text: string): ParsedQuiz {
  const result: ParsedQuiz = { questions: [] };
  let current: RawQuestion | null = null;
  let append: ((s: string) => void) | null = null;

  const keyRe = /^\s*(Q|Question|Type|Passage|Media|MediaURL|Correct|CorrectAnswer|Answer|Points|Marks|Title|Description|FeedbackCorrect|FeedbackIncorrect|F[A-F]|[A-F])\s*[:.)]\s?(.*)$/i;

  for (const line of text.split(/\r?\n/)) {
    const m = line.match(keyRe);
    if (!m) {
      const trimmed = line.trim();
      if (trimmed && append) append(trimmed);
      continue;
    }
    const key = m[1].toUpperCase();
    const value = m[2].trim();
    append = null;

    if (key === "TITLE") {
      result.title = value;
      append = (s) => (result.title = `${result.title} ${s}`);
    } else if (key === "DESCRIPTION") {
      result.description = value;
      append = (s) => (result.description = `${result.description} ${s}`);
    } else if (key === "Q" || key === "QUESTION") {
      current = { ...emptyQuestion(), text: value };
      result.questions.push(current);
      const q = current;
      append = (s) => (q.text = `${q.text} ${s}`);
    } else if (current) {
      const q = current;
      if (key === "TYPE") q.type = value;
      else if (key === "PASSAGE") {
        q.passage = value;
        append = (s) => (q.passage = `${q.passage} ${s}`);
      } else if (key === "MEDIA" || key === "MEDIAURL") q.media = value;
      else if (key === "CORRECT" || key === "CORRECTANSWER" || key === "ANSWER") q.correct = value;
      else if (key === "POINTS" || key === "MARKS") q.points = value;
      else if (key === "FEEDBACKCORRECT") {
        q.feedbackCorrect = value;
        append = (s) => (q.feedbackCorrect = `${q.feedbackCorrect} ${s}`);
      } else if (key === "FEEDBACKINCORRECT") {
        q.feedbackIncorrect = value;
        append = (s) => (q.feedbackIncorrect = `${q.feedbackIncorrect} ${s}`);
      } else if (/^F[A-F]$/.test(key)) {
        const optKey = key[1];
        setOption(q, optKey, "feedback", value);
        append = (s) => {
          const opt = q.options.find((o) => o.key === optKey);
          if (opt) opt.feedback = `${opt.feedback} ${s}`;
        };
      } else if (/^[A-F]$/.test(key)) {
        setOption(q, key, "text", value);
        append = (s) => {
          const opt = q.options.find((o) => o.key === key);
          if (opt) opt.text = `${opt.text} ${s}`;
        };
      }
    }
  }
  return result;
}

/** Auto-detect pasted content: JSON if it parses, otherwise the block format. */
export function parsePastedText(text: string): ParsedQuiz {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonText(trimmed);
  }
  return parseMarkdownText(trimmed);
}
