/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  countStatuses,
  LEGEND_ORDER,
  STATUS_STYLES,
  statusOf,
  submitSummary,
  type ExamProgress,
  type ExamStatus,
} from "@/lib/examstate";
import { joinKeys, splitKeys } from "@/lib/questions";
import Material from "@/components/Material";
import Media from "@/components/Media";

interface ShellOption { key: string; text: string }
export interface ShellQuestion {
  id: string;
  type: "mcq" | "multi" | "short" | "essay";
  text: string;
  passage?: string;
  passageTitle?: string;
  media?: string;
  points: number;
  graded: boolean;
  options: ShellOption[];
}

interface Props {
  questions: ShellQuestion[];
  /** Saved answers only — a pending choice lives in this component, not here. */
  answers: Record<string, string>;
  progress: ExamProgress;
  index: number;
  /** Milliseconds left on the whole paper, or null when the quiz is untimed. */
  remainingMs: number | null;
  candidate: string;
  quizTitle: string;
  subtitle?: string;
  submitting: boolean;
  submitError?: string;
  onIndexChange: (index: number) => void;
  onSaveAnswer: (qid: string, answer: string) => void;
  onSetMarked: (qid: string, marked: boolean) => void;
  onSubmit: () => void;
  /**
   * Adaptive papers only: which stage of how many is on screen. The palette,
   * the counts and the confirmation all describe the CURRENT stage, because
   * that is the whole of what the student can still move around in — a closed
   * stage is gone, exactly as a locked section is in the real examination.
   */
  stage?: { number: number; total: number; last: boolean };
}

function fmtExamClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** The palette tile. Its shape carries as much meaning as its colour, so the
 *  legend and the grid must draw them the same way. */
function StatusTile({
  status,
  label,
  onClick,
  current,
}: {
  status: ExamStatus;
  label: string;
  onClick?: () => void;
  current?: boolean;
}) {
  const s = STATUS_STYLES[status];
  const shape =
    s.shape === "circle"
      ? "rounded-full"
      : s.shape === "flag"
        ? "rounded-md [clip-path:polygon(0_0,100%_0,100%_72%,50%_100%,0_72%)]"
        : "rounded-md";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-current={current ? "true" : undefined}
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center border text-xs font-bold tabular-nums ${shape} ${
        onClick ? "cursor-pointer" : "cursor-default"
      } ${current ? "ring-2 ring-offset-2 ring-sky-500" : ""}`}
      style={{ background: s.bg, color: s.fg, borderColor: s.border }}
    >
      {label}
      {status === "answeredMarked" && (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border border-white"
          style={{ background: STATUS_STYLES.answered.bg }}
        />
      )}
    </button>
  );
}

export default function ExamShell({
  questions,
  answers,
  progress,
  index,
  remainingMs,
  candidate,
  quizTitle,
  subtitle,
  submitting,
  submitError,
  onIndexChange,
  onSaveAnswer,
  onSetMarked,
  onSubmit,
  stage,
}: Props) {
  const question = questions[index];
  /**
   * The choice on screen, which is *not* an answer yet. The real examination
   * discards a selection the moment you leave the question without saving, and
   * rehearsing that is the whole point of this interface — so the draft resets
   * on every move and only a Save button writes it through.
   */
  const [draft, setDraft] = useState<string>("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  // Arriving at a question shows its saved answer, if it has one, and nothing else.
  useEffect(() => {
    setDraft(answers[question?.id] ?? "");
    paneRef.current?.scrollTo({ top: 0 });
    // Deliberately keyed on the question alone: re-running when `answers` changes
    // would let a save further up the page overwrite what is being typed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id]);

  const qids = useMemo(() => questions.map((q) => q.id), [questions]);
  const counts = countStatuses(qids, answers, progress);
  const summary = submitSummary(qids, answers, progress);

  if (!question) return null;

  const isLast = index >= questions.length - 1;
  const go = (to: number) => {
    setPaletteOpen(false);
    onIndexChange(Math.max(0, Math.min(questions.length - 1, to)));
  };

  // The four action buttons, in the reference interface's own terms.
  const saveAndNext = () => {
    onSaveAnswer(question.id, draft);
    onSetMarked(question.id, false);
    if (!isLast) go(index + 1);
  };
  const clear = () => setDraft("");
  const saveAndMark = () => {
    onSaveAnswer(question.id, draft);
    onSetMarked(question.id, true);
    if (!isLast) go(index + 1);
  };
  const markAndNext = () => {
    onSetMarked(question.id, true);
    if (!isLast) go(index + 1);
  };

  const toggleDraftKey = (key: string) => {
    const picked = splitKeys(draft);
    setDraft(joinKeys(picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key]));
  };

  const choice = question.type === "mcq" || question.type === "multi";
  const unsaved = draft.trim() !== (answers[question.id] ?? "").trim();

  const legend = (
    <div className="grid grid-cols-1 gap-2.5 border border-dashed border-slate-400 p-3 sm:grid-cols-2">
      {LEGEND_ORDER.map((status) => (
        <div key={status} className="flex items-center gap-2">
          <StatusTile
            status={status}
            label={String(
              status === "notVisited"
                ? counts.notVisited
                : status === "notAnswered"
                  ? counts.notAnswered
                  : status === "answered"
                    ? counts.answered
                    : status === "marked"
                      ? counts.marked
                      : counts.answeredMarked
            )}
          />
          <span className="text-xs leading-tight text-slate-700">{STATUS_STYLES[status].label}</span>
        </div>
      ))}
    </div>
  );

  const grid = (
    <div className="flex flex-wrap gap-2">
      {questions.map((qn, i) => (
        <StatusTile
          key={qn.id}
          status={statusOf(qn.id, answers, progress)}
          label={String(i + 1).padStart(2, "0")}
          current={i === index}
          onClick={() => go(i)}
        />
      ))}
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-white text-slate-900">
      {/* ---------- candidate header ---------- */}
      <header className="border-b border-slate-300 bg-slate-100 px-3 py-2 sm:px-5 sm:py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1">
          <dl className="min-w-0 text-[11px] leading-5 sm:text-xs">
            <div className="flex gap-1.5">
              <dt className="text-slate-500">Candidate Name :</dt>
              <dd className="truncate font-semibold text-orange-700">{candidate}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-slate-500">Exam Name :</dt>
              <dd className="truncate font-semibold text-orange-700">{quizTitle}</dd>
            </div>
            {subtitle && (
              <div className="flex gap-1.5">
                <dt className="text-slate-500">Subject Name :</dt>
                <dd className="truncate font-semibold text-orange-700">{subtitle}</dd>
              </div>
            )}
          </dl>
          {remainingMs !== null && (
            <div className="flex items-center gap-1.5 text-[11px] sm:text-xs">
              <span className="text-slate-500">Remaining Time :</span>
              <span
                className={`rounded px-2 py-0.5 font-mono font-bold tabular-nums text-white ${
                  remainingMs < 60_000 ? "bg-red-600" : "bg-sky-500"
                }`}
              >
                {fmtExamClock(remainingMs)}
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-0 lg:flex-row">
        {/* ---------- question pane ---------- */}
        <div ref={paneRef} className="flex min-w-0 flex-1 flex-col overflow-y-auto px-3 pb-3 pt-4 sm:px-5">
          <h2 className="border-b border-slate-300 pb-1.5 text-base font-bold">
            Question {index + 1}:
            {question.graded && (
              <span className="ml-2 text-xs font-medium text-slate-500">{question.points} mark{question.points === 1 ? "" : "s"}</span>
            )}
          </h2>

          <div className="flex-1 py-4">
            <Material
              text={question.passage}
              title={question.passageTitle}
              colours={{ border: "#cbd5e1", muted: "#64748b", accentSoft: "#f8fafc" }}
            />
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{question.text}</p>
            <Media url={question.media} />

            {choice ? (
              <>
                {question.type === "multi" && (
                  <p className="mt-3 text-xs font-semibold text-slate-600">Select all that apply.</p>
                )}
                <ol className="mt-4 space-y-2.5">
                  {question.options.map((o, i) => {
                    const selected =
                      question.type === "multi" ? splitKeys(draft).includes(o.key) : draft === o.key;
                    return (
                      <li key={o.key}>
                        <label className="flex cursor-pointer items-start gap-3 rounded border border-transparent px-2 py-1.5 text-[15px] hover:bg-slate-50">
                          <input
                            type={question.type === "multi" ? "checkbox" : "radio"}
                            name={`q-${question.id}`}
                            checked={selected}
                            onChange={() =>
                              question.type === "multi"
                                ? toggleDraftKey(o.key)
                                : setDraft(selected ? "" : o.key)
                            }
                            className="mt-1 h-4 w-4 shrink-0 accent-sky-600"
                          />
                          <span className="shrink-0 tabular-nums text-slate-500">{i + 1})</span>
                          <span className="flex-1">{o.text}</span>
                        </label>
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={question.type === "essay" ? 10 : 4}
                placeholder="Type your answer…"
                className="mt-4 w-full rounded border border-slate-400 px-3 py-2 text-[15px] focus:border-sky-500 focus:outline-none"
              />
            )}

            {unsaved && (
              <p className="mt-3 text-xs font-medium text-amber-700">
                Not saved yet — use <strong>Save &amp; Next</strong>, or this will be discarded when you leave.
              </p>
            )}
          </div>

          {/* ---------- action buttons ---------- */}
          <div className="sticky bottom-0 border-t border-slate-300 bg-white pt-3">
            <div className="grid grid-cols-2 gap-2 text-[11px] font-bold uppercase tracking-wide sm:flex sm:flex-wrap sm:text-xs">
              <button type="button" onClick={saveAndNext} className="rounded bg-green-600 px-3 py-2.5 text-white hover:bg-green-700">
                Save &amp; Next
              </button>
              <button type="button" onClick={clear} className="rounded border border-slate-400 bg-white px-3 py-2.5 text-slate-700 hover:bg-slate-50">
                Clear
              </button>
              <button type="button" onClick={saveAndMark} className="rounded bg-orange-500 px-3 py-2.5 text-white hover:bg-orange-600">
                Save &amp; Mark for Review
              </button>
              <button type="button" onClick={markAndNext} className="rounded bg-sky-700 px-3 py-2.5 text-white hover:bg-sky-800">
                Mark for Review &amp; Next
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-200 pt-2">
              <div className="flex gap-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => go(index - 1)}
                  disabled={index === 0}
                  className="rounded border border-slate-400 px-3 py-2 disabled:opacity-40"
                >
                  &lt;&lt; BACK
                </button>
                <button
                  type="button"
                  onClick={() => go(index + 1)}
                  disabled={isLast}
                  className="rounded border border-slate-400 px-3 py-2 disabled:opacity-40"
                >
                  NEXT &gt;&gt;
                </button>
              </div>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={submitting}
                className="rounded bg-green-600 px-5 py-2 text-xs font-bold uppercase text-white hover:bg-green-700 disabled:opacity-50"
              >
                {submitting ? (stage && !stage.last ? "Saving…" : "Submitting…") : stage && !stage.last ? "Submit section" : "Submit"}
              </button>
            </div>
            {submitError && <p className="pb-2 pt-1 text-xs text-red-600">{submitError}</p>}
          </div>
        </div>

        {/* ---------- palette: a rail on desktop ---------- */}
        <aside className="hidden w-72 shrink-0 border-l border-slate-300 bg-white px-4 py-4 lg:block">
          {legend}
          <div className="mt-4 max-h-[55vh] overflow-y-auto pr-1">{grid}</div>
        </aside>
      </div>

      {/* ---------- palette: a bottom sheet on phones ---------- */}
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="sticky bottom-0 z-20 flex items-center justify-between gap-2 border-t border-slate-300 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-white lg:hidden"
      >
        <span className="tabular-nums">
          {summary.answered} answered · {summary.flagged} flagged · {summary.notAnswered} left
        </span>
        <span className="rounded bg-white/15 px-2 py-1">Question palette ▲</span>
      </button>

      {paletteOpen && (
        <div className="fixed inset-0 z-30 flex flex-col justify-end bg-black/40 lg:hidden" onClick={() => setPaletteOpen(false)}>
          <div className="max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold">Question palette</h3>
              <button type="button" onClick={() => setPaletteOpen(false)} className="rounded px-2 py-1 text-sm text-slate-500">
                Close ✕
              </button>
            </div>
            {legend}
            <div className="mt-4">{grid}</div>
          </div>
        </div>
      )}

      {/* ---------- submit confirmation ---------- */}
      {confirming && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold">
              {stage && !stage.last ? `Finish section ${stage.number}?` : "Submit your paper?"}
            </h3>
            {stage && (
              <p className="mt-1 text-xs text-slate-500">
                {stage.last
                  ? `This is the last section of ${stage.total}.`
                  : `Section ${stage.number} of ${stage.total}. The next section is chosen from how this one goes, so you cannot come back to these questions.`}
              </p>
            )}
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Total questions</dt><dd className="font-semibold tabular-nums">{summary.total}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Answered</dt><dd className="font-semibold tabular-nums text-green-700">{summary.answered}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Not answered</dt><dd className="font-semibold tabular-nums text-red-600">{summary.notAnswered}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Marked for review</dt><dd className="font-semibold tabular-nums text-purple-700">{summary.flagged}</dd></div>
            </dl>
            {unsaved && (
              <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-800">
                The choice on screen has not been saved and will not be submitted.
              </p>
            )}
            {summary.notAnswered > 0 && (
              <p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">
                {summary.notAnswered} question{summary.notAnswered === 1 ? " is" : "s are"} still unanswered. You cannot return
                {stage && !stage.last ? " to this section." : " after submitting."}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="flex-1 rounded border border-slate-400 px-4 py-2.5 text-sm font-semibold">
                Go back
              </button>
              <button
                type="button"
                onClick={() => { setConfirming(false); onSubmit(); }}
                disabled={submitting}
                className="flex-1 rounded bg-green-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {stage && !stage.last ? "Next section" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
