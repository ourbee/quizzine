/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { rubricParams, scorePercent, type RubricConfig } from "./rubric.ts";
import { countWords } from "./words.ts";
import type { Question } from "./types";

/**
 * The AI reviewer, without an API key.
 *
 * Quizzine builds a marking package — instructions, the rubric, the questions,
 * the model answers, and the responses under opaque codes — the teacher pastes
 * it into whichever chatbot they use, and pastes the reply back. The same idiom
 * as the quiz-generation prompt in lib/aiprompt.ts, and for the same reason: it
 * costs nothing, needs no key, works with any model, and the teacher can see
 * exactly what was sent.
 *
 * Three scopes, and the choice is a real one:
 *
 *   "question" — every response to one question. Marking one question across a
 *     class is what produces consistent relative grading, for a language model
 *     exactly as for a human. It remains the recommended unit.
 *   "student"  — one student's answers to every written question. What a
 *     teacher wants when they are working through a pile person by person, or
 *     re-marking one paper after a query.
 *   "batch"    — the whole quiz in one go. Fewest pastes; the model's attention
 *     is spread thinnest. Batch packages are ordered question-major, so a
 *     single part still holds one question's answers side by side wherever the
 *     word budget allows it.
 *
 * The word budget splits any scope into self-contained parts, so "whole quiz"
 * does not mean "one impossible paste".
 *
 * Names never enter a package. Responses are labelled R1, R2, … and the map
 * back to attempts lives only in Quizzine. That is the whole of how
 * anonymisation works in this mode, so it is not optional and there is no
 * setting for it.
 */

/** Response words per part, before a package is split. Long chats mark worse. */
export const PACKAGE_WORD_BUDGET = 8000;

export type PackScope = "question" | "student" | "batch";

/** A question and the weights it is actually marked on (overrides applied). */
export interface PackQuestion {
  question: Question;
  weights: Record<string, number>;
}

export interface PackResponse {
  attemptId: string;
  /** The typed answer. Blank responses are dropped before a package is built. */
  text: string;
}

/** Where a code points: one answer, by one student, to one question. */
export interface PackCellRef {
  attemptId: string;
  qid: string;
}

interface PackCell extends PackCellRef {
  code: string;
  /** Index into the package's question list, for grouping and headings. */
  qIndex: number;
  text: string;
  words: number;
}

export interface PackPart {
  /** 1-based, for "Copy part 2 of 3". */
  index: number;
  total: number;
  codes: string[];
  words: number;
  text: string;
}

export interface MarkingPackage {
  scope: PackScope;
  /** Set only when the package covers exactly one question. */
  qid?: string;
  parts: PackPart[];
  /** Code → answer. The only thing that can turn a marked code back into a student. */
  codeMap: Record<string, PackCellRef>;
  /** Answers left out because nothing was typed. */
  blank: number;
  totalWords: number;
  /** Weights per code, so a reply can be parsed against the right maximums. */
  codeWeights: Record<string, Record<string, number>>;
}

export interface PackInput {
  scope: PackScope;
  rubric: RubricConfig;
  /** In the order the teacher sees them; the index gives the Q code. */
  questions: PackQuestion[];
  /** In the order the teacher sees them; the index gives the R code. */
  attempts: { attemptId: string }[];
  /** The typed answer, or "" where there is none. */
  answer: (attemptId: string, qid: string) => string;
  wordBudget?: number;
}

const rule = (s: string) => `\n${"-".repeat(60)}\n${s}\n${"-".repeat(60)}\n`;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Whether a question's weights depart from the rubric's own. */
function weightsOverridden(rubric: RubricConfig, weights: Record<string, number>): boolean {
  return rubricParams(rubric).some((p) => Math.abs((weights[p.id] ?? p.weight) - p.weight) > 0.001);
}

function rubricSection(rubric: RubricConfig, weights: Record<string, number>): string {
  const lines: string[] = [];
  for (const band of rubric.bands) {
    const bandTotal = band.params.reduce((s, p) => s + (weights[p.id] ?? p.weight), 0);
    lines.push(`${band.label} — ${round1(bandTotal)} points in total`);
    for (const p of band.params) {
      const w = weights[p.id] ?? p.weight;
      lines.push(`  "${p.id}" — ${p.label} — score 0 to ${round1(w)}${p.hint ? `. ${p.hint}` : ""}`);
    }
  }
  return lines.join("\n");
}

/** The one-line maximums a question overrides, printed inside its own block. */
function overrideSection(rubric: RubricConfig, weights: Record<string, number>): string {
  return [
    "MAXIMUMS FOR THIS QUESTION (they differ from the rubric above — use these):",
    ...rubricParams(rubric).map((p) => `  "${p.id}" — score 0 to ${round1(weights[p.id] ?? p.weight)}`),
  ].join("\n");
}

/** How codes are explained, which is the one thing a multi-question package must get right. */
function codeRule(multiQuestion: boolean): string {
  return multiQuestion
    ? 'Every response carries a code of the form R3Q2 — R3 is the response, Q2 is the question it answers. Copy each code back EXACTLY as it appears. A response and a question are two different things and the code holds both; "R3" alone, or "Q2" alone, cannot be matched to anything and will be left unmarked.'
    : "Every response carries a code of the form R3. Copy each code back exactly as it appears.";
}

function instructions(
  rubric: RubricConfig,
  scope: PackScope,
  multiQuestion: boolean,
  baseWeights: Record<string, number>,
  part: { index: number; total: number },
  sampleCode: string
): string {
  const ids = rubricParams(rubric).map((p) => `"${p.id}"`).join(", ");
  const total = round1(Object.values(baseWeights).reduce((s, w) => s + w, 0));

  const opening =
    scope === "student"
      ? "You are marking ONE student's answers to several questions against a fixed rubric. Follow these instructions exactly."
      : multiQuestion
        ? "You are marking student answers to several questions against a fixed rubric. Follow these instructions exactly."
        : "You are marking student answers to ONE question against a fixed rubric. Follow these instructions exactly.";

  return [
    opening,
    "",
    "1. Score EVERY parameter for EVERY response, as a number between 0 and that parameter's maximum. Never exceed the maximum.",
    `2. The parameter keys are exactly: ${ids}. Use these keys and no others. The scores for one response add up to at most ${total}${
      multiQuestion ? ", unless a question states different maximums of its own — then use that question's" : ""
    }.`,
    `3. ${codeRule(multiQuestion)}`,
    "4. Fill in all four feedback fields for every response: strengths, improvements, corrections, oneThing.",
    "   - strengths: what the answer actually does well, in specific terms.",
    "   - improvements: what would raise the mark, in specific terms.",
    "   - corrections: factual or textual errors that need correcting. Empty string if there are none.",
    "   - oneThing: the single most useful thing this student should fix next time. One sentence.",
    "5. Where a word limit is given, penalise overrunning it under the Craft & Discipline band (word-limit adherence), not elsewhere.",
    "6. You cannot check facts against the source, because you do not have it — you would be checking from memory, and memory is exactly what this rubric tells a marker not to trust. So DO NOT penalise a claim merely because you cannot verify it. Instead, name it in `corrections` as something the teacher should check, and mark factual accuracy on what you can actually judge (internal consistency, obvious error, claims the passage or model answer contradict).",
    multiQuestion
      ? "7. Judge each answer against the rubric and against its own question, not against the other answers, and not against the student's other answers. A weak answer to Q1 says nothing about Q2."
      : "7. Judge each response on its own against the rubric, not against the other responses.",
    "8. Do not write anything outside the JSON. No preamble, no summary, no commentary.",
    "9. Inside a feedback field, quote the student with SINGLE quotes ('greek' should be 'Greek'), never double ones. A raw double quote inside a value breaks the JSON and the whole batch has to be marked again.",
    "",
    part.total > 1
      ? `\nThis is part ${part.index} of ${part.total}. Mark only the responses given below. Use a FRESH CHAT for each part — a long conversation marks the later responses worse than the earlier ones.`
      : null,
    "",
    "Return ONLY a JSON array, one object per response, in exactly this shape:",
    "",
    "[",
    '  {',
    `    "code": "${sampleCode}",`,
    `    "scores": { ${rubricParams(rubric).slice(0, 3).map((p) => `"${p.id}": 0`).join(", ")}, ... },`,
    '    "strengths": "...",',
    '    "improvements": "...",',
    '    "corrections": "",',
    '    "oneThing": "..."',
    '  }',
    "]",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

function questionSection(qn: Question, rubric: RubricConfig, weights: Record<string, number>): string {
  const lines: string[] = [];
  if (qn.passage?.trim()) {
    lines.push(qn.passageTitle?.trim() ? `MATERIAL THE STUDENTS READ (${qn.passageTitle.trim()}):` : "MATERIAL THE STUDENTS READ:");
    lines.push(qn.passage.trim(), "");
  }
  lines.push("THE QUESTION:", qn.text.trim(), "");
  if (qn.feedbackCorrect?.trim()) {
    lines.push("MODEL ANSWER (the teacher's own; judge against it, do not require the student to reproduce it):");
    lines.push(qn.feedbackCorrect.trim(), "");
  }
  lines.push(
    qn.wordLimit && qn.wordLimit > 0
      ? `WORD LIMIT: ${qn.wordLimit} words. Overrunning is penalised under word-limit adherence.`
      : "WORD LIMIT: none was set."
  );
  if (weightsOverridden(rubric, weights)) lines.push("", overrideSection(rubric, weights));
  return lines.join("\n");
}

// ---------- building ----------

/**
 * Every answer the package covers, in the order it will be presented, each
 * under the code it keeps for good.
 *
 * Codes are assigned here and nowhere else, from the attempt's and question's
 * positions in the lists the caller passed. That is what lets a remainder
 * package be a plain filter of these cells rather than a renumbering: R7Q2 is
 * R7Q2 whether it travels with forty other answers or alone.
 */
function makeCells(input: PackInput): { cells: PackCell[]; blank: number } {
  const multiQuestion = input.questions.length > 1;
  const cells: PackCell[] = [];
  let blank = 0;

  // Question-major throughout: for a single question it is the only order there
  // is, and for a batch it keeps one question's answers together, which is the
  // whole reason question-scope marking grades more consistently.
  const ordered: { qIndex: number; aIndex: number }[] =
    input.scope === "student"
      ? input.attempts.flatMap((_, aIndex) => input.questions.map((__, qIndex) => ({ qIndex, aIndex })))
      : input.questions.flatMap((_, qIndex) => input.attempts.map((__, aIndex) => ({ qIndex, aIndex })));

  for (const { qIndex, aIndex } of ordered) {
    const qn = input.questions[qIndex].question;
    const attemptId = input.attempts[aIndex].attemptId;
    const text = (input.answer(attemptId, qn.id) ?? "").trim();
    if (!text) {
      blank += 1;
      continue;
    }
    cells.push({
      code: multiQuestion ? `R${aIndex + 1}Q${qIndex + 1}` : `R${aIndex + 1}`,
      attemptId,
      qid: qn.id,
      qIndex,
      text,
      words: countWords(text),
    });
  }
  return { cells, blank };
}

/** Chunk by word budget, never emitting an empty part. */
function chunkCells(cells: PackCell[], wordBudget: number): PackCell[][] {
  const chunks: PackCell[][] = [];
  let current: PackCell[] = [];
  let running = 0;
  for (const c of cells) {
    // One answer longer than the whole budget still travels alone rather than
    // being cut in half.
    if (current.length && running + c.words > wordBudget) {
      chunks.push(current);
      current = [];
      running = 0;
    }
    current.push(c);
    running += c.words;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function renderPart(input: PackInput, chunk: PackCell[], meta: { index: number; total: number }, allCount: number): PackPart {
  const multiQuestion = input.questions.length > 1;
  const baseWeights = input.questions[0]?.weights ?? {};
  const head = instructions(input.rubric, input.scope, multiQuestion, baseWeights, meta, chunk[0]?.code ?? "R1");
  const body: string[] = [head, "", "THE RUBRIC:", rubricSection(input.rubric, multiQuestion ? Object.fromEntries(rubricParams(input.rubric).map((p) => [p.id, p.weight])) : baseWeights), ""];

  if (!multiQuestion) {
    const only = input.questions[0];
    body.push(
      questionSection(only.question, input.rubric, only.weights),
      "",
      `THE RESPONSES (${chunk.length}${meta.total > 1 ? ` of ${allCount}` : ""}). Mark every one of them:`,
      chunk.map((c) => `${rule(`${c.code} — ${c.words} words`)}${c.text}`).join("\n"),
      ""
    );
  } else {
    // Group the chunk's cells under their questions, in question order, so the
    // question and its model answer are read once rather than per response.
    const byQuestion = new Map<number, PackCell[]>();
    for (const c of chunk) byQuestion.set(c.qIndex, [...(byQuestion.get(c.qIndex) ?? []), c]);
    for (const qIndex of [...byQuestion.keys()].sort((a, b) => a - b)) {
      const group = byQuestion.get(qIndex)!;
      const pq = input.questions[qIndex];
      body.push(
        `${"=".repeat(60)}\nQUESTION Q${qIndex + 1} of ${input.questions.length}\n${"=".repeat(60)}`,
        questionSection(pq.question, input.rubric, pq.weights),
        "",
        `RESPONSES TO Q${qIndex + 1} (${group.length}). Mark every one of them:`,
        group.map((c) => `${rule(`${c.code} — ${c.words} words`)}${c.text}`).join("\n"),
        ""
      );
    }
  }

  body.push(`Now return the JSON array for ${chunk.map((c) => c.code).join(", ")} and nothing else.`);

  return {
    index: meta.index,
    total: meta.total,
    codes: chunk.map((c) => c.code),
    words: chunk.reduce((s, c) => s + c.words, 0),
    text: body.join("\n"),
  };
}

function assemble(input: PackInput, cells: PackCell[], blank: number): MarkingPackage {
  const budget = input.wordBudget ?? PACKAGE_WORD_BUDGET;
  const chunks = chunkCells(cells, budget);
  const parts = chunks.map((chunk, i) => renderPart(input, chunk, { index: i + 1, total: chunks.length }, cells.length));

  const codeMap: Record<string, PackCellRef> = {};
  const codeWeights: Record<string, Record<string, number>> = {};
  for (const c of cells) {
    codeMap[c.code] = { attemptId: c.attemptId, qid: c.qid };
    codeWeights[c.code] = input.questions[c.qIndex].weights;
  }

  return {
    scope: input.scope,
    ...(input.questions.length === 1 ? { qid: input.questions[0].question.id } : {}),
    parts,
    codeMap,
    codeWeights,
    blank,
    totalWords: cells.reduce((s, c) => s + c.words, 0),
  };
}

/**
 * Build the package for a scope. A package whose responses exceed the word
 * budget is split into self-contained parts — each carries the full
 * instructions, rubric, and every question it actually covers, so a part can be
 * pasted into a fresh chat and stand entirely on its own.
 */
export function buildPackage(input: PackInput): MarkingPackage {
  const { cells, blank } = makeCells(input);
  return assemble(input, cells, blank);
}

/**
 * Build a package containing only the codes still unmarked — what the UI offers
 * after a reply came back truncated, or after a batch was marked in parts and
 * one part went astray.
 *
 * Because codes are fixed by position rather than by how many answers happen to
 * travel together, this is a plain filter: R7Q2 keeps its code, so a reply about
 * it still lands on the same student and the same question.
 */
export function remainderPackage(input: PackInput, unmarkedCodes: string[]): MarkingPackage {
  const { cells, blank } = makeCells(input);
  const wanted = new Set(unmarkedCodes);
  return assemble(input, cells.filter((c) => wanted.has(c.code)), blank);
}

/**
 * The single-question package, in the terms the question view thinks in. The
 * common case, and the recommended one.
 */
export function buildQuestionPackage(
  qn: Question,
  rubric: RubricConfig,
  weights: Record<string, number>,
  responses: PackResponse[],
  wordBudget: number = PACKAGE_WORD_BUDGET
): MarkingPackage {
  const byAttempt = new Map(responses.map((r) => [r.attemptId, r.text]));
  return buildPackage({
    scope: "question",
    rubric,
    questions: [{ question: qn, weights }],
    attempts: responses.map((r) => ({ attemptId: r.attemptId })),
    answer: (attemptId) => byAttempt.get(attemptId) ?? "",
    wordBudget,
  });
}

// ---------- paste-back ----------

export interface ParsedMark {
  code: string;
  params: Record<string, number>;
  percent: number;
  strengths?: string;
  improvements?: string;
  corrections?: string;
  oneThing?: string;
  /** Parameters that came back above their weight and were capped. */
  clamped: string[];
}

export interface ParseResult {
  marks: ParsedMark[];
  /** Entries that could not be used, and why — never silently dropped. */
  rejected: { code: string; reason: string }[];
  /** Codes expected for this package that the reply never covered. */
  unmarked: string[];
  /** A reply that was not JSON at all fails here rather than half-applying. */
  error?: string;
}

/** A cell code: R3, or R3Q2 where the package spans more than one question. */
const CODE_SHAPE = /^R\d+(?:Q\d+)?$/i;

/**
 * Re-escape stray double quotes inside string values.
 *
 * A marker quoting the student back — `"corrections": ""greek" should be
 * "Greek""` — writes something no JSON parser will accept, and it is the single
 * commonest way a reply arrives broken: the model is discussing words, and
 * words in this subject come in quotation marks.
 *
 * A quote is read as closing its string only when the next thing that is not
 * whitespace is a comma, a colon, a closing brace or bracket, or the end of the
 * text. Anything else means the writer was quoting, so the quote is escaped and
 * the string carries on. That guess is wrong for a value that genuinely ends in
 * a quoted word mid-object, which is why this only ever runs after a strict
 * parse has already failed: correct JSON is never put through it.
 */
export function repairStrayQuotes(text: string): string {
  const out: string[] = [];
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && inString) {
      out.push(ch, text[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (ch !== '"') {
      out.push(ch);
      continue;
    }
    if (!inString) {
      inString = true;
      out.push(ch);
      continue;
    }
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    const next = text[j];
    if (next === undefined || next === "," || next === ":" || next === "}" || next === "]") {
      inString = false;
      out.push(ch);
    } else {
      out.push('\\"');
    }
  }
  return out.join("");
}

/** Strict first, repaired second — correct JSON never goes through the repair. */
function parseLenient(slice: string): unknown | undefined {
  try {
    return JSON.parse(slice);
  } catch {
    try {
      return JSON.parse(repairStrayQuotes(slice));
    } catch {
      return undefined;
    }
  }
}

/**
 * Pull the JSON out of a chat reply. Models wrap their answer in prose, in
 * fences, or in both; the array is found by bracket matching rather than by a
 * regular expression, so a bracket inside a quoted comment cannot end it early.
 */
export function extractJson(reply: string): unknown | null {
  const text = String(reply ?? "");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text].filter((c): c is string => !!c && c.trim() !== "");

  for (const candidate of candidates) {
    for (const [open, close] of [
      ["[", "]"],
      ["{", "}"],
    ] as const) {
      const start = candidate.indexOf(open);
      if (start === -1) continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < candidate.length; i++) {
        const ch = candidate[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = !inString;
        if (inString) continue;
        if (ch === open) depth += 1;
        else if (ch === close) {
          depth -= 1;
          if (depth === 0) {
            const parsed = parseLenient(candidate.slice(start, i + 1));
            if (parsed !== undefined) return parsed;
            break; // try the next candidate/shape rather than guessing
          }
        }
      }
    }
  }

  /*
   * A reply that stopped mid-array — the commonest failure with a long class,
   * and near-certain with a whole-quiz batch — still holds whole objects before
   * the cut. They are salvaged rather than thrown away, so the teacher only has
   * to re-run the remainder instead of the lot. Anything half-written is simply
   * not balanced, so it never survives.
   */
  const salvaged = salvageObjects(text);
  return salvaged.length ? salvaged : null;
}

/** Every complete top-level `{...}` in a string, parsed; incomplete ones dropped. */
function salvageObjects(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const parsed = parseLenient(text.slice(start, i + 1));
        // Not an object we can use? The next one may still be.
        if (parsed !== undefined) out.push(parsed);
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return out;
}

const readText = (v: unknown): string | undefined => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, 4000) : undefined;
};

/**
 * Weights for a code. One object covers a single-question package; a package
 * spanning several questions passes the map the package built, because a
 * per-question weight override changes what "out of" means answer by answer.
 */
export type WeightSource = Record<string, number> | Record<string, Record<string, number>>;

function weightsFor(source: WeightSource, code: string): Record<string, number> {
  const byCode = (source as Record<string, Record<string, number>>)[code];
  if (byCode && typeof byCode === "object") return byCode;
  // A flat weights object: every value is a number, so it is the weights itself.
  const flat = source as Record<string, number>;
  return Object.values(flat).every((v) => typeof v === "number") ? flat : {};
}

/**
 * Turn a pasted reply into marks.
 *
 * Attribution is mechanical, and that is the point: a code either matches a
 * response exactly or it is rejected. A mangled or invented code leaves that
 * response unmarked; it is never assigned to the nearest-looking student — and
 * in a batch package it is never assigned to the nearest-looking question
 * either, which is the failure a shared code namespace would have invited.
 */
export function parseAiReply(reply: string, expectedCodes: string[], weights: WeightSource): ParseResult {
  const data = extractJson(reply);
  if (data === null) {
    return {
      marks: [],
      rejected: [],
      unmarked: [...expectedCodes],
      // Two different failures, and the fix differs: half a reply is a copying
      // problem, a reply that will not parse is the model's problem.
      error: /[[{]/.test(reply)
        ? "That reply has JSON in it, but it could not be read — usually a response cut off part-way, or quotation marks the model forgot to escape. Ask it to send the JSON again on its own, or paste the part that is complete."
        : "No JSON was found in that reply. Copy the model's whole answer, including the square brackets.",
    };
  }

  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as Record<string, unknown>).results)
      ? ((data as Record<string, unknown>).results as unknown[])
      : Array.isArray((data as Record<string, unknown>).responses)
        ? ((data as Record<string, unknown>).responses as unknown[])
        : (data as Record<string, unknown>).code !== undefined
          ? // One entry on its own, which is what a salvaged fragment looks like.
            [data]
          : // A bare object keyed by code: {"R1Q2": {...}, "R2Q2": {...}}
            Object.entries(data as Record<string, unknown>)
              .filter(([k]) => CODE_SHAPE.test(k))
              .map(([k, v]) => ({ code: k, ...(v as Record<string, unknown>) }));

  if (!list.length) {
    return {
      marks: [],
      rejected: [],
      unmarked: [...expectedCodes],
      error: "That JSON held no marked responses.",
    };
  }

  const expected = new Set(expectedCodes.map((c) => c.toUpperCase()));
  const marks: ParsedMark[] = [];
  const rejected: { code: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const code = String(item.code ?? item.id ?? item.response ?? "").trim().toUpperCase();

    if (!code) {
      rejected.push({ code: "—", reason: "no code on this entry, so it cannot be matched to a response" });
      continue;
    }
    if (!expected.has(code)) {
      rejected.push({
        code,
        reason: /^R\d+$/i.test(code) && expectedCodes.some((c) => /Q\d+$/i.test(c))
          ? "a response number with no question on it — this package needs codes like R3Q2, so it was left unmarked rather than guessed at"
          : "not a code in this package — left unmarked rather than guessed at",
      });
      continue;
    }
    if (seen.has(code)) {
      rejected.push({ code, reason: "appeared twice in the reply; the first one was kept" });
      continue;
    }

    const scoresRaw = (item.scores ?? item.params ?? item.parameters) as Record<string, unknown> | undefined;
    if (!scoresRaw || typeof scoresRaw !== "object") {
      rejected.push({ code, reason: "no scores object" });
      continue;
    }

    const codeWeights = weightsFor(weights, code);
    const params: Record<string, number> = {};
    const clamped: string[] = [];
    let anyScore = false;
    for (const [id, weight] of Object.entries(codeWeights)) {
      const value = Number(scoresRaw[id]);
      if (!Number.isFinite(value)) continue;
      anyScore = true;
      if (value > weight + 0.001) clamped.push(id);
      params[id] = Math.min(weight, Math.max(0, Math.round(value * 100) / 100));
    }
    if (!anyScore) {
      rejected.push({ code, reason: "none of the parameter keys matched this rubric" });
      continue;
    }

    seen.add(code);
    marks.push({
      code,
      params,
      percent: scorePercent(params, codeWeights),
      strengths: readText(item.strengths),
      improvements: readText(item.improvements),
      corrections: readText(item.corrections),
      oneThing: readText(item.oneThing ?? item.one_thing ?? item.nextStep),
      clamped,
    });
  }

  return { marks, rejected, unmarked: expectedCodes.filter((c) => !seen.has(c.toUpperCase())) };
}
