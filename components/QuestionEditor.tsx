/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { correctKeysOf, isGraded } from "@/lib/questions";
import { difficultyLabel, normalizeTags } from "@/lib/tags";
import type { QType, Question } from "@/lib/types";

/**
 * A question as it is being written.
 *
 * `tagText` is the raw contents of the tag box, kept alongside the parsed
 * `tags` so that a half-typed tag — "Period: Vic" — survives a re-render
 * instead of being normalised out from under the cursor. It is never stored:
 * both callers strip it before the question is sent anywhere.
 */
export interface EditableQuestion extends Question {
  tagText?: string;
}

/** Drop the editing-only field, so what is saved is exactly a Question. */
export function stripEditing(questions: EditableQuestion[]): Question[] {
  return questions.map(({ tagText: _tagText, ...qn }) => qn);
}

/** Put a question into the editor's shape, seeding the tag box from its tags. */
export function toEditable(qn: Question): EditableQuestion {
  return { ...qn, tagText: (qn.tags ?? []).join("; ") };
}

const KEYS = ["A", "B", "C", "D", "E", "F"];

const TYPE_LABELS: [QType, string][] = [
  ["mcq", "Multiple choice — one answer"],
  ["multi", "Multiple choice — several answers"],
  ["short", "Short written answer"],
  ["essay", "Essay / long written answer"],
];

const isChoiceType = (t: QType) => t === "mcq" || t === "multi";

/** Options relettered A, B, C… so the keys always match the order on screen. */
function reletter(options: Question["options"]): Question["options"] {
  return options.map((o, i) => ({ ...o, key: KEYS[i] ?? `X${i}` }));
}

/** A fresh question of the given kind, ready to be typed over. */
export function blankQuestion(type: QType = "mcq", graded = true): EditableQuestion {
  const base: EditableQuestion = {
    id: "",
    type,
    text: "",
    options: [],
    points: graded ? 1 : 0,
    tagText: "",
  };
  if (!graded) base.graded = false;
  if (isChoiceType(type)) {
    base.options = KEYS.slice(0, 4).map((key) => ({ key, text: "" }));
    if (graded && type === "mcq") base.correct = "A";
    if (graded && type === "multi") base.correctKeys = ["A"];
  } else {
    base.wordLimit = type === "essay" ? 250 : 60;
  }
  return base;
}

/**
 * The one place a question is written, used both when a quiz is being built and
 * when a published one is edited. The two screens differ only in what they do
 * with the result: the new-quiz flow renumbers ids freely, while an edit keeps
 * every id it was given — see lib/edit.ts for why that matters.
 */
export default function QuestionEditor({
  questions,
  onChange,
  unscored = false,
  showIds = false,
}: {
  questions: EditableQuestion[];
  onChange: (next: EditableQuestion[]) => void;
  /** The whole quiz is unmarked (a survey, or work classmates will mark), so
   *  marks and answer keys are not the teacher's to set here. */
  unscored?: boolean;
  /** Show the stored question id — useful only once students have answers against it. */
  showIds?: boolean;
}) {
  function patch(i: number, change: Partial<EditableQuestion>) {
    onChange(questions.map((qn, j) => (j === i ? { ...qn, ...change } : qn)));
  }

  function move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  function duplicate(i: number) {
    const copy: EditableQuestion = {
      ...questions[i],
      // A duplicate is a new question, never the one students already answered.
      id: "",
      options: questions[i].options.map((o) => ({ ...o })),
    };
    onChange([...questions.slice(0, i + 1), copy, ...questions.slice(i + 1)]);
  }

  function remove(i: number) {
    onChange(questions.filter((_, j) => j !== i));
  }

  function add(type: QType) {
    onChange([...questions, blankQuestion(type, !unscored)]);
  }

  /** Change the control a question uses, carrying across what still applies. */
  function setType(i: number, type: QType) {
    const qn = questions[i];
    if (qn.type === type) return;
    if (isChoiceType(type)) {
      const options = qn.options.length >= 2 ? qn.options : KEYS.slice(0, 4).map((key) => ({ key, text: "" }));
      const keys = correctKeysOf(qn).filter((k) => options.some((o) => o.key === k));
      patch(i, {
        type,
        options: reletter(options),
        correct: type === "mcq" ? (keys[0] ?? options[0]?.key) : undefined,
        correctKeys: type === "multi" ? (keys.length ? keys : [options[0]?.key]).filter(Boolean) : undefined,
        wordLimit: undefined,
      });
      return;
    }
    // A written answer has no options and no key; its model answer is what the
    // marking is judged against, and that lives in feedbackCorrect either way.
    patch(i, {
      type,
      options: [],
      correct: undefined,
      correctKeys: undefined,
      wordLimit: qn.wordLimit ?? (type === "essay" ? 250 : 60),
    });
  }

  /** Turn scoring on or off for one question — a poll inside a marked paper. */
  function setGraded(i: number, graded: boolean) {
    const qn = questions[i];
    patch(i, {
      graded: graded ? undefined : false,
      points: graded ? Math.max(1, qn.points || 1) : 0,
      // An unscored choice question has no right answer to remember.
      correct: graded ? (qn.correct ?? (qn.type === "mcq" ? qn.options[0]?.key : undefined)) : undefined,
      correctKeys: graded ? qn.correctKeys : undefined,
    });
  }

  function setOption(i: number, oi: number, change: { text?: string; feedback?: string }) {
    const qn = questions[i];
    patch(i, {
      options: qn.options.map((o, j) =>
        j === oi ? { ...o, ...change, feedback: change.feedback !== undefined ? change.feedback || undefined : o.feedback } : o
      ),
    });
  }

  function addOption(i: number) {
    const qn = questions[i];
    if (qn.options.length >= KEYS.length) return;
    patch(i, { options: reletter([...qn.options, { key: "", text: "" }]) });
  }

  function removeOption(i: number, oi: number) {
    const qn = questions[i];
    if (qn.options.length <= 2) return;
    const kept = reletter(qn.options.filter((_, j) => j !== oi));
    // Keys shift when one goes, so the answer key is rebuilt from the options
    // that survived rather than from letters that now mean something else.
    const stillCorrect = correctKeysOf(qn)
      .map((k) => qn.options.findIndex((o) => o.key === k))
      .filter((idx) => idx >= 0 && idx !== oi)
      .map((idx) => kept[idx > oi ? idx - 1 : idx]?.key)
      .filter((k): k is string => !!k);
    patch(i, {
      options: kept,
      correct: qn.type === "mcq" ? (stillCorrect[0] ?? kept[0]?.key) : undefined,
      correctKeys: qn.type === "multi" ? stillCorrect : undefined,
    });
  }

  function toggleCorrect(i: number, key: string) {
    const qn = questions[i];
    const keys = correctKeysOf(qn);
    if (qn.type === "multi") {
      patch(i, { correctKeys: keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key].sort(), correct: undefined });
    } else {
      patch(i, { correct: key, correctKeys: undefined });
    }
  }

  return (
    <div className="space-y-3">
      {questions.map((qn, i) => {
        const scored = !unscored && isGraded(qn);
        const keys = correctKeysOf(qn);
        const written = qn.type === "short" || qn.type === "essay";
        return (
          <div key={`${qn.id || "new"}-${i}`} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-400">
                  Q{i + 1}
                  {showIds && qn.id && <span className="ml-1 font-normal text-slate-300">({qn.id})</span>}
                </span>
                <select
                  value={qn.type}
                  onChange={(e) => setType(i, e.target.value as QType)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-700"
                  aria-label={`Type of question ${i + 1}`}
                >
                  {TYPE_LABELS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {!unscored && (
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={scored} onChange={(e) => setGraded(i, e.target.checked)} className="h-3.5 w-3.5" />
                    Scored
                  </label>
                )}
              </div>
              <div className="flex gap-1">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move question ${i + 1} up`} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                  ↑
                </button>
                <button onClick={() => move(i, 1)} disabled={i === questions.length - 1} aria-label={`Move question ${i + 1} down`} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                  ↓
                </button>
                <button onClick={() => duplicate(i)} className="rounded px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">
                  Duplicate
                </button>
                <button
                  onClick={() => remove(i)}
                  disabled={questions.length <= 1}
                  title={questions.length <= 1 ? "A quiz needs at least one question." : undefined}
                  className="rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-30"
                >
                  Remove
                </button>
              </div>
            </div>

            <textarea
              value={qn.text}
              onChange={(e) => patch(i, { text: e.target.value })}
              rows={2}
              placeholder="Type the question here"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {isChoiceType(qn.type) && (
              <div className="mt-2 space-y-1.5">
                {scored && (
                  <p className="text-xs text-slate-500">
                    {qn.type === "multi"
                      ? "Click every letter that is correct — students must tick them all."
                      : "Click the letter of the correct answer."}
                  </p>
                )}
                {qn.options.map((o, oi) => {
                  const right = scored && keys.includes(o.key);
                  return (
                    <div key={o.key} className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => scored && toggleCorrect(i, o.key)}
                        disabled={!scored}
                        title={scored ? (right ? "Correct answer" : "Mark as correct") : "This question is not scored"}
                        aria-label={`Option ${o.key}${right ? " — correct" : ""}`}
                        className={`w-7 shrink-0 rounded px-1 py-1 text-xs font-bold ${
                          right ? "bg-green-600 text-white" : "bg-slate-100 text-slate-500"
                        } ${scored ? "" : "cursor-default"}`}
                      >
                        {o.key}
                      </button>
                      <input
                        value={o.text}
                        onChange={(e) => setOption(i, oi, { text: e.target.value })}
                        placeholder={`Option ${o.key}`}
                        className="min-w-40 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                      />
                      <input
                        value={o.feedback ?? ""}
                        onChange={(e) => setOption(i, oi, { feedback: e.target.value })}
                        placeholder="Feedback if picked (optional)"
                        className="min-w-40 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700"
                      />
                      <button
                        onClick={() => removeOption(i, oi)}
                        disabled={qn.options.length <= 2}
                        aria-label={`Remove option ${o.key}`}
                        className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
                <button
                  onClick={() => addOption(i)}
                  disabled={qn.options.length >= KEYS.length}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                >
                  Add option
                </button>
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={qn.tagText ?? (qn.tags ?? []).join("; ")}
                onChange={(e) => patch(i, { tagText: e.target.value, tags: normalizeTags(e.target.value) })}
                placeholder="Tags — Period: Victorian; Genre: Poetry"
                className="min-w-56 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
              />
              <select
                value={qn.difficulty ?? ""}
                onChange={(e) => patch(i, { difficulty: e.target.value ? Number(e.target.value) : undefined })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700"
                aria-label={`Difficulty of question ${i + 1}`}
              >
                <option value="">Difficulty —</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} · {difficultyLabel(n)}
                  </option>
                ))}
              </select>
              {scored && (
                <label className="text-sm text-slate-600">
                  Marks
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={qn.points}
                    onChange={(e) => patch(i, { points: Number(e.target.value) || 0 })}
                    className="ml-1 w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-slate-900"
                  />
                </label>
              )}
              {written && (
                <label className="text-sm text-slate-600">
                  Word limit
                  <input
                    type="number"
                    min={1}
                    placeholder="—"
                    value={qn.wordLimit ?? ""}
                    onChange={(e) => patch(i, { wordLimit: Number(e.target.value) > 0 ? Math.round(Number(e.target.value)) : undefined })}
                    className="ml-1 w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-slate-900"
                  />
                </label>
              )}
            </div>

            {written && (
              <label className="mt-2 block text-sm text-slate-600">
                Model answer — what the marking is judged against, and what students read once you release
                <textarea
                  value={qn.feedbackCorrect ?? ""}
                  onChange={(e) => patch(i, { feedbackCorrect: e.target.value || undefined })}
                  rows={3}
                  placeholder="Write the answer you are marking against."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </label>
            )}

            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                Reading material, media and general feedback
              </summary>
              <div className="mt-2 space-y-2">
                <label className="block text-xs text-slate-600">
                  Heading for the material (optional)
                  <input
                    value={qn.passageTitle ?? ""}
                    onChange={(e) => patch(i, { passageTitle: e.target.value || undefined })}
                    placeholder="Sample response — write yours like this"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                  />
                </label>
                <label className="block text-xs text-slate-600">
                  Material students read before answering — a passage, a sample response, some theory. Put the same
                  text on neighbouring questions and it is shown once, above them all.
                  <textarea
                    value={qn.passage ?? ""}
                    onChange={(e) => patch(i, { passage: e.target.value || undefined })}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </label>
                <label className="block text-xs text-slate-600">
                  Image, audio or YouTube link
                  <input
                    value={qn.media ?? ""}
                    onChange={(e) => patch(i, { media: e.target.value || undefined })}
                    placeholder="https://…"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                  />
                </label>
                {!written && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block text-xs text-slate-600">
                      Feedback when they get it right
                      <textarea
                        value={qn.feedbackCorrect ?? ""}
                        onChange={(e) => patch(i, { feedbackCorrect: e.target.value || undefined })}
                        rows={2}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                      />
                    </label>
                    <label className="block text-xs text-slate-600">
                      Feedback when they get it wrong
                      <textarea
                        value={qn.feedbackIncorrect ?? ""}
                        onChange={(e) => patch(i, { feedbackIncorrect: e.target.value || undefined })}
                        rows={2}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                      />
                    </label>
                  </div>
                )}
              </div>
            </details>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs font-semibold text-slate-400">Add a question:</span>
        {TYPE_LABELS.map(([type, label]) => (
          <button
            key={type}
            onClick={() => add(type)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            + {label}
          </button>
        ))}
      </div>
    </div>
  );
}
