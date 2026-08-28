/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import type { AbilityEstimate, MstConfig } from "./mst";
import type { PeerConfig } from "./peer";
import type { RubricConfig } from "./rubric";

/** The input control a question uses. Whether it is scored is a separate matter — see `graded`. */
export type QType = "mcq" | "multi" | "short" | "essay";

export interface Option {
  key: string; // "A".."F"
  text: string;
  feedback?: string;
}

export interface Question {
  id: string;
  type: QType;
  text: string;
  /**
   * Material the student reads before answering — a poem, a sample response, a
   * paragraph of theory. Repeating the same text on consecutive questions is
   * how one block is attached to several: see `groupByPassage`.
   */
  passage?: string;
  passageTitle?: string; // heading on the block, e.g. "Sample response"
  media?: string; // image / audio / YouTube URL
  options: Option[]; // empty for short/essay
  correct?: string; // option key, mcq only
  correctKeys?: string[]; // option keys, multi only
  /**
   * false = collected but never scored (opinion polls, surveys, work destined for
   * peer review). Absent means graded, so quizzes saved before this existed still
   * behave exactly as they did.
   */
  graded?: boolean;
  points: number; // always 0 when graded is false
  feedbackCorrect?: string;
  feedbackIncorrect?: string;
  /**
   * What this question is testing, written `Dimension: Value`
   * ("Period: Victorian"). One question carries as many as it likes and counts
   * into every one of them — see lib/tags.ts. Absent means untagged, which is
   * only a loss to the strengths-and-weaknesses report, never to grading.
   */
  tags?: string[];
  /** 1 (very easy) to 5 (very difficult). Routes the adaptive exam; reported as
   *  its own dimension everywhere else. Absent means unstated. */
  difficulty?: number;
  /**
   * Written answers only: how many words the answer should run to. Advisory by
   * default — the counter warns, the rubric penalises overrunning under Craft &
   * Discipline, and nothing stops the student typing. `hardWordLimit` on the
   * quiz turns it into a cap. Absent means no limit.
   */
  wordLimit?: number;
  /**
   * Per-question rubric weights, keyed by parameter id, overriding the quiz's
   * own. Naming only some parameters leaves the rest at their rubric weight.
   * Absent means the quiz default — see lib/rubric.ts.
   */
  rubricWeights?: Record<string, number>;
}

export type TimerMode = "none" | "quiz" | "question";

/**
 * Whole-quiz stance on scoring. "survey", "peer" and "rubric" all leave every
 * question unmarked at submission; a peer-reviewed quiz is scored later by
 * classmates, a rubric-marked one by the teacher (with an optional AI pass they
 * review). Only the teacher's click releases either.
 */
export type GradingMode = "graded" | "survey" | "peer" | "rubric";

/** How a multi-answer question is marked when the student's set is not exact. */
export type MultiScoring = "exact" | "partial";

export interface QuizSettings {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  gradingMode?: GradingMode; // absent === "graded"
  multiScoring?: MultiScoring; // absent === "exact"
  timerMode: TimerMode;
  maxMinutes?: number; // timerMode "quiz"
  perQuestionSeconds?: number; // timerMode "question"
  /**
   * Sit the student in a layout modelled on national-level competitive exams:
   * one question at a time, a status palette, and answers that only count once
   * saved. Absent means off, so every quiz saved before this behaves as it did.
   * Never combined with timerMode "question" — see the note in lib/examstate.ts.
   */
  examMode?: boolean;
  /**
   * Deliver the paper adaptively, in stages: everyone sits the same first
   * stage, and each stage after that is drawn harder or easier according to how
   * the last one went. Absent means off. Sits happily alongside `examMode` —
   * the palette then covers the current stage, which is the one thing a student
   * can still move around in. See lib/mst.ts for why staging, not per question.
   */
  mstMode?: boolean;
  mst?: MstConfig;
  closesAt?: string; // ISO datetime; stop accepting new starts
  allowMultiple: boolean;
  groupMode?: boolean; // one submission per group instead of per student
  groupMin?: number; // members per group, inclusive bounds
  groupMax?: number;
  peer?: PeerConfig; // present when gradingMode is "peer"
  /**
   * The rubric written answers are marked against. Present when gradingMode is
   * "rubric", and also when a peer-reviewed quiz sources its criteria from the
   * rubric's bands — same rubric, two zoom levels. See lib/rubric.ts.
   */
  rubric?: RubricConfig;
  /** Peers score the rubric's bands rather than a criteria list of their own. */
  peerFromRubric?: boolean;
  /**
   * Block pasting into written answers. A deterrent, not a security control —
   * trivially defeated, and it breaks legitimate offline drafting and
   * transliteration tools, which paste. Absent means off.
   */
  pasteGuard?: boolean;
  /** Stop typing at the word limit instead of merely warning. Absent means off. */
  hardWordLimit?: boolean;
}

export interface Quiz {
  id: string;
  slug: string;
  title: string;
  description?: string;
  introMedia?: string;
  questions: Question[];
  settings: QuizSettings;
  theme: string;
  accepting: boolean;
  createdAt: string;
}

export interface StudentInfo {
  name: string;
  roll: string;
  semester: number;
  nameNorm: string;
  rollNorm: string;
}

export interface GroupMember {
  name: string;
  roll: string;
}

export interface GroupInfo {
  name: string;
  nameNorm: string;
  semester: number;
  members: GroupMember[];
}

export interface PerQuestionResult {
  qid: string;
  answer?: string; // choice keys are comma-joined for multi ("A,C")
  correct?: boolean; // full marks; undefined when pending or ungraded
  awarded: number;
  pending: boolean;
  /** Collected but not scored — neither right, wrong, nor awaiting marking. */
  ungraded?: boolean;
}

export interface AttemptFlags {
  late?: boolean;
}

export interface ReviewPayload {
  quizTitle: string;
  theme: string;
  student: StudentInfo;
  group?: GroupInfo;
  questions: Question[];
  per: PerQuestionResult[];
  score: number;
  max: number;
  pending: number;
  /** Nothing in this quiz is scored — show a confirmation, not a mark. */
  survey: boolean;
  /** Unmarked for now because classmates will mark it later. */
  peerReview?: boolean;
  /** Unmarked for now because the teacher marks it against a rubric and releases it. */
  rubricMode?: boolean;
  flags: AttemptFlags;
  submittedAt: string;
  /** Adaptive papers only, and only when the teacher asked for it. */
  ability?: AbilityEstimate;
}

export interface ParsedQuiz {
  title?: string;
  description?: string;
  questions: RawQuestion[];
  /** Parser-level remarks (e.g. fields skipped) shown alongside validation warnings. */
  notes?: string[];
}

/** Loosely-typed question straight out of a parser, before validation. */
export interface RawQuestion {
  text?: string;
  type?: string;
  passage?: string;
  passageTitle?: string;
  media?: string;
  options: { key: string; text: string; feedback?: string }[];
  correct?: string; // one key, or several ("A,C") for a multi-answer question
  /** Explicit "this is not scored" from the file; type aliases can imply it too. */
  graded?: string | boolean;
  points?: string | number;
  feedbackCorrect?: string;
  feedbackIncorrect?: string;
  /** Raw Tags cell, or an already-split list from JSON. */
  tags?: string | string[];
  /** Raw Difficulty cell: 1–5, or a word like "hard". */
  difficulty?: string | number;
  /** Raw WordLimit cell for a written answer. */
  wordLimit?: string | number;
}
