/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { awardedFor, scorePercent, type RubricConfig } from "@/lib/rubric";
import { scoreLabel } from "@/lib/score";
import { buildPackage, parseAiReply, remainderPackage, type PackInput, type PackScope } from "@/lib/markpack";
import { largestJump, telemetryBadges, type QuestionTelemetry } from "@/lib/telemetry";
import { countWords } from "@/lib/words";
import type { MarkingRecord } from "@/lib/marking";
import type { Question } from "@/lib/types";
import Material from "@/components/Material";

/**
 * Marking written answers.
 *
 * Question by question by default — all the answers to Q1, then all the answers
 * to Q2. Marking one question across a class is what produces consistent
 * relative grading; going attempt by attempt means re-reading the rubric from
 * scratch forty times and drifting a little each time. The per-student view is
 * there for the moment a teacher wants to see one person whole.
 *
 * The marking package follows the same three scopes: one question, one student,
 * or the whole quiz. The default stays "one question" because it marks best,
 * but a teacher who would rather make one round trip than twelve can, and the
 * package splits itself by word budget either way.
 *
 * Where an AI pass has run, its scores pre-fill the controls and say so. They
 * are suggestions in the plainest sense: editable, discardable, and never
 * released by anything but the teacher's own click.
 */

interface MarkQuestion {
  id: string;
  text: string;
  passage?: string;
  passageTitle?: string;
  points: number;
  type: string;
  wordLimit?: number;
  modelAnswer?: string;
  weights: Record<string, number>;
}

interface MarkAttempt {
  id: string;
  name: string;
  roll: string;
  answers: Record<string, string>;
  marking: MarkingRecord;
  telemetry: Record<string, QuestionTelemetry>;
  flags: { late?: boolean };
  score: number | null;
  maxScore: number | null;
  submittedAt: string;
}

interface MarkData {
  quiz: { id: string; slug: string; title: string; phase: string; gradingMode: string };
  rubric: RubricConfig;
  questions: MarkQuestion[];
  attempts: MarkAttempt[];
  progress: { attempts: number; unmarked: number; complete: number };
}

interface Draft {
  params: Record<string, number>;
  strengths: string;
  improvements: string;
  corrections: string;
  oneThing: string;
  comment: string;
  /** The values came from the AI pass and the teacher has not touched them. */
  fromAi: boolean;
  dirty: boolean;
}

const key = (attemptId: string, qid: string) => `${attemptId}|${qid}`;

const blankDraft = (): Draft => ({
  params: {},
  strengths: "",
  improvements: "",
  corrections: "",
  oneThing: "",
  comment: "",
  fromAi: false,
  dirty: false,
});

/** Seed a draft from whatever has been stored for this answer already. */
function seedDraft(marking: MarkingRecord, qid: string): Draft {
  const teacher = marking?.[qid]?.teacher;
  const ai = marking?.[qid]?.ai;
  const source = teacher ?? ai;
  if (!source) return blankDraft();
  return {
    params: { ...source.params },
    strengths: source.strengths ?? "",
    improvements: source.improvements ?? "",
    corrections: source.corrections ?? "",
    oneThing: source.oneThing ?? "",
    comment: source.comment ?? "",
    fromAi: !teacher && !!ai,
    dirty: false,
  };
}

/** A tiny sparkline of how the answer grew, drawn from the sampled curve. */
function GrowthSpark({ telemetry }: { telemetry?: QuestionTelemetry }) {
  const points = telemetry?.growth ?? [];
  if (points.length < 3) return null;
  const maxChars = Math.max(...points.map((p) => p[1]), 1);
  const maxTime = Math.max(...points.map((p) => p[0]), 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(p[0] / maxTime) * 60},${18 - (p[1] / maxChars) * 16}`)
    .join(" ");
  const jump = largestJump(telemetry);
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`Largest single jump: ${jump.chars} characters, ${Math.round(jump.share * 100)}% of the finished answer`}
    >
      <svg width="60" height="20" viewBox="0 0 60 20" aria-hidden className="shrink-0">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-400" />
      </svg>
      <span className="text-[11px] text-slate-500">growth</span>
    </span>
  );
}

/*
 * Pencil and pen.
 *
 * Drawn rather than set as emoji: an emoji renders differently on every
 * platform, ignores the colour of the text it sits in, and reads as decoration
 * on a screen where a teacher is deciding a mark. These inherit currentColor,
 * so the chip stays one object.
 */
const PencilMark = () => (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.5 2.5l2 2L5 13l-3 1 1-3z" />
    <path d="M10 4l2 2" />
  </svg>
);

const PenMark = () => (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden fill="currentColor">
    <path d="M12.9 1.9a1.4 1.4 0 0 1 2 2L6.4 12.4 2.6 13.7l1.3-3.8z" />
  </svg>
);

export default function MarkPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<MarkData | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"question" | "student">("question");
  const [qIndex, setQIndex] = useState(0);
  const [sIndex, setSIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [showAi, setShowAi] = useState(false);
  const [pkgScope, setPkgScope] = useState<PackScope>("question");
  const [partIndex, setPartIndex] = useState(0);
  const [reply, setReply] = useState("");
  const [pasteReport, setPasteReport] = useState<string[]>([]);
  const [unmarkedCodes, setUnmarkedCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/quizzes/${id}/mark`);
    if (res.status === 401) {
      router.push("/teacher");
      return;
    }
    if (!res.ok) {
      setError("Could not load the marking screen.");
      return;
    }
    const body: MarkData = await res.json();
    setData(body);
    // Seed every draft that has no unsaved edit in it, so a save elsewhere on
    // the page never wipes what is being typed here.
    setDrafts((existing) => {
      const next = { ...existing };
      for (const a of body.attempts) {
        for (const qn of body.questions) {
          const k = key(a.id, qn.id);
          if (!next[k]?.dirty) next[k] = seedDraft(a.marking, qn.id);
        }
      }
      return next;
    });
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  const question = data?.questions[qIndex];
  const attempt = data?.attempts[sIndex];

  /**
   * What the package on screen covers. One question across the class, one
   * student across the questions, or the whole quiz — the same builder either
   * way, so a remainder is a filter of the same cells rather than a rebuild.
   */
  const packInput: PackInput | null = useMemo(() => {
    if (!data) return null;
    const asQuestion = (qn: MarkQuestion) =>
      ({
        id: qn.id,
        type: qn.type,
        text: qn.text,
        passage: qn.passage,
        passageTitle: qn.passageTitle,
        options: [],
        points: qn.points,
        feedbackCorrect: qn.modelAnswer,
        wordLimit: qn.wordLimit,
      }) as Question;

    const questions = pkgScope === "question" ? (question ? [question] : []) : data.questions;
    const attempts = pkgScope === "student" ? (attempt ? [attempt] : []) : data.attempts;
    if (!questions.length || !attempts.length) return null;

    const answers = new Map(data.attempts.map((a) => [a.id, a.answers]));
    return {
      scope: pkgScope,
      rubric: data.rubric,
      questions: questions.map((qn) => ({ question: asQuestion(qn), weights: qn.weights })),
      attempts: attempts.map((a) => ({ attemptId: a.id })),
      answer: (attemptId: string, qid: string) => answers.get(attemptId)?.[qid] ?? "",
    };
  }, [data, question, attempt, pkgScope]);

  const pack = useMemo(() => (packInput ? buildPackage(packInput) : null), [packInput]);

  useEffect(() => {
    setPartIndex(0);
    setReply("");
    setPasteReport([]);
    setUnmarkedCodes([]);
  }, [qIndex, sIndex, pkgScope]);

  function patch(attemptId: string, qid: string, change: Partial<Draft>) {
    const k = key(attemptId, qid);
    setDrafts((d) => ({ ...d, [k]: { ...(d[k] ?? blankDraft()), ...change, dirty: true, fromAi: false } }));
  }

  async function post(payload: Record<string, unknown>, label: string) {
    setBusy(label);
    setError("");
    const res = await fetch(`/api/quizzes/${id}/mark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy("");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "That did not work.");
      return null;
    }
    return body;
  }

  async function saveOne(attemptId: string, qid: string) {
    const draft = drafts[key(attemptId, qid)] ?? blankDraft();
    const body = await post(
      {
        action: "save",
        reviewer: "teacher",
        attemptId,
        qid,
        params: draft.params,
        strengths: draft.strengths,
        improvements: draft.improvements,
        corrections: draft.corrections,
        oneThing: draft.oneThing,
        comment: draft.comment,
      },
      `save-${attemptId}-${qid}`
    );
    if (!body) return;
    setDrafts((d) => ({ ...d, [key(attemptId, qid)]: { ...(d[key(attemptId, qid)] ?? blankDraft()), dirty: false, fromAi: false } }));
    setNote("Saved.");
    setTimeout(() => setNote(""), 1500);
    await load();
  }

  /** Rub out a pencil mark: the AI's suggestion goes, the answer returns to unmarked. */
  async function erase(attemptId: string, qid: string) {
    const body = await post({ action: "clear", reviewer: "ai", attemptId, qid }, `erase-${attemptId}-${qid}`);
    if (!body) return;
    setDrafts((d) => ({ ...d, [key(attemptId, qid)]: blankDraft() }));
    setNote("Erased.");
    setTimeout(() => setNote(""), 1500);
    await load();
  }

  /** Save every answer to the question on screen that has been edited. */
  async function saveAllOnQuestion() {
    if (!data || !question) return;
    const marks = data.attempts
      .map((a) => ({ a, draft: drafts[key(a.id, question.id)] }))
      .filter(({ draft }) => draft?.dirty)
      .map(({ a, draft }) => ({
        attemptId: a.id,
        qid: question.id,
        params: draft!.params,
        strengths: draft!.strengths,
        improvements: draft!.improvements,
        corrections: draft!.corrections,
        oneThing: draft!.oneThing,
        comment: draft!.comment,
      }));
    if (!marks.length) {
      setNote("Nothing has changed since the last save.");
      setTimeout(() => setNote(""), 2000);
      return;
    }
    const body = await post({ action: "saveMany", reviewer: "teacher", marks }, "save-all");
    if (!body) return;
    setDrafts((d) => {
      const next = { ...d };
      for (const m of marks) next[key(m.attemptId, m.qid)] = { ...next[key(m.attemptId, m.qid)], dirty: false, fromAi: false };
      return next;
    });
    setNote(`Saved ${marks.length} response${marks.length === 1 ? "" : "s"}.`);
    setTimeout(() => setNote(""), 2500);
    await load();
  }

  async function copyPart(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  }

  /** Read a pasted reply, report coverage, and store what it holds as AI marks. */
  async function applyReply() {
    if (!pack || !data) return;
    const expected = pack.parts[partIndex]?.codes ?? [];
    // Weights come from the package rather than from one question, because a
    // student or batch package spans questions that may cap a parameter
    // differently.
    const result = parseAiReply(reply, expected, pack.codeWeights);
    if (result.error) {
      setPasteReport([result.error]);
      setUnmarkedCodes(expected);
      return;
    }
    // The code says which answer, and in a multi-question package that means
    // which student AND which question. A code the package never issued has
    // already been rejected upstream, so nothing here has to guess.
    const marks = result.marks.flatMap((m) => {
      const ref = pack.codeMap[m.code];
      if (!ref) return [];
      return [{
        attemptId: ref.attemptId,
        qid: ref.qid,
        params: m.params,
        strengths: m.strengths ?? "",
        improvements: m.improvements ?? "",
        corrections: m.corrections ?? "",
        oneThing: m.oneThing ?? "",
      }];
    });

    const report: string[] = [];
    if (marks.length) {
      const body = await post({ action: "saveMany", reviewer: "ai", marks }, "paste");
      if (!body) return;
      report.push(`${marks.length} of ${expected.length} responses marked.`);
    } else {
      report.push(`Nothing usable in that reply — none of the ${expected.length} responses were marked.`);
    }
    const clamped = result.marks.filter((m) => m.clamped.length);
    if (clamped.length) {
      report.push(
        clamped.length === 1
          ? "1 response was scored above a parameter's maximum and has been capped at it."
          : `${clamped.length} responses were scored above a parameter's maximum and have been capped at it.`
      );
    }
    for (const r of result.rejected) report.push(`${r.code}: ${r.reason}.`);
    if (result.unmarked.length) {
      report.push(
        `Unmarked: ${result.unmarked.join(", ")}. Use the remainder package below to finish ${
          result.unmarked.length === 1 ? "it" : "them"
        }.`
      );
    }
    setPasteReport(report);
    setUnmarkedCodes(result.unmarked);
    setReply("");
    await load();
  }

  const remainder = useMemo(
    () => (packInput && unmarkedCodes.length ? remainderPackage(packInput, unmarkedCodes) : null),
    [packInput, unmarkedCodes]
  );

  if (error && !data) return <main className="mx-auto max-w-4xl px-6 py-16 text-red-600">{error}</main>;
  if (!data) return <main className="mx-auto max-w-4xl px-6 py-16 text-slate-500">Loading…</main>;

  if (!data.questions.length) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Link href={`/teacher/quiz/${id}`} className="text-sm text-slate-500 hover:text-slate-800">← {data.quiz.title}</Link>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">Nothing to mark</h1>
        <p className="mt-2 text-slate-600">
          This quiz has no scored written answers. Every question in it is marked automatically.
        </p>
      </main>
    );
  }

  // ---------- one response's marking controls ----------
  const responseCard = (a: MarkAttempt, qn: MarkQuestion, heading: string) => {
    const k = key(a.id, qn.id);
    const draft = drafts[k] ?? blankDraft();
    const answer = a.answers[qn.id] ?? "";
    const blank = !answer.trim();
    const words = countWords(answer);
    const percent = scorePercent(draft.params, qn.weights);
    const awarded = awardedFor(percent, qn.points);
    const stored = a.marking?.[qn.id];
    const badges = telemetryBadges(a.telemetry?.[qn.id], answer.length);
    /*
     * Pencil or ink.
     *
     * An AI suggestion that nobody has touched is written in pencil: it is on
     * the page, it can be read, and it is not yet anybody's judgement. Saving
     * it — unedited or rewritten, it makes no difference — inks it in. The
     * distinction was previously a sentence in a violet box, which is a thing
     * to read rather than a thing to see.
     */
    const inPencil = !!stored?.ai && !stored?.teacher;
    const inked = !!stored?.teacher;

    return (
      <div
        key={k}
        className={`rounded-xl border bg-white p-4 ${
          inPencil ? "border-dashed border-violet-300" : "border-slate-200"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-slate-900">{heading}</p>
            {inPencil && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-violet-400 px-2 py-0.5 text-[11px] font-medium italic text-violet-700"
                title="A chatbot suggested this. It is not your mark until you ink it in, and students never see it."
              >
                <PencilMark />
                in pencil — a chatbot&apos;s
              </span>
            )}
            {inked && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white"
                title="Your mark, saved."
              >
                <PenMark />
                inked — yours
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {a.flags?.late && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">late</span>}
            {!!qn.wordLimit && (
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  words > qn.wordLimit ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
                }`}
              >
                {words} / {qn.wordLimit} words
              </span>
            )}
            {!qn.wordLimit && !blank && <span className="text-slate-500">{words} words</span>}
            {badges.map((b) => (
              <span
                key={b.label}
                className={`rounded-full px-2 py-0.5 font-medium ${
                  b.tone === "notable" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
                }`}
              >
                {b.label}
              </span>
            ))}
            <GrowthSpark telemetry={a.telemetry?.[qn.id]} />
          </div>
        </div>

        {blank ? (
          <div className="mt-3 grid place-items-center rounded-lg border border-dashed border-slate-300 py-5">
            <span className="-rotate-6 rounded border-2 border-slate-400 px-3 py-1 text-xs font-bold uppercase tracking-widest text-slate-400">
              Left blank
            </span>
            <span className="mt-2 text-xs text-slate-500">0 marks. You can still leave a comment.</span>
          </div>
        ) : (
          // An overrun rules its own margin, the way a marker would draw one.
          <p
            className={`mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-800 ${
              qn.wordLimit && words > qn.wordLimit ? "border-l-4 border-red-400 pl-3" : ""
            }`}
          >
            {answer}
          </p>
        )}


        <div className="mt-4 space-y-2">
          {data.rubric.bands.map((band) => (
            <div key={band.id}>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{band.label}</p>
              {band.params.map((p) => {
                const weight = qn.weights[p.id] ?? p.weight;
                const value = draft.params[p.id];
                return (
                  <div key={p.id} className="mt-1.5 flex items-center gap-3">
                    <label className="flex-1 text-sm text-slate-700" title={p.hint}>
                      {p.label}
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={weight}
                      step={weight > 20 ? 1 : 0.5}
                      value={Number.isFinite(value) ? value : 0}
                      onChange={(e) => patch(a.id, qn.id, { params: { ...draft.params, [p.id]: Number(e.target.value) } })}
                      className="w-32 accent-blue-700"
                    />
                    <input
                      type="number"
                      min={0}
                      max={weight}
                      step={0.5}
                      value={Number.isFinite(value) ? value : ""}
                      placeholder="—"
                      onChange={(e) =>
                        patch(a.id, qn.id, {
                          params: { ...draft.params, [p.id]: Math.min(weight, Math.max(0, Number(e.target.value) || 0)) },
                        })
                      }
                      className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
                    />
                    <span className="w-10 text-right text-xs text-slate-400">/ {weight}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-sm font-semibold text-slate-700">
            {awarded} / {qn.points} marks ({percent}%)
          </span>
          <div className="flex items-center gap-2">
            {draft.dirty && <span className="text-xs font-medium text-amber-700">unsaved</span>}
            {inPencil && (
              <button
                onClick={() => erase(a.id, qn.id)}
                disabled={!!busy}
                className="rounded-lg border border-violet-300 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-40"
                title="Rub out the chatbot's suggestion and mark this one yourself."
              >
                {busy === `erase-${a.id}-${qn.id}` ? "Erasing…" : "Erase"}
              </button>
            )}
            <button
              onClick={() => saveOne(a.id, qn.id)}
              disabled={!!busy}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {busy === `save-${a.id}-${qn.id}` ? "Saving…" : inPencil ? "Ink it in" : "Save"}
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(
            [
              ["strengths", "What worked"],
              ["improvements", "What would raise the mark"],
              ["corrections", "Factual corrections"],
              ["oneThing", "One thing to fix next time"],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="text-xs font-semibold text-slate-600">
              {label}
              <textarea
                value={draft[field]}
                onChange={(e) => patch(a.id, qn.id, { [field]: e.target.value })}
                rows={field === "oneThing" ? 2 : 3}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900"
              />
            </label>
          ))}
        </div>
      </div>
    );
  };

  // ---------- the marking package, at whichever scope the teacher wants ----------

  /*
   * One package, two choices — never three.
   *
   * The scope selector used to offer question, student and quiz from wherever
   * you stood, which let "This student" be selected in the question view, where
   * no student is on screen to name. It then silently targeted whoever the
   * hidden per-student index happened to point at. A scope whose target you can
   * neither see nor change is not a choice, so the third option is simply not
   * offered: each view shows its own unit, and the whole quiz.
   *
   * The counts are computed straight from the answers rather than by building a
   * package per choice, so a label can say what it will cost before you pick it.
   */
  const typed = (attemptId: string, qid: string) => !!data.attempts.find((a) => a.id === attemptId)?.answers[qid]?.trim();
  const countFor = (scope: PackScope): number => {
    if (scope === "question")
      return question ? data.attempts.filter((a) => typed(a.id, question.id)).length : 0;
    if (scope === "student")
      return attempt ? data.questions.filter((qn) => typed(attempt.id, qn.id)).length : 0;
    return data.attempts.reduce((n, a) => n + data.questions.filter((qn) => typed(a.id, qn.id)).length, 0);
  };

  /*
   * Both options name both axes, always.
   *
   * "Aarti Sen" beside "Whole quiz" reads as a choice between one student and
   * all of that student's questions — which is not what the second one means.
   * The ambiguity is inherent to naming only the axis that varies, so neither
   * label does that any more: each says how many students and how many
   * questions it covers, and the counts sit underneath.
   */
  const nStudents = data.attempts.length;
  const nQuestions = data.questions.length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  const unitChoice: { id: PackScope; label: string; covers: string; note: string } =
    view === "question"
      ? {
          id: "question",
          label: question ? `Q${qIndex + 1} only` : "This question",
          covers: `1 question × ${plural(nStudents, "student")}`,
          note: "Every answer to the question on screen. Marks most consistently — one question held in mind, the class graded against itself.",
        }
      : {
          id: "student",
          label: attempt ? `${attempt.name} only` : "This student",
          covers: `1 student × ${plural(nQuestions, "question")}`,
          note: "One student's answers to every written question. What you want when you are working through a pile person by person.",
        };
  const scopeChoices: { id: PackScope; label: string; covers: string; note: string; count: number }[] = [
    { ...unitChoice, count: countFor(unitChoice.id) },
    {
      id: "batch",
      label: "Everything",
      covers: `${plural(nStudents, "student")} × ${plural(nQuestions, "question")}`,
      note: "Every answer by every student, in the fewest round trips. Grouped question by question, but the model's attention is spread thinnest here — read what comes back.",
      count: countFor("batch"),
    },
  ];
  const activeScope = scopeChoices.find((c) => c.id === pkgScope) ?? scopeChoices[0];
  const covered = pack ? Object.keys(pack.codeMap).length : 0;
  // Codes only grow a question half when the package actually spans questions.
  const codesCarryQuestion = pkgScope !== "question" && data.questions.length > 1;

  const aiPanel = (
    <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/50 p-4">
      <button onClick={() => setShowAi((v) => !v)} className="text-sm font-bold text-violet-900">
        {showAi ? "▾" : "▸"} Mark with a chatbot (optional)
      </button>
      {showAi && (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-xs text-violet-900">
            Copy a package into whichever chatbot you use, then paste its reply back here. No key, no account, nothing
            sent from Quizzine, and no names in the package — answers travel under codes only Quizzine can resolve.
          </p>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-violet-900">Package</p>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {scopeChoices.map((choice) => {
                const on = choice.id === pkgScope;
                return (
                  <button
                    key={choice.id}
                    onClick={() => setPkgScope(choice.id)}
                    disabled={!choice.count}
                    aria-pressed={on}
                    className={`rounded-lg px-3 py-2 text-left disabled:opacity-40 ${
                      on ? "bg-violet-700 text-white" : "border border-violet-300 bg-white text-violet-900 hover:bg-violet-100"
                    }`}
                  >
                    <span className="block text-xs font-bold">{choice.label}</span>
                    <span className={`block text-[11px] ${on ? "text-violet-200" : "text-slate-500"}`}>
                      {choice.covers}
                    </span>
                    <span className={`mt-0.5 block text-[11px] font-semibold ${on ? "text-white" : "text-violet-800"}`}>
                      {choice.count} answer{choice.count === 1 ? "" : "s"} to send
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-slate-600">{activeScope.note}</p>
          </div>

          {!pack || !covered ? (
            <p className="rounded-lg bg-white p-3 text-xs text-slate-600">
              Nothing to send — there are no typed answers in this package yet.
            </p>
          ) : (
            <>
              <p className="rounded-lg bg-white p-2 text-xs text-slate-600">
                {pack.totalWords.toLocaleString()} words
                {pack.parts.length > 1 ? (
                  <>
                    {" "}
                    across {pack.parts.length} parts. Use a <strong>fresh chat for each part</strong> — a long
                    conversation marks the later answers worse than the earlier ones, and your review pass is the
                    correction for the drift between them.
                  </>
                ) : (
                  ", small enough to send in one go."
                )}
                {codesCarryQuestion && (
                  <>
                    {" "}
                    Codes are <strong>R3Q2</strong> — response 3, question 2.
                  </>
                )}
              </p>
              {pack.blank > 0 && (
                <p className="text-xs text-slate-500">
                  {pack.blank} blank answer{pack.blank === 1 ? " is" : "s are"} left out — they are marked “no response”
                  at 0 and never hold up release.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {pack.parts.map((part, i) => (
                  <button
                    key={part.index}
                    onClick={() => {
                      setPartIndex(i);
                      copyPart(part.text, `part-${part.index}`);
                    }}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                      i === partIndex ? "bg-violet-700 text-white" : "border border-violet-300 bg-white text-violet-800"
                    }`}
                  >
                    {copied === `part-${part.index}`
                      ? "Copied ✓"
                      : pack.parts.length > 1
                        ? `Copy part ${part.index} of ${part.total} (${part.codes.length} answers)`
                        : `Copy the package (${part.codes.length} answers)`}
                  </button>
                ))}
              </div>

              <label className="block text-xs font-semibold text-violet-900">
                Paste the reply for part {partIndex + 1}
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={5}
                  placeholder="Paste the whole reply — extra prose around the JSON is fine."
                  className="mt-1 w-full rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                />
              </label>
              <button
                onClick={applyReply}
                disabled={!!busy || !reply.trim()}
                className="rounded-lg bg-violet-700 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-40"
              >
                {busy === "paste" ? "Reading…" : "Read the reply"}
              </button>

              {pasteReport.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-white p-3 text-xs text-slate-700">
                  {pasteReport.map((line, i) => (
                    <li key={i}>• {line}</li>
                  ))}
                </ul>
              )}
              {remainder?.parts.map((part) => (
                <button
                  key={part.index}
                  onClick={() => copyPart(part.text, `rem-${part.index}`)}
                  className="rounded-lg border border-violet-300 bg-white px-3 py-2 text-xs font-semibold text-violet-800"
                >
                  {copied === `rem-${part.index}`
                    ? "Copied ✓"
                    : `Copy the remainder package${
                        remainder.parts.length > 1 ? ` (part ${part.index} of ${part.total})` : ""
                      } — ${part.codes.length} unmarked`}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );

  /*
   * What this student has on the written half so far. Unmarked answers count as
   * nothing, which is what release would do with them, so the count of what is
   * still unmarked is shown beside the total rather than left to be inferred.
   */
  const writtenTotal = (() => {
    if (!attempt) return null;
    let awarded = 0;
    let points = 0;
    let unmarked = 0;
    for (const qn of data.questions) {
      const draft = drafts[key(attempt.id, qn.id)] ?? blankDraft();
      const scored = Object.values(draft.params).some((v) => Number.isFinite(v));
      if (!scored) unmarked += 1;
      awarded += awardedFor(scorePercent(draft.params, qn.weights), qn.points);
      points += qn.points;
    }
    return { awarded: Math.round(awarded * 100) / 100, points, unmarked };
  })();

  const phase = data.quiz.phase;
  const released = phase === "closed";

  /** The three notches, in the order a quiz actually travels through them. */
  const PHASES = [
    {
      id: "responding",
      label: "Taking responses",
      tone: "bg-blue-600 text-white",
      note: "The link is open and students can still submit. Marking what is already in is fine — late arrivals simply appear.",
    },
    {
      id: "reviewing",
      label: "Marking",
      tone: "bg-amber-500 text-white",
      note: "Closed to new responses, open to you. Students see “response recorded” and nothing else until you slide the bolt across.",
    },
    {
      id: "closed",
      label: "Results out",
      tone: "bg-green-700 text-white",
      note: "Marks and feedback are with the students.",
    },
  ] as const;

  /** Slide the bolt. Only the notch that shows students their marks asks first. */
  async function moveTo(next: (typeof PHASES)[number]["id"]) {
    if (next === phase) return;
    if (next === "closed" && !confirm("Release the marks and feedback to students? You can slide this back afterwards.")) return;
    const action =
      next === "responding" ? "reopenResponses" : next === "reviewing" ? (released ? "unrelease" : "startMarking") : "release";
    await post({ action }, `phase-${next}`);
    await load();
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <Link href={`/teacher/quiz/${id}`} className="text-sm text-slate-500 hover:text-slate-800">← {data.quiz.title}</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Marking</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {data.progress.attempts} response{data.progress.attempts === 1 ? "" : "s"} ·{" "}
            {data.progress.unmarked === 0
              ? "everything is marked"
              : `${data.progress.unmarked} written answer${data.progress.unmarked === 1 ? "" : "s"} still unmarked`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/*
            * Two segments rather than one button. A single toggle labelled with
            * its destination ("Per student") reads equally as a label for where
            * you already are, and the page had no other way of saying which
            * view was live — the question tabs and the student tabs look alike.
            */}
          <div className="flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label="Marking view">
            {(
              [
                ["question", "By question"],
                ["student", "By student"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  setView(id);
                  // The package follows the view: a teacher who has just moved
                  // to one student almost never wants a question package. Whole
                  // quiz is a deliberate choice and survives the switch.
                  if (pkgScope !== "batch") setPkgScope(id);
                }}
                aria-pressed={view === id}
                className={`rounded-md px-3.5 py-1.5 text-sm font-semibold ${
                  view === id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/*
        * The bolt.
        *
        * A quiz is always in exactly one of three states, and until now the
        * screen showed only the one transition out of the state you were in —
        * a green "Release results" button, or a grey "Withdraw" one. Which of
        * the three you were actually in had to be inferred from which button
        * happened to be on screen, and two of the transitions the API supports
        * had no control at all.
        *
        * A door bolt says all of it at once: three notches, the bolt sitting in
        * one of them, and sliding it is the action. Releasing is still a
        * deliberate click and still asks first, because it is the notch that
        * puts marks in front of students.
        */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Quiz is</span>
          <div className="flex flex-1 min-w-[18rem] rounded-lg bg-slate-100 p-1" role="group" aria-label="Quiz phase">
            {PHASES.map((p) => {
              const here = phase === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => moveTo(p.id)}
                  disabled={!!busy || here}
                  aria-current={here ? "step" : undefined}
                  title={p.note}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    here
                      ? `${p.tone} shadow-sm`
                      : "text-slate-500 hover:bg-white hover:text-slate-800 disabled:opacity-50"
                  }`}
                >
                  {busy === `phase-${p.id}` ? "…" : p.label}
                </button>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {released
            ? `Students can see their marks at /q/${data.quiz.slug}/result. Anything you save from here reaches them at once.`
            : PHASES.find((p) => p.id === phase)?.note}
        </p>
      </div>
      {note && <p className="mt-2 text-sm font-medium text-green-700">{note}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {view === "question" ? (
        <>
          {/*
            * Index tabs on a register: the live tab sits on the same baseline
            * as the panel below it and the others sit behind. Two strips on
            * this page look alike (questions here, names in the other view),
            * so the tab that is open needs to read as attached to what it
            * opened, not merely as a darker pill.
            */}
          <div className="mt-6 flex flex-wrap items-end gap-1 border-b border-slate-300">
            {data.questions.map((qn, i) => (
              <button
                key={qn.id}
                onClick={() => setQIndex(i)}
                aria-current={i === qIndex ? "page" : undefined}
                title={qn.text}
                className={`-mb-px rounded-t-lg border border-b-0 px-4 py-2 text-xs font-semibold ${
                  i === qIndex
                    ? "border-slate-300 bg-white text-slate-900"
                    : "border-transparent bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                Q{i + 1}
              </button>
            ))}
          </div>

          {question && (
            <>
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                <Material
                  text={question.passage}
                  title={question.passageTitle}
                  colours={{ border: "#e2e8f0", muted: "#64748b", accentSoft: "#f8fafc" }}
                />
                <p className="font-medium text-slate-900">{question.text}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {question.points} mark{question.points === 1 ? "" : "s"}
                  {question.wordLimit ? ` · ${question.wordLimit}-word limit` : ""}
                </p>
                {question.modelAnswer && (
                  <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <summary className="cursor-pointer font-semibold text-slate-700">Model answer</summary>
                    <p className="mt-2 whitespace-pre-wrap text-slate-700">{question.modelAnswer}</p>
                  </details>
                )}
              </div>

              {aiPanel}

              <div className="mt-4 flex items-center justify-between">
                <h2 className="font-bold text-slate-900">
                  {data.attempts.length} response{data.attempts.length === 1 ? "" : "s"}
                </h2>
                <button
                  onClick={saveAllOnQuestion}
                  disabled={!!busy}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {busy === "save-all" ? "Saving…" : "Save all changes on this question"}
                </button>
              </div>

              <div className="mt-3 space-y-3">
                {data.attempts.map((a, i) =>
                  responseCard(a, question, `${i + 1}. ${a.name} · ${a.roll}`)
                )}
                {!data.attempts.length && (
                  <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                    No responses yet.
                  </p>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-end gap-1 border-b border-slate-300">
            {data.attempts.map((a, i) => {
              // A tick beside a name means every written answer of theirs is
              // marked — the register's own way of showing who is done.
              const done = data.questions.every((qn) => !!a.marking?.[qn.id]?.teacher || !(a.answers[qn.id] ?? "").trim());
              return (
                <button
                  key={a.id}
                  onClick={() => setSIndex(i)}
                  aria-current={i === sIndex ? "page" : undefined}
                  className={`-mb-px flex items-center gap-1.5 rounded-t-lg border border-b-0 px-4 py-2 text-xs font-semibold ${
                    i === sIndex
                      ? "border-slate-300 bg-white text-slate-900"
                      : "border-transparent bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  {a.name}
                  {done && <span className="text-green-600" title="Every answer inked">✓</span>}
                </button>
              );
            })}
          </div>
          {attempt && writtenTotal && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="font-semibold text-slate-900">{attempt.name} · {attempt.roll}</p>
              <p className="text-sm font-semibold text-slate-700">
                Written answers: {scoreLabel(writtenTotal.awarded, writtenTotal.points)}
                {writtenTotal.unmarked > 0 && (
                  <span className="ml-2 text-xs font-medium text-amber-700">
                    {writtenTotal.unmarked} still unmarked
                  </span>
                )}
              </p>
            </div>
          )}
          {aiPanel}
          {attempt && (
            <div className="mt-4 space-y-3">
              {data.questions.map((qn, i) => (
                <div key={qn.id}>
                  <div className="rounded-t-xl border border-b-0 border-slate-200 bg-slate-50 px-4 py-2.5">
                    <p className="text-sm font-medium text-slate-900">
                      <span className="font-semibold text-slate-400">Q{i + 1}.</span> {qn.text}
                    </p>
                  </div>
                  {responseCard(attempt, qn, `${attempt.name} · ${attempt.roll}`)}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
