/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * What each quiz setting actually does, written once.
 *
 * These sentences used to live only on the New Quiz page, spelled out beneath
 * every checkbox, while the Edit page offered the same settings as bare labels
 * with no explanation at all. A teacher meeting "Adaptive paper (multistage)"
 * for the first time on the edit screen had nowhere to find out what it was.
 *
 * So the copy moves here and both screens read from it — the same discipline as
 * `lib/aiprompt.ts`, for the same reason: two hand-kept copies of an
 * explanation drift, and the one that drifts is always the one nobody is
 * looking at.
 *
 * Every entry carries an `example`. The `body` says what a setting does; the
 * example says what it looks like when it is on, which is the part that makes
 * somebody confident enough to tick the box.
 */

export interface HelpEntry {
  /** The setting's name, as the label beside the control reads. */
  title: string;
  /** What it does, in the teacher's terms rather than the system's. */
  body: string;
  /** One concrete instance. Kept to a line — it is read inside a balloon. */
  example: string;
}

export const HELP = {
  examMode: {
    title: "Exam Interface mode",
    body:
      "Students see one question at a time in a layout modelled on national-level competitive examinations — a question palette showing what is answered, skipped or flagged, plus Save & Next and Mark for Review controls. Answers count only once saved, as in the real thing. Use it to let students rehearse the interface itself, not just the questions.",
    example:
      "e.g. a UGC-NET rehearsal: the palette down the side, Save & Next along the bottom, and an answer left unsaved not counted.",
  },

  mstMode: {
    title: "Adaptive paper (multistage)",
    body:
      "The paper is dealt in sections rather than all at once. Everyone sits the same first section; each section after it is drawn harder or easier according to how the last one went, so one bank of questions gives a stronger and a weaker student a paper pitched at each of them. Students move freely inside a section but cannot return to one they have finished. Combine it with Exam Interface mode for a full rehearsal. Needs a Difficulty on your questions.",
    example:
      "e.g. four sections of ten: score 70% or more on one and the next is drawn harder, 40% or less and it is drawn easier.",
  },

  groupMode: {
    title: "Who attempts this",
    body:
      "Whether the paper is sat by one student or by a group working together. On a group paper one member submits for everybody: they enter the group name, the semester, and every member's name and roll number before starting, and the marks are recorded against all of them.",
    example: "e.g. a seminar exercise sat in threes, submitted once, marked for all three.",
  },

  shuffleQuestions: {
    title: "Shuffle questions",
    body: "Every student gets the questions in a different order, so neighbours cannot follow one another down the paper.",
    example: "e.g. your question 4 is somebody else's question 11.",
  },

  shuffleOptions: {
    title: "Shuffle options",
    body:
      "The options inside each question are reordered per student. Answers are recorded by what was chosen, not by where it sat, so marking is unaffected.",
    example: "e.g. \"C\" is no longer the same answer at two desks — so \"it's C\" travels nowhere.",
  },

  allowMultiple: {
    title: "Allow more than one attempt",
    body:
      "The same roll number may sit the paper again. Useful for practice; on anything that counts, leave it off so one roll number means one attempt.",
    example: "e.g. a revision set students work through until they get full marks.",
  },

  timer: {
    title: "Timing & deadline",
    body:
      "Two different clocks. The timer limits how long a student has once they begin; the deadline is the moment after which nobody may begin at all. They are independent — a paper can be untimed with a deadline, or timed and open indefinitely.",
    example: "e.g. thirty minutes each, and no new starts after Friday night.",
  },

  timerQuiz: {
    title: "Whole-quiz limit",
    body: "One clock for the whole paper, started when the student starts. They may move about the paper freely inside it.",
    example: "e.g. thirty minutes for forty questions, spent however the student likes.",
  },

  timerQuestion: {
    title: "Per-question countdown",
    body:
      "Each question gets its own few seconds, one at a time, and the student cannot go back. A rapid-fire round rather than an examination.",
    example: "e.g. forty-five seconds a question in a quick vocabulary drill.",
  },

  deadline: {
    title: "Stop accepting responses",
    body:
      "After this moment nobody new may begin. A student already sitting the paper is not cut off mid-attempt. Every preset lands at 11:59 pm, so a deadline never falls in the middle of an afternoon.",
    example: "e.g. \"7 days\" clicked on Wednesday closes at 11:59 pm the following Wednesday.",
  },

  multiScoring: {
    title: "Marking multiple-answer questions",
    body:
      "How to mark a question with more than one right option: all or nothing, or a share of the marks per correct tick with each wrong tick cancelling one.",
    example: "e.g. three of five right on a 5-mark question — nothing under all-or-nothing, 3 marks under partial credit.",
  },
} as const satisfies Record<string, HelpEntry>;

export type HelpKey = keyof typeof HELP;
