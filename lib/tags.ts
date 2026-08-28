/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * Dimensioned tags — the labels that turn a mark into a diagnosis.
 *
 * A tag is written `Dimension: Value` ("Period: Victorian"). Anything without a
 * colon falls into the default dimension, so a teacher who just types "Prosody"
 * is never wrong, only less precise. One question carries as many as it likes
 * and counts into every bucket it names, which is the whole point: a question
 * can be Modernist AND poetry AND close reading at the same time.
 *
 * Matching is case- and spacing-insensitive, because "Victorian", "victorian"
 * and "Victorian " must never become three separate weaknesses. Display keeps
 * whatever the teacher actually wrote.
 */

/** Tags with no dimension of their own are filed here. */
export const DEFAULT_DIMENSION = "Topic";

/**
 * Difficulty is a tag like any other in the report, but the adaptive exam reads
 * it as a number, so it lives in its own field on the question and is only
 * *shown* as a dimension. Writing "Difficulty: 3" in the Tags cell works too —
 * the parser lifts it out into that field.
 */
export const DIFFICULTY_DIMENSION = "Difficulty";

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;

/** What each difficulty level is called, indexed 1–5. */
export const DIFFICULTY_LABELS: Record<number, string> = {
  1: "Very easy",
  2: "Easy",
  3: "Medium",
  4: "Difficult",
  5: "Very difficult",
};

const DIFFICULTY_WORDS: Record<string, number> = {
  veryeasy: 1,
  verysimple: 1,
  beginner: 1,
  easy: 2,
  simple: 2,
  basic: 2,
  medium: 3,
  moderate: 3,
  average: 3,
  intermediate: 3,
  standard: 3,
  hard: 4,
  difficult: 4,
  challenging: 4,
  advanced: 4,
  veryhard: 5,
  verydifficult: 5,
  hardest: 5,
  expert: 5,
};

/** Read a Difficulty cell: a number 1–5, or a word teachers actually write. */
export function readDifficulty(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  const n = Number(s);
  if (Number.isFinite(n)) {
    const rounded = Math.round(n);
    if (rounded < MIN_DIFFICULTY || rounded > MAX_DIFFICULTY) return undefined;
    return rounded;
  }
  const word = s.toLowerCase().replace(/[\s_-]+/g, "");
  return DIFFICULTY_WORDS[word];
}

export function difficultyLabel(level: number): string {
  return DIFFICULTY_LABELS[level] ?? `Level ${level}`;
}

export interface ParsedTag {
  dimension: string;
  value: string;
}

const MAX_TAG_LEN = 60;
const MAX_TAGS_PER_QUESTION = 12;

/** Collapse whitespace and trim, without touching case. */
const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Split one `Dimension: Value` tag. Only the FIRST colon separates, so a value
 * may contain one ("Text: Ulysses: a reading"). A colon with nothing before or
 * after it is treated as no dimension at all rather than an empty one.
 */
export function parseTag(raw: string): ParsedTag | null {
  const text = tidy(String(raw ?? ""));
  if (!text) return null;
  const at = text.indexOf(":");
  if (at === -1) {
    return { dimension: DEFAULT_DIMENSION, value: text.slice(0, MAX_TAG_LEN) };
  }
  const dimension = tidy(text.slice(0, at));
  const value = tidy(text.slice(at + 1));
  if (!dimension || !value) {
    const fallback = tidy(text.replace(/:/g, " "));
    return fallback ? { dimension: DEFAULT_DIMENSION, value: fallback.slice(0, MAX_TAG_LEN) } : null;
  }
  return { dimension: dimension.slice(0, MAX_TAG_LEN), value: value.slice(0, MAX_TAG_LEN) };
}

/** The stored, canonical spelling of a tag. */
export function formatTag(tag: ParsedTag): string {
  return tag.dimension === DEFAULT_DIMENSION ? tag.value : `${tag.dimension}: ${tag.value}`;
}

/** Case- and spacing-insensitive identity — two tags are the same bucket iff these match. */
export function tagKey(tag: ParsedTag): string {
  return `${loose(tag.dimension)}|${loose(tag.value)}`;
}

/**
 * The looser key used to CATCH DRIFT rather than to bucket: punctuation and a
 * trailing plural are dropped, so "Victorian Age", "victorian-age" and
 * "Victorian Ages" collapse together and can be offered for merging.
 */
export function looseKey(tag: ParsedTag): string {
  return `${loose(tag.dimension)}|${stem(tag.value)}`;
}

const loose = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Strip punctuation and a trailing plural so "Poetries" and "Poetry" land on
 * one key. Words already ending in a double s keep it, so "Progress" is not
 * quietly turned into a different word.
 */
function stem(s: string): string {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (base.length > 4 && base.endsWith("ies")) return `${base.slice(0, -3)}y`;
  if (base.length > 3 && base.endsWith("s") && !base.endsWith("ss")) return base.slice(0, -1);
  return base;
}

/**
 * Split a Tags cell into individual tags. Semicolons, newlines and commas all
 * separate, which is what teachers type without being told; the trade-off is
 * that a tag value cannot itself contain a comma.
 */
export function splitTagCell(cell: unknown): string[] {
  if (cell === undefined || cell === null) return [];
  return String(cell)
    .split(/[;,\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Clean a list of raw tag strings into stored form: parsed, canonical, deduped
 * by bucket and capped. The first spelling of a bucket wins, so one question
 * never carries "Victorian" and "victorian" as two tags.
 */
export function normalizeTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : splitTagCell(raw);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const parsed = parseTag(String(item ?? ""));
    if (!parsed) continue;
    const key = tagKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(formatTag(parsed));
    if (out.length >= MAX_TAGS_PER_QUESTION) break;
  }
  return out;
}

/**
 * Pull a difficulty written as a tag out of the tag list. Returns the remaining
 * tags and the level, so `Difficulty: 4` in a Tags cell reaches the same field
 * a Difficulty column would have filled.
 */
export function extractDifficulty(tags: string[]): { tags: string[]; difficulty?: number } {
  const kept: string[] = [];
  let difficulty: number | undefined;
  for (const t of tags) {
    const parsed = parseTag(t);
    if (parsed && loose(parsed.dimension) === loose(DIFFICULTY_DIMENSION)) {
      difficulty ??= readDifficulty(parsed.value);
      continue;
    }
    kept.push(t);
  }
  return { tags: kept, difficulty };
}

/** Every distinct dimension in a set of tags, in first-seen order. */
export function dimensionsOf(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    const parsed = parseTag(t);
    if (!parsed) continue;
    const key = loose(parsed.dimension);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed.dimension);
  }
  return out;
}

// ---------- presets ----------

/**
 * A named vocabulary. Presets are suggestions, never a fence: a tag outside the
 * preset is flagged at upload so drift is caught early, but it is still saved,
 * because no list survives contact with a real syllabus.
 */
export interface TagPreset {
  id: string;
  name: string;
  description: string;
  /** Ordered — the report shows dimensions in this order. */
  dimensions: { name: string; values: string[] }[];
}

const NET_ENGLISH_UNITS = [
  "Unit 1 Drama",
  "Unit 2 Poetry",
  "Unit 3 Fiction, short story",
  "Unit 4 Non-fictional prose",
  "Unit 5 Language: basic concepts",
  "Unit 6 English in India",
  "Unit 7 Cultural studies",
  "Unit 8 Literary criticism",
  "Unit 9 Literary theory post World War II",
  "Unit 10 Research methods and materials",
];

export const TAG_PRESETS: TagPreset[] = [
  {
    id: "ugc-net-english",
    name: "UGC NET English",
    description: "Periods, genres, skills and the ten NTA units of Paper II.",
    dimensions: [
      {
        name: "Unit",
        values: NET_ENGLISH_UNITS,
      },
      {
        name: "Period",
        values: [
          "Old English",
          "Middle English",
          "Renaissance",
          "Elizabethan",
          "Jacobean",
          "Restoration",
          "Neoclassical",
          "Romantic",
          "Victorian",
          "Modernism",
          "Postmodernism",
          "Contemporary",
        ],
      },
      {
        name: "Genre",
        values: [
          "Poetry",
          "Drama",
          "Novel",
          "Short story",
          "Non-fictional prose",
          "Criticism",
          "Literary theory",
          "Autobiography",
        ],
      },
      {
        name: "Skill",
        values: [
          "Factual recall",
          "Chronology",
          "Close reading",
          "Textual attribution",
          "Critical terminology",
          "Theory application",
          "Match the following",
          "Assertion and reasoning",
        ],
      },
      { name: "Author", values: [] },
      { name: "Text", values: [] },
      {
        name: DIFFICULTY_DIMENSION,
        values: [1, 2, 3, 4, 5].map((n) => `${n} — ${difficultyLabel(n)}`),
      },
    ],
  },
  {
    id: "general",
    name: "General teaching",
    description: "Topic, skill and difficulty — a starting point for any subject.",
    dimensions: [
      { name: "Topic", values: [] },
      { name: "Skill", values: ["Recall", "Understanding", "Application", "Analysis", "Evaluation"] },
      { name: "Unit", values: [] },
      {
        name: DIFFICULTY_DIMENSION,
        values: [1, 2, 3, 4, 5].map((n) => `${n} — ${difficultyLabel(n)}`),
      },
    ],
  },
];

export const findPreset = (id?: string | null): TagPreset | undefined =>
  TAG_PRESETS.find((p) => p.id === id);

/** Every tag a preset explicitly names, in stored form. Open dimensions (Author,
 *  Text) contribute nothing, since anything is a valid value there. */
export function presetTags(preset: TagPreset): string[] {
  const out: string[] = [];
  for (const d of preset.dimensions) {
    for (const v of d.values) out.push(formatTag({ dimension: d.name, value: v }));
  }
  return out;
}

/** Dimensions the preset names, whether or not it fixes their values. */
export const presetDimensions = (preset: TagPreset): string[] => preset.dimensions.map((d) => d.name);

/**
 * Tags that are not in the preset's vocabulary. A value under an open dimension
 * (one the preset lists with no values, like Author) is always accepted.
 */
export function tagsOutsidePreset(tags: string[], preset: TagPreset): string[] {
  const open = new Set(
    preset.dimensions.filter((d) => d.values.length === 0).map((d) => loose(d.name))
  );
  const known = new Set(presetTags(preset).map((t) => tagKey(parseTag(t)!)));
  const out: string[] = [];
  for (const t of tags) {
    const parsed = parseTag(t);
    if (!parsed) continue;
    if (open.has(loose(parsed.dimension))) continue;
    if (known.has(tagKey(parsed))) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

// ---------- drift ----------

export interface TagVariantGroup {
  /** The spelling used on the most questions — the one worth keeping. */
  keep: string;
  /** Spellings that would be folded into it, most-used first. */
  merge: string[];
  /** How many questions carry each spelling, keyed by the stored tag. */
  counts: Record<string, number>;
}

/**
 * Spellings that are probably one tag: same dimension, and values that match
 * once punctuation and a trailing plural are ignored, or that differ by a
 * single typo. Suggestions only — nothing merges until a teacher confirms it,
 * exactly as with roll numbers.
 */
export function tagVariants(counts: Record<string, number>): TagVariantGroup[] {
  const entries = Object.entries(counts)
    .map(([tag, n]) => ({ tag, n, parsed: parseTag(tag) }))
    .filter((e): e is { tag: string; n: number; parsed: ParsedTag } => !!e.parsed)
    // Difficulty is generated, never typed freehand, so it cannot drift.
    .filter((e) => loose(e.parsed.dimension) !== loose(DIFFICULTY_DIMENSION));

  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = looseKey(e.parsed);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  // Near-misses that the loose key alone does not catch: one typo apart.
  const keys = [...groups.keys()];
  const merged = new Map<string, string>(); // key -> the key it joins
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i];
      const b = keys[j];
      if (merged.has(b)) continue;
      const [dimA, valA] = a.split("|");
      const [dimB, valB] = b.split("|");
      if (dimA !== dimB) continue;
      if (Math.min(valA.length, valB.length) < 4) continue;
      if (editDistance(valA, valB) !== 1) continue;
      merged.set(b, resolveTarget(a, merged));
    }
  }
  for (const [from, to] of merged) {
    const source = groups.get(from);
    const target = groups.get(to);
    if (!source || !target) continue;
    groups.set(to, [...target, ...source]);
    groups.delete(from);
  }

  const out: TagVariantGroup[] = [];
  for (const group of groups.values()) {
    // Collapse to one row per distinct stored spelling.
    const byTag = new Map<string, number>();
    for (const e of group) byTag.set(e.tag, (byTag.get(e.tag) ?? 0) + e.n);
    if (byTag.size < 2) continue;
    const sorted = [...byTag.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    out.push({
      keep: sorted[0][0],
      merge: sorted.slice(1).map(([tag]) => tag),
      counts: Object.fromEntries(sorted),
    });
  }
  return out.sort((a, b) => a.keep.localeCompare(b.keep));
}

function resolveTarget(key: string, merged: Map<string, string>): string {
  let current = key;
  const seen = new Set([current]);
  for (;;) {
    const next = merged.get(current);
    if (!next || seen.has(next)) return current;
    seen.add(next);
    current = next;
  }
}

/**
 * Damerau–Levenshtein distance, stopped as soon as it exceeds 1 — all this
 * needs. Swapped neighbouring letters count as one edit rather than two, since
 * "Victorain" for "Victorian" is the single commonest way a tag gets mistyped
 * and plain Levenshtein would score it too far apart to notice.
 */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const restA = a.length - i - j;
  const restB = b.length - i - j;
  if (restA <= 1 && restB <= 1) return Math.max(restA, restB);
  if (restA === 2 && restB === 2 && a[i] === b[i + 1] && a[i + 1] === b[i]) return 1;
  return 2;
}

/** Apply confirmed merges to one question's tags. */
export function applyTagMerges(tags: string[], merges: Record<string, string>): string[] {
  const lookup = new Map<string, string>();
  for (const [from, to] of Object.entries(merges)) {
    const parsed = parseTag(from);
    if (parsed) lookup.set(tagKey(parsed), to);
  }
  return normalizeTags(
    tags.map((t) => {
      const parsed = parseTag(t);
      if (!parsed) return t;
      return lookup.get(tagKey(parsed)) ?? t;
    })
  );
}

// ---------- ingest ----------

/**
 * Tag hygiene at the door.
 *
 * A vocabulary is the exact spellings a teacher already uses. Incoming tags are
 * matched against it on the bucket key — casefolded, whitespace collapsed,
 * punctuation-insensitive per side of the `Dimension: Value` split — and where
 * one matches, THE EXISTING SPELLING IS STORED. The vocabulary always wins, so
 * "Unit 7 Cultural Studies" arriving beside an established "Unit 7 Cultural
 * studies" is quietly adopted into it rather than founding a second bucket.
 *
 * This kills every pure case, spacing and punctuation split at ingest. What it
 * deliberately does not do is merge wording variants — "Unit 9 Literary theory
 * post World War II" against "Unit 9 Literary Theory (Post World War II)" is a
 * judgement, not a normalisation, so it is surfaced as a suggestion instead
 * (`tagNearMisses`) and only a teacher's click applies it.
 */
export interface TagVocabulary {
  /** bucket key → the exact spelling already in use. */
  byKey: Map<string, string>;
  /** looser key (punctuation and plurals dropped) → the exact spellings using it. */
  byLoose: Map<string, string[]>;
  tags: string[];
}

export function buildVocabulary(tags: Iterable<string>): TagVocabulary {
  const byKey = new Map<string, string>();
  const byLoose = new Map<string, string[]>();
  const list: string[] = [];
  for (const raw of tags) {
    const parsed = parseTag(String(raw ?? ""));
    if (!parsed) continue;
    const stored = formatTag(parsed);
    const key = tagKey(parsed);
    if (!byKey.has(key)) {
      byKey.set(key, stored);
      list.push(stored);
    }
    const loose = looseKey(parsed);
    const existing = byLoose.get(loose) ?? [];
    if (!existing.includes(byKey.get(key)!)) byLoose.set(loose, [...existing, byKey.get(key)!]);
  }
  return { byKey, byLoose, tags: list };
}

/** Rewrite a question's tags into the vocabulary's own spellings where they match. */
export function canonicalizeTags(tags: string[], vocab: TagVocabulary): string[] {
  return normalizeTags(
    tags.map((t) => {
      const parsed = parseTag(t);
      if (!parsed) return t;
      return vocab.byKey.get(tagKey(parsed)) ?? t;
    })
  );
}

export interface TagNearMiss {
  /** The incoming spelling, as it would be stored. */
  incoming: string;
  /** The established spelling it is probably a variant of. */
  existing: string;
}

/**
 * Wording-level variants that canonicalisation cannot safely fold on its own:
 * same dimension, values that agree once punctuation and a trailing plural are
 * ignored, or that differ by a single typo. Suggestions for the upload preview,
 * never applied without a click.
 */
export function tagNearMisses(tags: Iterable<string>, vocab: TagVocabulary): TagNearMiss[] {
  const out: TagNearMiss[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const parsed = parseTag(String(raw ?? ""));
    if (!parsed) continue;
    if (loose(parsed.dimension) === loose(DIFFICULTY_DIMENSION)) continue;
    const stored = formatTag(parsed);
    // Already an exact bucket match: canonicalisation has it, nothing to ask.
    if (vocab.byKey.has(tagKey(parsed))) continue;
    if (seen.has(stored)) continue;

    const candidates = vocab.byLoose.get(looseKey(parsed)) ?? [];
    let existing = candidates[0];
    if (!existing) {
      // One typo apart, the way "Victorain" is one typo from "Victorian".
      const [dim, value] = looseKey(parsed).split("|");
      for (const [key, spellings] of vocab.byLoose) {
        const [otherDim, otherValue] = key.split("|");
        if (otherDim !== dim) continue;
        if (Math.min(value.length, otherValue.length) < 4) continue;
        if (editDistance(value, otherValue) !== 1) continue;
        existing = spellings[0];
        break;
      }
    }
    if (!existing || existing === stored) continue;
    seen.add(stored);
    out.push({ incoming: stored, existing });
  }
  return out;
}
