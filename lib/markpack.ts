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
 * Quizzine builds a marking package — instructions, the rubric, the question,
 * the model answer, and the class's responses under opaque codes — the teacher
 * pastes it into whichever chatbot they use, and pastes the reply back. The
 * same idiom as the quiz-generation prompt in lib/aiprompt.ts, and for the same
 * reason: it costs nothing, needs no key, works with any model, and the teacher
 * can see exactly what was sent.
 *
 * Two rules shape everything here.
 *
 * The unit is ONE QUESTION and its responses, never the whole quiz. Marking one
 * question across a class is what produces consistent relative grading, for a
 * language model exactly as for a human; a 25,000-word dump of every question
 * saves two pastes and costs attention on every one of them.
 *
 * Names never enter a package. Responses are labelled R1, R2, … and the map
 * back to attempts lives only in Quizzine. That is the whole of how
 * anonymisation works in this mode, so it is not optional and there is no
 * setting for it.
 */

/** Response words per part, before a question is split. Long chats mark worse. */
export const PACKAGE_WORD_BUDGET = 8000;

export interface PackResponse {
  attemptId: string;
  /** The typed answer. Blank responses are dropped before a package is built. */
  text: string;
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
  qid: string;
  parts: PackPart[];
  /** Code → attempt. The only thing that can turn a marked code back into a student. */
  codeMap: Record<string, string>;
  /** Responses left out because nothing was typed. */
  blank: number;
  totalWords: number;
}

const rule = (s: string) => `\n${"-".repeat(60)}\n${s}\n${"-".repeat(60)}\n`;

function rubricSection(rubric: RubricConfig, weights: Record<string, number>): string {
  const lines: string[] = [];
  for (const band of rubric.bands) {
    const bandTotal = band.params.reduce((s, p) => s + (weights[p.id] ?? p.weight), 0);
    lines.push(`${band.label} — ${Math.round(bandTotal * 10) / 10} points in total`);
    for (const p of band.params) {
      const w = weights[p.id] ?? p.weight;
      lines.push(`  "${p.id}" — ${p.label} — score 0 to ${Math.round(w * 10) / 10}${p.hint ? `. ${p.hint}` : ""}`);
    }
  }
  return lines.join("\n");
}

function instructions(rubric: RubricConfig, weights: Record<string, number>, part: { index: number; total: number }): string {
  const ids = rubricParams(rubric).map((p) => `"${p.id}"`).join(", ");
  const total = Math.round(Object.values(weights).reduce((s, w) => s + w, 0) * 10) / 10;
  return [
    "You are marking student answers to ONE question against a fixed rubric. Follow these instructions exactly.",
    "",
    "1. Score EVERY parameter for EVERY response, as a number between 0 and that parameter's maximum. Never exceed the maximum.",
    `2. The parameter keys are exactly: ${ids}. Use these keys and no others. The scores for one response add up to at most ${total}.`,
    "3. Fill in all four feedback fields for every response: strengths, improvements, corrections, oneThing.",
    "   - strengths: what the answer actually does well, in specific terms.",
    "   - improvements: what would raise the mark, in specific terms.",
    "   - corrections: factual or textual errors that need correcting. Empty string if there are none.",
    "   - oneThing: the single most useful thing this student should fix next time. One sentence.",
    "4. Where a word limit is given, penalise overrunning it under the Craft & Discipline band (word-limit adherence), not elsewhere.",
    "5. You cannot check facts against the source, because you do not have it — you would be checking from memory, and memory is exactly what this rubric tells a marker not to trust. So DO NOT penalise a claim merely because you cannot verify it. Instead, name it in `corrections` as something the teacher should check, and mark factual accuracy on what you can actually judge (internal consistency, obvious error, claims the passage or model answer contradict).",
    "6. Judge each response on its own against the rubric, not against the other responses.",
    "7. Do not write anything outside the JSON. No preamble, no summary, no commentary.",
    "",
    part.total > 1
      ? `This is part ${part.index} of ${part.total} for this question. Mark only the responses given below. Use a FRESH CHAT for each part — a long conversation marks the later responses worse than the earlier ones.`
      : "",
    "",
    "Return ONLY a JSON array, one object per response, in exactly this shape:",
    "",
    "[",
    '  {',
    '    "code": "R1",',
    `    "scores": { ${rubricParams(rubric).slice(0, 3).map((p) => `"${p.id}": 0`).join(", ")}, ... },`,
    '    "strengths": "...",',
    '    "improvements": "...",',
    '    "corrections": "",',
    '    "oneThing": "..."',
    '  }',
    "]",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function questionSection(qn: Question): string {
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
  return lines.join("\n");
}

/**
 * Build the packages for one question. A question whose responses exceed the
 * word budget is split into self-contained parts — each carries the full
 * instructions, rubric, question and model answer, so a part can be pasted into
 * a fresh chat and stand entirely on its own.
 *
 * Codes run R1…Rn across the whole question and are unique within it, so a
 * teacher who marks part 2 first still cannot collide two students onto one
 * code.
 */
export function buildPackage(
  qn: Question,
  rubric: RubricConfig,
  weights: Record<string, number>,
  responses: PackResponse[],
  wordBudget: number = PACKAGE_WORD_BUDGET
): MarkingPackage {
  const usable = responses.filter((r) => r.text.trim() !== "");
  const blank = responses.length - usable.length;

  const coded = usable.map((r, i) => ({
    code: `R${i + 1}`,
    attemptId: r.attemptId,
    text: r.text.trim(),
    words: countWords(r.text),
  }));
  const codeMap = Object.fromEntries(coded.map((c) => [c.code, c.attemptId]));
  const totalWords = coded.reduce((s, c) => s + c.words, 0);

  // Chunk by word budget, but never emit an empty part: one response longer than
  // the whole budget still travels alone rather than being cut in half.
  const chunks: (typeof coded)[] = [];
  let current: typeof coded = [];
  let running = 0;
  for (const c of coded) {
    if (current.length && running + c.words > wordBudget) {
      chunks.push(current);
      current = [];
      running = 0;
    }
    current.push(c);
    running += c.words;
  }
  if (current.length) chunks.push(current);

  const parts: PackPart[] = chunks.map((chunk, i) => {
    const meta = { index: i + 1, total: chunks.length };
    const body = chunk
      .map((c) => `${rule(`${c.code} — ${c.words} words`)}${c.text}`)
      .join("\n");
    return {
      index: meta.index,
      total: meta.total,
      codes: chunk.map((c) => c.code),
      words: chunk.reduce((s, c) => s + c.words, 0),
      text: [
        instructions(rubric, weights, meta),
        "",
        "THE RUBRIC:",
        rubricSection(rubric, weights),
        "",
        questionSection(qn),
        "",
        `THE RESPONSES (${chunk.length}${chunks.length > 1 ? ` of ${coded.length}` : ""}). Mark every one of them:`,
        body,
        "",
        `Now return the JSON array for ${chunk.map((c) => c.code).join(", ")} and nothing else.`,
      ].join("\n"),
    };
  });

  return { qid: qn.id, parts, codeMap, blank, totalWords };
}

/**
 * Build a package containing only the codes still unmarked — what the UI offers
 * after a reply came back truncated. It is the same resumability an API route
 * would need, done by hand.
 */
export function remainderPackage(
  qn: Question,
  rubric: RubricConfig,
  weights: Record<string, number>,
  responses: PackResponse[],
  codeMap: Record<string, string>,
  unmarkedCodes: string[],
  wordBudget: number = PACKAGE_WORD_BUDGET
): MarkingPackage {
  const wanted = new Set(unmarkedCodes.map((c) => codeMap[c]).filter(Boolean));
  // Rebuilding from the original list would renumber the codes; the subset is
  // re-coded from the codes it already has, so a reply about R11 still lands on
  // the same student.
  const subset = responses.filter((r) => wanted.has(r.attemptId));
  const built = buildPackage(qn, rubric, weights, subset, wordBudget);

  // Restore the original codes: same order, so position maps one to one.
  const originals = unmarkedCodes.filter((c) => codeMap[c]);
  const rename = new Map<string, string>();
  Object.keys(built.codeMap).forEach((fresh, i) => {
    const original = originals.find((c) => codeMap[c] === built.codeMap[fresh]) ?? originals[i];
    if (original) rename.set(fresh, original);
  });

  const parts = built.parts.map((part) => ({
    ...part,
    codes: part.codes.map((c) => rename.get(c) ?? c),
    text: part.text.replace(/\bR\d+\b/g, (m) => rename.get(m) ?? m),
  }));
  const codeMapOut: Record<string, string> = {};
  for (const [fresh, attemptId] of Object.entries(built.codeMap)) {
    codeMapOut[rename.get(fresh) ?? fresh] = attemptId;
  }
  return { ...built, parts, codeMap: codeMapOut };
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
  /** Codes expected for this question that the reply never covered. */
  unmarked: string[];
  /** A reply that was not JSON at all fails here rather than half-applying. */
  error?: string;
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
            try {
              return JSON.parse(candidate.slice(start, i + 1));
            } catch {
              break; // try the next candidate/shape rather than guessing
            }
          }
        }
      }
    }
  }

  /*
   * A reply that stopped mid-array — the commonest failure with a long class —
   * still holds whole objects before the cut. They are salvaged rather than
   * thrown away, so the teacher only has to re-run the remainder instead of the
   * lot. Anything half-written is simply not balanced, so it never survives.
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
        try {
          out.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          // Not an object we can use; the next one may still be.
        }
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
 * Turn a pasted reply into marks.
 *
 * Attribution is mechanical, and that is the point: a code either matches a
 * response exactly or it is rejected. A mangled or invented code leaves that
 * response unmarked; it is never assigned to the nearest-looking student.
 */
export function parseAiReply(
  reply: string,
  expectedCodes: string[],
  weights: Record<string, number>
): ParseResult {
  const data = extractJson(reply);
  if (data === null) {
    return {
      marks: [],
      rejected: [],
      unmarked: [...expectedCodes],
      error: "No JSON was found in that reply. Copy the model's whole answer, including the square brackets.",
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
          : // A bare object keyed by code: {"R1": {...}, "R2": {...}}
            Object.entries(data as Record<string, unknown>)
              .filter(([k]) => /^R\d+$/i.test(k))
              .map(([k, v]) => ({ code: k, ...(v as Record<string, unknown>) }));

  if (!list.length) {
    return {
      marks: [],
      rejected: [],
      unmarked: [...expectedCodes],
      error: "That JSON held no marked responses.",
    };
  }

  const expected = new Set(expectedCodes);
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
      rejected.push({ code, reason: "not a code in this package — left unmarked rather than guessed at" });
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

    const params: Record<string, number> = {};
    const clamped: string[] = [];
    let anyScore = false;
    for (const [id, weight] of Object.entries(weights)) {
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
      percent: scorePercent(params, weights),
      strengths: readText(item.strengths),
      improvements: readText(item.improvements),
      corrections: readText(item.corrections),
      oneThing: readText(item.oneThing ?? item.one_thing ?? item.nextStep),
      clamped,
    });
  }

  return { marks, rejected, unmarked: expectedCodes.filter((c) => !seen.has(c)) };
}
