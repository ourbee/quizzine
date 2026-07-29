/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

export type QType = "mcq" | "short" | "essay";

export interface Option {
  key: string; // "A".."F"
  text: string;
  feedback?: string;
}

export interface Question {
  id: string;
  type: QType;
  text: string;
  passage?: string;
  media?: string; // image / audio / YouTube URL
  options: Option[]; // empty for short/essay
  correct?: string; // option key, mcq only
  points: number;
  feedbackCorrect?: string;
  feedbackIncorrect?: string;
}

export type TimerMode = "none" | "quiz" | "question";

export interface QuizSettings {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  timerMode: TimerMode;
  maxMinutes?: number; // timerMode "quiz"
  perQuestionSeconds?: number; // timerMode "question"
  closesAt?: string; // ISO datetime; stop accepting new starts
  allowMultiple: boolean;
  groupMode?: boolean; // one submission per group instead of per student
  groupMin?: number; // members per group, inclusive bounds
  groupMax?: number;
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
  answer?: string;
  correct?: boolean; // undefined when pending
  awarded: number;
  pending: boolean;
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
  flags: AttemptFlags;
  submittedAt: string;
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
  media?: string;
  options: { key: string; text: string; feedback?: string }[];
  correct?: string;
  points?: string | number;
  feedbackCorrect?: string;
  feedbackIncorrect?: string;
}
