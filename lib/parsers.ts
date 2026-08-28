/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import type { ParsedQuiz, RawQuestion } from "./types";

const OPTION_KEYS = ["A", "B", "C", "D", "E", "F"];

/**
 * Headers that name a tag dimension directly, so a sheet can carry one column
 * per dimension instead of packing them all into Tags. Keyed by the normalized
 * header; the value is the dimension name the tag is stored under.
 */
const DIMENSION_COLUMN_NAMES: Record<string, string> = {
  period: "Period",
  era: "Period",
  genre: "Genre",
  form: "Genre",
  author: "Author",
  writer: "Author",
  poet: "Author",
  text: "Text",
  work: "Text",
  skill: "Skill",
  theme: "Theme",
  topic: "Topic",
  unit: "Unit",
  module: "Unit",
  movement: "Movement",
  region: "Region",
  paper: "Paper",
  section: "Section",
};
const DIMENSION_COLUMNS = new Set(Object.keys(DIMENSION_COLUMN_NAMES));

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
      passage: get("passage", "context", "material"),
      passageTitle: get("passagetitle", "materialtitle", "contexttitle", "passageheading"),
      media: get("mediaurl", "media", "imageurl", "image", "url"),
      correct: get("correctanswer", "correct", "answer", "key", "correctanswers", "answers"),
      graded: get("graded", "scored", "marked", "hascorrectanswer"),
      points: get("points", "marks", "score"),
      // ModelAnswer is an alias, not a new field: FeedbackCorrect has always
      // been the model answer on a written question, and a teacher writing one
      // should not have to know that.
      feedbackCorrect: get("feedbackcorrect", "correctfeedback", "modelanswer", "sampleanswer", "expectedanswer"),
      feedbackIncorrect: get("feedbackincorrect", "feedbackwrong", "incorrectfeedback"),
      tags: get("tags", "tag", "categories", "category", "labels"),
      difficulty: get("difficulty", "level", "difficultylevel"),
      wordLimit: get("wordlimit", "words", "maxwords", "wordcount"),
    };
    // Dimensions may also arrive as columns of their own — a Period column beside
    // a Genre column is how a teacher naturally lays a sheet out, and reads the
    // same as writing "Period: Victorian" in the Tags cell.
    const columnTags: string[] = [];
    for (const [header, value] of Object.entries(norm)) {
      if (!DIMENSION_COLUMNS.has(header) || !value) continue;
      const dimension = DIMENSION_COLUMN_NAMES[header];
      for (const piece of value.split(/[;,\n]+/)) {
        const v = piece.trim();
        if (v) columnTags.push(`${dimension}: ${v}`);
      }
    }
    if (columnTags.length) {
      question.tags = [question.tags, columnTags.join("; ")].filter(Boolean).join("; ");
    }
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

/**
 * Read whichever "correct answer" field a JSON question uses. Multi-answer
 * questions arrive as arrays (`"correct": ["A","C"]`); everything downstream
 * expects one string, so arrays are joined.
 */
function readCorrect(item: Record<string, unknown>): string | undefined {
  const value = item.correct ?? item.correctAnswer ?? item.correctAnswers ?? item.answer ?? item.answers;
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const joined = value.map((v) => String(v).trim()).filter(Boolean).join(",");
    return joined || undefined;
  }
  return String(value);
}

/** Tags from a JSON question: a list, one string to split, or dimensions as keys. */
function readTags(item: Record<string, unknown>): string | string[] | undefined {
  const value = item.tags ?? item.tag ?? item.categories ?? item.labels;
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "object") {
    // {"Period": "Victorian", "Genre": ["Poetry", "Lyric"]}
    const out: string[] = [];
    for (const [dimension, raw] of Object.entries(value as Record<string, unknown>)) {
      for (const v of Array.isArray(raw) ? raw : [raw]) {
        const text = String(v).trim();
        if (text) out.push(`${dimension}: ${text}`);
      }
    }
    return out;
  }
  return String(value);
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
      passageTitle:
        (item.passageTitle ?? item.passagetitle) !== undefined ? String(item.passageTitle ?? item.passagetitle) : undefined,
      media: (item.media ?? item.mediaUrl ?? item.imageUrl) !== undefined ? String(item.media ?? item.mediaUrl ?? item.imageUrl) : undefined,
      correct: readCorrect(item),
      graded: item.graded as string | boolean | undefined,
      points: item.points as number | undefined,
      feedbackCorrect: (() => {
        const value = item.feedbackCorrect ?? item.modelAnswer ?? item.modelanswer ?? item.sampleAnswer;
        return value !== undefined ? String(value) : undefined;
      })(),
      feedbackIncorrect: item.feedbackIncorrect !== undefined ? String(item.feedbackIncorrect) : undefined,
      tags: readTags(item),
      difficulty: (item.difficulty ?? item.level) as string | number | undefined,
      wordLimit: (item.wordLimit ?? item.wordlimit ?? item.maxWords) as string | number | undefined,
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
 *   Q: text | Type: | Passage: | PassageTitle: | Media: | A:..F: options | FA:..FF: option feedback |
 *   Correct: A | Points: 1 | FeedbackCorrect: | FeedbackIncorrect:
 * Lines that don't start with a key continue the previous value.
 */
export function parseMarkdownText(text: string): ParsedQuiz {
  const result: ParsedQuiz = { questions: [] };
  let current: RawQuestion | null = null;
  let append: ((s: string) => void) | null = null;

  const keyRe = /^\s*(Q|Question|Type|PassageTitle|Passage|Media|MediaURL|Correct|CorrectAnswer|CorrectAnswers|Answer|Answers|Graded|Scored|Points|Marks|Tags|Tag|Difficulty|Level|WordLimit|MaxWords|Title|Description|FeedbackCorrect|ModelAnswer|FeedbackIncorrect|F[A-F]|[A-F])\s*[:.)]\s?(.*)$/i;

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
      } else if (key === "PASSAGETITLE") q.passageTitle = value;
      else if (key === "MEDIA" || key === "MEDIAURL") q.media = value;
      else if (key === "CORRECT" || key === "CORRECTANSWER" || key === "CORRECTANSWERS" || key === "ANSWER" || key === "ANSWERS")
        q.correct = value;
      else if (key === "GRADED" || key === "SCORED") q.graded = value;
      else if (key === "POINTS" || key === "MARKS") q.points = value;
      else if (key === "TAGS" || key === "TAG") {
        q.tags = value;
        append = (s) => (q.tags = `${q.tags}; ${s}`);
      } else if (key === "DIFFICULTY" || key === "LEVEL") q.difficulty = value;
      else if (key === "WORDLIMIT" || key === "MAXWORDS") q.wordLimit = value;
      else if (key === "FEEDBACKCORRECT" || key === "MODELANSWER") {
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
