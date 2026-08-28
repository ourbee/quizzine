/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import type { Question } from "./types";

/**
 * One rubric, three reviewers.
 *
 * A rubric is a list of weighted parameters gathered into bands. Weights are
 * percentages of the whole and must sum to 100, which is what lets the same
 * rubric mark a 5-mark paragraph and a 40-mark essay: the reviewer scores a
 * percentage, and the marks are derived from it at read time
 * (`awarded = percent × points / 100`). Rescaling a question's points therefore
 * never destroys the diagnostic — see `awardedFor`.
 *
 * The teacher and the LLM score all ten parameters. Peers score the four bands
 * instead: ten parameters across several questions and three reviews is
 * fatigue-clicking territory, and a band-level judgement from a classmate is
 * worth more than a parameter-level one they stopped reading. Same rubric, two
 * zoom levels — see `bandCriteria`.
 */

export interface RubricParam {
  id: string;
  label: string;
  hint?: string;
  /** Percentage of the whole rubric this parameter is worth. */
  weight: number;
}

export interface RubricBand {
  id: string;
  label: string;
  params: RubricParam[];
}

export interface RubricConfig {
  bands: RubricBand[];
}

/** Total weight a rubric must add up to, in percentage points. */
export const RUBRIC_TOTAL = 100;

const MAX_BANDS = 8;
const MAX_PARAMS_PER_BAND = 10;

/**
 * The default: the paragraph/essay rubric this phase was built around,
 * normalised to percentages. The source document also carried an "8/6/4/2"
 * scale that contradicted its own weightings; percentages are the only thing
 * kept, because two scales that disagree are worse than one.
 */
export const LITERARY_RUBRIC: RubricConfig = {
  bands: [
    {
      id: "a",
      label: "Content & Correctness",
      params: [
        { id: "a1", label: "Correctness with respect to the question", weight: 15, hint: "Answers what was actually asked, not a neighbouring question." },
        { id: "a2", label: "Factual and textual accuracy", weight: 15, hint: "Check claims against the source, not from memory." },
        { id: "a3", label: "Use of evidence", weight: 10, hint: "Quotation or reference that earns its place, embedded and then read." },
      ],
    },
    {
      id: "b",
      label: "Argument & Thinking",
      params: [
        { id: "b1", label: "Analytical depth rather than summary", weight: 10, hint: "Says what the material does, not what it contains." },
        { id: "b2", label: "Independent critical position", weight: 10, hint: "A position held and defended, not a survey of other people's." },
        { id: "b3", label: "Structure and argumentative shape", weight: 10, hint: "The order of the paragraphs is itself an argument." },
      ],
    },
    {
      id: "c",
      label: "Language & Expression",
      params: [
        { id: "c1", label: "Grammar, punctuation, spelling, syntax", weight: 10 },
        { id: "c2", label: "Coherence and flow", weight: 5 },
        { id: "c3", label: "Precision and economy", weight: 5 },
      ],
    },
    {
      id: "d",
      label: "Craft & Discipline",
      params: [
        { id: "d1", label: "Terminology, register and word-limit adherence", weight: 10, hint: "Overrunning the word limit is penalised here." },
      ],
    },
  ],
};

const SHORT_FACTUAL: RubricConfig = {
  bands: [
    {
      id: "a",
      label: "Content & Correctness",
      params: [
        { id: "a1", label: "Correctness with respect to the question", weight: 35 },
        { id: "a2", label: "Factual and textual accuracy", weight: 25 },
        { id: "a3", label: "Use of evidence", weight: 10 },
      ],
    },
    {
      id: "c",
      label: "Language & Expression",
      params: [
        { id: "c1", label: "Grammar, punctuation, spelling, syntax", weight: 10 },
        { id: "c2", label: "Coherence and flow", weight: 10 },
      ],
    },
    {
      id: "d",
      label: "Craft & Discipline",
      params: [{ id: "d1", label: "Terminology, register and word-limit adherence", weight: 10 }],
    },
  ],
};

const WRITING_TASK: RubricConfig = {
  bands: [
    {
      id: "a",
      label: "Content & Task",
      params: [
        { id: "a1", label: "Answers the task set", weight: 12 },
        { id: "a2", label: "Relevant, accurate detail", weight: 8 },
      ],
    },
    {
      id: "b",
      label: "Organisation",
      params: [
        { id: "b1", label: "Structure and paragraphing", weight: 12 },
        { id: "b2", label: "Development of ideas", weight: 8 },
      ],
    },
    {
      id: "c",
      label: "Language & Expression",
      params: [
        { id: "c1", label: "Grammar, punctuation, spelling, syntax", weight: 20 },
        { id: "c2", label: "Coherence and flow", weight: 15 },
        { id: "c3", label: "Range and precision of vocabulary", weight: 15 },
      ],
    },
    {
      id: "d",
      label: "Craft & Discipline",
      params: [{ id: "d1", label: "Register and word-limit adherence", weight: 10 }],
    },
  ],
};

export interface RubricPreset {
  id: string;
  name: string;
  description: string;
  config: RubricConfig;
}

export const RUBRIC_PRESETS: RubricPreset[] = [
  {
    id: "literary",
    name: "Literary essay",
    description: "Content 40 · Argument 30 · Language 20 · Craft 10. The default.",
    config: LITERARY_RUBRIC,
  },
  {
    id: "short-factual",
    name: "Short factual answer",
    description: "Content 70 · Language 20 · Craft 10. Argument is not assessed.",
    config: SHORT_FACTUAL,
  },
  {
    id: "writing-task",
    name: "Writing task",
    description: "Content 20 · Organisation 20 · Language 50 · Craft 10.",
    config: WRITING_TASK,
  },
];

export const findRubricPreset = (id?: string | null): RubricPreset | undefined =>
  RUBRIC_PRESETS.find((p) => p.id === id);

export const DEFAULT_RUBRIC: RubricConfig = LITERARY_RUBRIC;

const clampWeight = (v: unknown, fallback: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(RUBRIC_TOTAL, Math.max(0, Math.round(n * 10) / 10));
};

const text = (v: unknown, fallback: string): string => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 120) : fallback;
};

/**
 * Coerce whatever is stored in settings into a usable rubric. Ids are made
 * unique because everything downstream — the stored scores, the marking
 * package, the paste-back parser — keys on them, and two parameters sharing an
 * id would silently share a score.
 */
export function normalizeRubricConfig(raw: unknown): RubricConfig {
  const src = (raw ?? {}) as Partial<RubricConfig>;
  const bandsIn = Array.isArray(src.bands) ? src.bands : [];
  if (!bandsIn.length) return DEFAULT_RUBRIC;

  const usedBand = new Set<string>();
  const usedParam = new Set<string>();
  const bands: RubricBand[] = [];

  for (const [i, band] of bandsIn.slice(0, MAX_BANDS).entries()) {
    let bandId = text(band?.id, `b${i + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, "") || `b${i + 1}`;
    while (usedBand.has(bandId)) bandId = `${bandId}_`;
    usedBand.add(bandId);

    const paramsIn = Array.isArray(band?.params) ? band.params : [];
    const params: RubricParam[] = [];
    for (const [j, param] of paramsIn.slice(0, MAX_PARAMS_PER_BAND).entries()) {
      let paramId =
        text(param?.id, `${bandId}${j + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, "") || `${bandId}${j + 1}`;
      while (usedParam.has(paramId)) paramId = `${paramId}_`;
      usedParam.add(paramId);
      const hint = String(param?.hint ?? "").replace(/\s+/g, " ").trim();
      params.push({
        id: paramId,
        label: text(param?.label, `Parameter ${j + 1}`),
        weight: clampWeight(param?.weight, 0),
        ...(hint ? { hint: hint.slice(0, 300) } : {}),
      });
    }
    if (!params.length) continue;
    bands.push({ id: bandId, label: text(band?.label, `Band ${i + 1}`), params });
  }

  return bands.length ? { bands } : DEFAULT_RUBRIC;
}

/** Every parameter, band by band, in the order the teacher will see them. */
export function rubricParams(config: RubricConfig): RubricParam[] {
  return config.bands.flatMap((b) => b.params);
}

/** What a band is worth: the sum of its own parameters, never stored separately. */
export const bandWeight = (band: RubricBand): number =>
  Math.round(band.params.reduce((s, p) => s + p.weight, 0) * 10) / 10;

export const rubricTotal = (config: RubricConfig): number =>
  Math.round(config.bands.reduce((s, b) => s + bandWeight(b), 0) * 10) / 10;

/** Why a rubric cannot be saved yet. Empty means it is publishable. */
export function rubricErrors(config: RubricConfig): string[] {
  const errors: string[] = [];
  const params = rubricParams(config);
  if (!params.length) {
    errors.push("A rubric needs at least one parameter.");
    return errors;
  }
  const total = rubricTotal(config);
  if (Math.abs(total - RUBRIC_TOTAL) > 0.05) {
    errors.push(
      `The weights add up to ${total}%, not ${RUBRIC_TOTAL}%. Adjust them by ${Math.round(Math.abs(RUBRIC_TOTAL - total) * 10) / 10} point${Math.abs(RUBRIC_TOTAL - total) === 1 ? "" : "s"}.`
    );
  }
  if (params.some((p) => p.weight <= 0)) {
    errors.push("Every parameter must be worth more than nothing — remove it instead of weighting it zero.");
  }
  return errors;
}

/**
 * The weights this question is marked on: its own override where it has one,
 * otherwise the quiz's rubric. An override that names only some parameters
 * leaves the rest at their rubric weight, so a teacher can lift one band on one
 * question without restating the whole thing.
 */
export function effectiveWeights(
  config: RubricConfig,
  overrides?: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of rubricParams(config)) {
    const override = overrides?.[p.id];
    out[p.id] = Number.isFinite(override) ? Math.max(0, Number(override)) : p.weight;
  }
  return out;
}

/** The weights a stored question is actually marked on. */
export const weightsForQuestion = (config: RubricConfig, qn: Pick<Question, "rubricWeights">) =>
  effectiveWeights(config, qn.rubricWeights);

/**
 * A reviewer's scores as a percentage of the total available. Each parameter is
 * clamped to its own weight, so a package that comes back with 20 out of a
 * weight of 10 cannot inflate the mark — it is capped and flagged instead.
 */
export function scorePercent(scores: Record<string, number>, weights: Record<string, number>): number {
  let awarded = 0;
  let possible = 0;
  for (const [id, weight] of Object.entries(weights)) {
    possible += weight;
    const raw = Number(scores?.[id]);
    if (Number.isFinite(raw)) awarded += Math.min(weight, Math.max(0, raw));
  }
  if (possible <= 0) return 0;
  return Math.round((awarded / possible) * 1000) / 10;
}

/** Marks from a percentage: the derivation that keeps percent and marks separate. */
export const awardedFor = (percent: number, points: number): number =>
  Math.round(((percent / 100) * points) * 100) / 100;

/** The band-level view of a set of parameter scores — what peers see, and the report. */
export function bandPercents(
  config: RubricConfig,
  scores: Record<string, number>,
  weights: Record<string, number>
): { id: string; label: string; weight: number; percent: number | null }[] {
  return config.bands.map((band) => {
    let awarded = 0;
    let possible = 0;
    let any = false;
    for (const p of band.params) {
      const weight = weights[p.id] ?? p.weight;
      possible += weight;
      const raw = Number(scores?.[p.id]);
      if (Number.isFinite(raw)) {
        any = true;
        awarded += Math.min(weight, Math.max(0, raw));
      }
    }
    return {
      id: band.id,
      label: band.label,
      weight: Math.round(possible * 10) / 10,
      percent: any && possible > 0 ? Math.round((awarded / possible) * 1000) / 10 : null,
    };
  });
}

/**
 * The rubric's bands as peer-review criteria — one criterion per band, worth
 * the band's own weight. Peers therefore mark the same rubric the teacher does,
 * one zoom level out.
 */
export function bandCriteria(config: RubricConfig): { id: string; label: string; max: number }[] {
  return config.bands
    .map((band) => ({ id: band.id, label: band.label, max: Math.round(bandWeight(band)) }))
    .filter((c) => c.max > 0);
}

/**
 * The five-step descriptor scale peers score on, mapped onto a criterion's
 * weight. A continuous slider invites false precision and aggregates worse; five
 * named steps is what reviewers can actually tell apart.
 */
export const DESCRIPTORS = ["Very poor", "Poor", "Fair", "Good", "Excellent"] as const;

/** Marks a descriptor step (0–4) is worth out of `max`: 0, 25, 50, 75, 100%. */
export const descriptorValue = (step: number, max: number): number =>
  Math.round(((Math.min(4, Math.max(0, step)) / 4) * max) * 100) / 100;

/** The step a stored score sits on, or null when it is off the scale entirely. */
export function descriptorStep(value: number, max: number): number | null {
  if (!Number.isFinite(value) || max <= 0) return null;
  const step = Math.round((value / max) * 4);
  return Math.abs(descriptorValue(step, max) - value) < 0.01 ? step : null;
}
