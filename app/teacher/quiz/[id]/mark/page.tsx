/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { awardedFor, scorePercent, type RubricConfig } from "@/lib/rubric";
import { buildPackage, parseAiReply, remainderPackage, type MarkingPackage } from "@/lib/markpack";
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

  /** The package for the question on screen, rebuilt whenever it changes. */
  const pack: MarkingPackage | null = useMemo(() => {
    if (!data || !question) return null;
    const asQuestion = {
      id: question.id,
      type: question.type,
      text: question.text,
      passage: question.passage,
      passageTitle: question.passageTitle,
      options: [],
      points: question.points,
      feedbackCorrect: question.modelAnswer,
      wordLimit: question.wordLimit,
    } as Question;
    return buildPackage(
      asQuestion,
      data.rubric,
      question.weights,
      data.attempts.map((a) => ({ attemptId: a.id, text: a.answers[question.id] ?? "" }))
    );
  }, [data, question]);

  useEffect(() => {
    setPartIndex(0);
    setReply("");
    setPasteReport([]);
    setUnmarkedCodes([]);
  }, [qIndex]);

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
    if (!pack || !question || !data) return;
    const expected = pack.parts[partIndex]?.codes ?? [];
    const result = parseAiReply(reply, expected, question.weights);
    if (result.error) {
      setPasteReport([result.error]);
      setUnmarkedCodes(expected);
      return;
    }
    const marks = result.marks.map((m) => ({
      attemptId: pack.codeMap[m.code],
      qid: question.id,
      params: m.params,
      strengths: m.strengths ?? "",
      improvements: m.improvements ?? "",
      corrections: m.corrections ?? "",
      oneThing: m.oneThing ?? "",
    }));

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

  const remainder = useMemo(() => {
    if (!pack || !question || !data || !unmarkedCodes.length) return null;
    const asQuestion = {
      id: question.id,
      type: question.type,
      text: question.text,
      passage: question.passage,
      passageTitle: question.passageTitle,
      options: [],
      points: question.points,
      feedbackCorrect: question.modelAnswer,
      wordLimit: question.wordLimit,
    } as Question;
    return remainderPackage(
      asQuestion,
      data.rubric,
      question.weights,
      data.attempts.map((a) => ({ attemptId: a.id, text: a.answers[question.id] ?? "" })),
      pack.codeMap,
      unmarkedCodes
    );
  }, [pack, question, data, unmarkedCodes]);

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

    return (
      <div key={k} className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-slate-900">{heading}</p>
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
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm italic text-slate-500">
            No response — 0 marks. You can still leave a comment.
          </p>
        ) : (
          <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-800">{answer}</p>
        )}

        {stored?.ai && !stored.teacher && (
          <p className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-xs font-medium text-violet-800">
            AI suggestion — edit freely. Nothing here is released until you release it.
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
            {percent}% · {awarded} / {qn.points} marks
          </span>
          <div className="flex items-center gap-2">
            {draft.dirty && <span className="text-xs font-medium text-amber-700">unsaved</span>}
            <button
              onClick={() => saveOne(a.id, qn.id)}
              disabled={!!busy}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {busy === `save-${a.id}-${qn.id}` ? "Saving…" : "Save"}
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

  const phase = data.quiz.phase;
  const released = phase === "closed";

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
          <button
            onClick={() => setView(view === "question" ? "student" : "question")}
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
          >
            {view === "question" ? "Per student" : "Question by question"}
          </button>
          {!released ? (
            <button
              onClick={async () => {
                if (!confirm("Release the marks and feedback to students? You can withdraw them again afterwards.")) return;
                await post({ action: "release" }, "release");
                await load();
              }}
              disabled={!!busy}
              className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
            >
              {busy === "release" ? "Releasing…" : "Release results"}
            </button>
          ) : (
            <button
              onClick={async () => {
                await post({ action: "unrelease" }, "unrelease");
                await load();
              }}
              disabled={!!busy}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Withdraw results
            </button>
          )}
        </div>
      </div>

      <p className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500">
        {released
          ? `Marks are released — students can see them at /q/${data.quiz.slug}/result. Any change you save from here reaches them at once.`
          : "Students see “response recorded” until you release. Releasing is always your click, whether you marked every answer yourself, edited AI suggestions, or left them as they came."}
      </p>
      {note && <p className="mt-2 text-sm font-medium text-green-700">{note}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {view === "question" ? (
        <>
          <div className="mt-6 flex flex-wrap gap-2">
            {data.questions.map((qn, i) => (
              <button
                key={qn.id}
                onClick={() => setQIndex(i)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  i === qIndex ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
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

              {/* ---------- the AI pass ---------- */}
              <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/50 p-4">
                <button
                  onClick={() => setShowAi((v) => !v)}
                  className="text-sm font-bold text-violet-900"
                >
                  {showAi ? "▾" : "▸"} Mark this question with a chatbot (optional)
                </button>
                {showAi && pack && (
                  <div className="mt-3 space-y-3 text-sm">
                    <p className="text-xs text-violet-900">
                      Copy the package below into whichever chatbot you use, then paste its reply back here. No key, no
                      account, nothing sent from Quizzine. Names never enter the package — responses travel as R1, R2, …
                      and only Quizzine knows which is whose.
                    </p>
                    {pack.parts.length > 1 && (
                      <p className="rounded-lg bg-white p-2 text-xs text-slate-600">
                        {pack.totalWords.toLocaleString()} words of responses, so this question is split into{" "}
                        {pack.parts.length} parts. Use a <strong>fresh chat for each part</strong> — a long conversation
                        marks the later responses worse than the earlier ones. Parts marked in separate chats can drift a
                        little against each other; your review pass is the correction for that.
                      </p>
                    )}
                    {pack.blank > 0 && (
                      <p className="text-xs text-slate-500">
                        {pack.blank} blank response{pack.blank === 1 ? " is" : "s are"} left out — they are marked “no
                        response” at 0 and never hold up release.
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
                            i === partIndex ? "bg-violet-700 text-white" : "bg-white text-violet-800 border border-violet-300"
                          }`}
                        >
                          {copied === `part-${part.index}`
                            ? "Copied ✓"
                            : pack.parts.length > 1
                              ? `Copy part ${part.index} of ${part.total} (${part.codes.length} responses)`
                              : `Copy the package (${part.codes.length} responses)`}
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
                          : `Copy the remainder package${remainder.parts.length > 1 ? ` (part ${part.index} of ${part.total})` : ""} — ${part.codes.length} unmarked`}
                      </button>
                    ))}
                  </div>
                )}
              </div>

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
          <div className="mt-6 flex flex-wrap gap-2">
            {data.attempts.map((a, i) => (
              <button
                key={a.id}
                onClick={() => setSIndex(i)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  i === sIndex ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {a.name}
              </button>
            ))}
          </div>
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
