/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * How a written answer was typed — counts only.
 *
 * Never the clipboard's contents, never a keystroke, never a word of what was
 * pasted. What is kept is how many times paste happened and how many characters
 * arrived that way, how often the tab lost focus, how long the student was
 * actively typing, and the shape of the answer's growth over time.
 *
 * It produces badges on the marking screen, in the same spirit as the existing
 * `late` and duplicate flags: an answer that went from nothing to 1,400
 * characters in one step looks different from one that grew, and a teacher can
 * see that at a glance and then use their judgement. There is no score, no
 * threshold and no verdict here, because a number that claims to detect
 * authorship would be believed, and it would be wrong.
 *
 * Students are told this is recorded, on the intro screen, before they start.
 */

export interface QuestionTelemetry {
  pasteCount: number;
  pasteChars: number;
  blurCount: number;
  activeSeconds: number;
  /** [seconds since the attempt started, characters typed so far], sampled. */
  growth: [number, number][];
}

export type TelemetryRecord = Record<string, QuestionTelemetry>;

/** How often the growth curve is sampled, and how many points are ever kept. */
export const GROWTH_INTERVAL_MS = 30_000;
export const MAX_GROWTH_POINTS = 200;

export const emptyTelemetry = (): QuestionTelemetry => ({
  pasteCount: 0,
  pasteChars: 0,
  blurCount: 0,
  activeSeconds: 0,
  growth: [],
});

const count = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(1_000_000, n) : 0;
};

export function normalizeTelemetry(raw: unknown): TelemetryRecord {
  if (!raw || typeof raw !== "object") return {};
  const out: TelemetryRecord = {};
  for (const [qid, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const src = value as Partial<QuestionTelemetry>;
    const growth: [number, number][] = Array.isArray(src.growth)
      ? src.growth
          .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2)
          .map(([t, c]) => [count(t), count(c)] as [number, number])
          .slice(-MAX_GROWTH_POINTS)
      : [];
    out[qid] = {
      pasteCount: count(src.pasteCount),
      pasteChars: count(src.pasteChars),
      blurCount: count(src.blurCount),
      activeSeconds: count(src.activeSeconds),
      growth,
    };
  }
  return out;
}

export interface TelemetryBadge {
  label: string;
  /** "plain" states a fact; "notable" is worth a second look, never an accusation. */
  tone: "plain" | "notable";
}

/**
 * The badges shown beside a response. A paste is only notable when it was large
 * — quoting a line of the set text is ordinary work, and flagging it would
 * teach the teacher to ignore the badges.
 */
export function telemetryBadges(t: QuestionTelemetry | undefined, answerChars: number): TelemetryBadge[] {
  if (!t) return [];
  const badges: TelemetryBadge[] = [];
  if (t.pasteCount > 0) {
    const share = answerChars > 0 ? t.pasteChars / answerChars : 0;
    badges.push({
      label: `${t.pasteCount} paste${t.pasteCount === 1 ? "" : "s"} · ${t.pasteChars.toLocaleString()} characters`,
      tone: t.pasteChars >= 200 && share >= 0.5 ? "notable" : "plain",
    });
  }
  if (t.blurCount >= 5) {
    badges.push({ label: `left the tab ${t.blurCount} times`, tone: "plain" });
  }
  if (t.activeSeconds > 0) {
    const mins = Math.round(t.activeSeconds / 60);
    badges.push({ label: mins >= 1 ? `${mins} min typing` : `${t.activeSeconds}s typing`, tone: "plain" });
  }
  return badges;
}

/**
 * The largest jump in the growth curve, as a share of the finished answer. A
 * single step that carries most of the answer is what a sparkline shows at a
 * glance; this is the same fact in a number, for sorting and for a caption.
 */
export function largestJump(t: QuestionTelemetry | undefined): { chars: number; share: number } {
  if (!t?.growth.length) return { chars: 0, share: 0 };
  let biggest = t.growth[0][1];
  for (let i = 1; i < t.growth.length; i++) {
    biggest = Math.max(biggest, t.growth[i][1] - t.growth[i - 1][1]);
  }
  const final = t.growth[t.growth.length - 1][1];
  return { chars: biggest, share: final > 0 ? Math.round((biggest / final) * 100) / 100 : 0 };
}

/**
 * The collector the student's browser runs while a written answer is typed.
 *
 * Kept as a plain class rather than React state on purpose: it is written on
 * every keystroke and must never cause a render. Active typing is counted as
 * time between keystrokes that are close enough together to be one stretch of
 * work — a gap longer than `IDLE_GAP_MS` is a pause, not typing, and counting
 * it would turn "left the tab open over lunch" into two hours of effort.
 */
const IDLE_GAP_MS = 8_000;

export class TelemetryCollector {
  private data: TelemetryRecord = {};
  private startedAt = Date.now();
  private lastKeystroke: Record<string, number> = {};
  private lastSample: Record<string, number> = {};

  constructor(existing?: TelemetryRecord, startedAt?: number) {
    if (existing) this.data = normalizeTelemetry(existing);
    if (startedAt) this.startedAt = startedAt;
  }

  private slot(qid: string): QuestionTelemetry {
    this.data[qid] ??= emptyTelemetry();
    return this.data[qid];
  }

  paste(qid: string, chars: number) {
    const slot = this.slot(qid);
    slot.pasteCount += 1;
    slot.pasteChars += Math.max(0, Math.floor(chars));
  }

  blur(qid: string) {
    this.slot(qid).blurCount += 1;
  }

  /** Called on every change to a written answer, with the answer's new length. */
  typed(qid: string, length: number) {
    const slot = this.slot(qid);
    const now = Date.now();
    const previous = this.lastKeystroke[qid];
    if (previous && now - previous < IDLE_GAP_MS) {
      slot.activeSeconds += Math.round((now - previous) / 1000);
    }
    this.lastKeystroke[qid] = now;

    const sampledAt = this.lastSample[qid] ?? 0;
    if (now - sampledAt >= GROWTH_INTERVAL_MS || slot.growth.length === 0) {
      this.lastSample[qid] = now;
      slot.growth.push([Math.round((now - this.startedAt) / 1000), length]);
      // Halve the curve rather than dropping its head: the shape of the whole
      // attempt matters more than the resolution of any part of it.
      if (slot.growth.length > MAX_GROWTH_POINTS) {
        slot.growth = slot.growth.filter((_, i) => i % 2 === 0 || i === slot.growth.length - 1);
      }
    }
  }

  /** Close the curve on what was finally typed, and hand over what was counted. */
  snapshot(finalLengths: Record<string, number> = {}): TelemetryRecord {
    for (const [qid, length] of Object.entries(finalLengths)) {
      const slot = this.data[qid];
      if (!slot) continue;
      const last = slot.growth[slot.growth.length - 1];
      if (!last || last[1] !== length) {
        slot.growth.push([Math.round((Date.now() - this.startedAt) / 1000), length]);
      }
    }
    return normalizeTelemetry(this.data);
  }
}
