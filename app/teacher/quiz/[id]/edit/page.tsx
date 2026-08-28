/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { DEFAULT_MST, mstCapacity, normalizeMstConfig, type MstConfig } from "@/lib/mst";
import { DEFAULT_PEER_CONFIG, normalizePeerConfig, peerMaxScore, type PeerConfig } from "@/lib/peer";
import { TAG_PRESETS, difficultyLabel } from "@/lib/tags";
import { correctKeysOf, isGraded } from "@/lib/questions";
import { THEMES } from "@/lib/themes";
import { DEFAULT_RUBRIC, normalizeRubricConfig, rubricErrors, type RubricConfig } from "@/lib/rubric";
import PeerEditor from "@/components/PeerEditor";
import QuestionEditor, { stripEditing, toEditable, type EditableQuestion } from "@/components/QuestionEditor";
import RubricEditor from "@/components/RubricEditor";
import type { EditPlan } from "@/lib/edit";
import type { GradingMode, MultiScoring, Question, QuizSettings, TimerMode } from "@/lib/types";
import Logo from "@/components/Logo";

/** The four anchors the jump bar offers, in the order they appear on screen. */
const SECTIONS: [string, string][] = [
  ["basics", "Basics"],
  ["settings", "Settings"],
  ["questions", "Questions"],
];

/** ISO instant → the local "YYYY-MM-DDTHH:mm" a datetime-local input wants. */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EditQuizPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [introMedia, setIntroMedia] = useState("");
  const [theme, setTheme] = useState("slate");
  const [preset, setPreset] = useState("");
  const [settings, setSettings] = useState<QuizSettings | null>(null);
  const [mst, setMst] = useState<MstConfig>(DEFAULT_MST);
  const [rubric, setRubric] = useState<RubricConfig>(DEFAULT_RUBRIC);
  const [peer, setPeer] = useState<PeerConfig>(DEFAULT_PEER_CONFIG);
  const [closesAt, setClosesAt] = useState("");
  const [groupMin, setGroupMin] = useState("2");
  const [groupMax, setGroupMax] = useState("5");
  const [rows, setRows] = useState<EditableQuestion[]>([]);
  const [attemptCount, setAttemptCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [done, setDone] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/quizzes/${id}`);
      if (!res.ok) {
        setError("Quiz not found, or it is not yours.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setTitle(data.quiz.title ?? "");
      setDescription(data.quiz.description ?? "");
      setIntroMedia(data.quiz.intro_media ?? "");
      setTheme(data.quiz.theme ?? "slate");
      setPreset(data.quiz.preset ?? "");
      setSettings(data.quiz.settings ?? null);
      setMst(normalizeMstConfig(data.quiz.settings?.mst));
      setRubric(normalizeRubricConfig(data.quiz.settings?.rubric));
      setPeer(normalizePeerConfig(data.quiz.settings?.peer));
      setClosesAt(toLocalInput(data.quiz.settings?.closesAt));
      if (data.quiz.settings?.groupMin) setGroupMin(String(data.quiz.settings.groupMin));
      if (data.quiz.settings?.groupMax) setGroupMax(String(data.quiz.settings.groupMax));
      setRows((data.quiz.questions ?? []).map(toEditable));
      setAttemptCount((data.attempts ?? []).length);
      setLoading(false);
    })();
  }, [id]);

  const rubricBlocked =
    !!settings && (settings.gradingMode === "rubric" || !!settings.peerFromRubric) && rubricErrors(rubric).length > 0;

  const hasMulti = useMemo(() => rows.some((r) => r.type === "multi" && isGraded(r)), [rows]);
  const writtenCount = useMemo(() => rows.filter((r) => r.type === "short" || r.type === "essay").length, [rows]);

  async function save(confirm: boolean) {
    if (!settings) return;
    setSaving(true);
    setError("");
    setDone("");
    try {
      const groupMode = !!settings.groupMode;
      const payload = {
        title,
        description,
        introMedia,
        theme,
        preset: preset || null,
        confirm,
        settings: {
          ...settings,
          closesAt: closesAt ? new Date(closesAt).toISOString() : "",
          groupMode,
          groupMin: groupMode ? Number(groupMin) : undefined,
          groupMax: groupMode ? Number(groupMax) : undefined,
          mst: settings.mstMode ? mst : undefined,
          peer: settings.gradingMode === "peer" ? peer : undefined,
          rubric: settings.gradingMode === "rubric" || settings.peerFromRubric ? rubric : undefined,
        },
        questions: stripEditing(rows).map((r) => ({
          id: r.id,
          text: r.text,
          type: r.type,
          passage: r.passage,
          passageTitle: r.passageTitle,
          media: r.media,
          points: r.points,
          graded: isGraded(r),
          correct: r.type === "multi" ? correctKeysOf(r).join(",") : r.correct,
          options: r.options,
          feedbackCorrect: r.feedbackCorrect,
          feedbackIncorrect: r.feedbackIncorrect,
          tags: r.tags,
          difficulty: r.difficulty,
          // Both survive the round trip only because they are sent back: the
          // validator rebuilds each question from what arrives here.
          wordLimit: r.wordLimit,
          rubricWeights: r.rubricWeights,
        })),
      };
      const res = await fetch(`/api/quizzes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      if (data.preview) {
        setPlan(data.plan);
        setAttemptCount(data.attemptCount ?? attemptCount);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setPlan(null);
      setDone(
        data.regraded
          ? `Saved, and ${data.regraded} submitted attempt${data.regraded === 1 ? " was" : "s were"} re-marked.`
          : "Saved."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="mx-auto max-w-3xl px-6 py-24 text-center text-slate-400">Loading…</main>;
  if (!settings) {
    return (
      <main className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-2xl font-bold text-slate-900">{error || "Quiz not found"}</h1>
        <Link href="/teacher" className="mt-3 inline-block text-sm font-semibold text-blue-700">
          Back to your quizzes
        </Link>
      </main>
    );
  }

  // Merged into whatever the last change left behind rather than into the
  // settings this render captured, so two changes in quick succession cannot
  // quietly undo one another.
  const set = (change: Partial<QuizSettings>) => {
    setSettings((prev) => ({ ...(prev as QuizSettings), ...change }));
    setPlan(null);
  };

  /**
   * Switch the timer, giving the new mode a length if it has none. The number
   * boxes below show a sensible default whether or not one was ever stored, and
   * a teacher who picks "whole-quiz limit" and saves without touching them means
   * that default — not "no limit at all".
   */
  const setTimer = (mode: TimerMode) =>
    set({
      timerMode: mode,
      maxMinutes: mode === "quiz" ? (settings.maxMinutes ?? 15) : settings.maxMinutes,
      perQuestionSeconds: mode === "question" ? (settings.perQuestionSeconds ?? 45) : settings.perQuestionSeconds,
    });

  const gradingMode: GradingMode = settings.gradingMode ?? "graded";
  // The palette and an adaptive paper both let a student roam, which is exactly
  // what the per-question countdown exists to forbid — so it is derived rather
  // than stored, and turning either off gives the teacher their timer back.
  const effectiveTimerMode: TimerMode =
    (settings.examMode || settings.mstMode) && settings.timerMode === "question" ? "none" : settings.timerMode;

  const saveBar = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => save(false)}
        disabled={saving || rubricBlocked}
        className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
      <button
        onClick={() => router.push(`/teacher/quiz/${id}`)}
        className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
      >
        Cancel
      </button>
      <span className="text-xs font-semibold text-slate-400">Jump to</span>
      {SECTIONS.map(([anchor, label]) => (
        <button
          key={anchor}
          onClick={() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          {label}
        </button>
      ))}
      {rubricBlocked && <span className="text-xs text-amber-700">The rubric weights do not add up to 100% yet.</span>}
    </div>
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Logo />
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Edit quiz</h1>
        </div>
        <Link href={`/teacher/quiz/${id}`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
          Back to results
        </Link>
      </div>

      {/* Repeated top and bottom so a long paper never has to be scrolled to save. */}
      <div className="sticky top-0 z-20 -mx-4 mt-4 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        {saveBar}
      </div>

      {attemptCount > 0 && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {attemptCount} student{attemptCount === 1 ? " has" : "s have"} already submitted. Wording, feedback, tags
          and settings can be changed freely. Changing an answer key re-marks the attempts already in; adding or
          removing questions leaves students on different versions of the paper. You will be shown exactly what an
          edit does before it is applied.
        </p>
      )}

      {done && <p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">{done}</p>}
      {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {/* ---------- confirmation ---------- */}
      {plan && (
        <div className="mt-4 rounded-2xl border-2 border-amber-300 bg-white p-5">
          <h2 className="font-bold text-slate-900">Before this is saved</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {plan.warnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
          {plan.regrade.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Marked differently</p>
              <ul className="mt-1 space-y-1 text-sm text-slate-600">
                {plan.regrade.map((r) => (
                  <li key={r.qid}>
                    <span className="font-medium text-slate-800">{r.label}</span> — {r.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.removed.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Removed</p>
              <ul className="mt-1 space-y-1 text-sm text-slate-600">
                {plan.removed.map((r) => (
                  <li key={r.qid}>{r.label}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button onClick={() => setPlan(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
              Go back
            </button>
            <button
              onClick={() => save(true)}
              disabled={saving || rubricBlocked}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save and re-mark"}
            </button>
          </div>
        </div>
      )}

      {/* ---------- basics ---------- */}
      <section id="basics" className="mt-4 scroll-mt-24 space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold text-slate-900">Basics</h2>
        <label className="block text-sm font-semibold text-slate-700">
          Title
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setPlan(null);
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal text-slate-900"
          />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          Description
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setPlan(null);
            }}
            rows={2}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal text-slate-900"
          />
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          Intro media — an image or YouTube video students see before starting
          <input
            value={introMedia}
            onChange={(e) => setIntroMedia(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal text-slate-900"
          />
        </label>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="text-slate-700">
            Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value)} className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5">
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-slate-700">
            Tag vocabulary
            <select value={preset} onChange={(e) => setPreset(e.target.value)} className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5">
              <option value="">No fixed list</option>
              {TAG_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* ---------- settings ---------- */}
      <section id="settings" className="mt-4 scroll-mt-24 space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold text-slate-900">Settings</h2>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">Marking</span>
          {(
            [
              ["graded", "Automatic"],
              ["rubric", "Rubric"],
              ["peer", "Peer review"],
              ["survey", "Not scored"],
            ] as [GradingMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => set({ gradingMode: mode })}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                gradingMode === mode ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {writtenCount > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["pasteGuard", "Block pasting into written answers"],
                ["hardWordLimit", "Stop typing at the word limit"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={!!settings[key]}
                  onChange={(e) => set({ [key]: e.target.checked } as Partial<QuizSettings>)}
                  className="h-4 w-4"
                />
                {label}
              </label>
            ))}
          </div>
        )}

        {(gradingMode === "rubric" || settings.peerFromRubric) && <RubricEditor value={rubric} onChange={setRubric} />}

        {gradingMode === "peer" && (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <p className="text-sm font-semibold text-slate-900">Peer review rubric</p>
            <label className="flex items-start gap-2.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={!!settings.peerFromRubric}
                onChange={(e) => set({ peerFromRubric: e.target.checked })}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Use the marking rubric&apos;s bands as the criteria
                <span className="block text-xs text-slate-500">
                  Peers then score four bands on a five-step scale instead of a criteria list of their own.
                </span>
              </span>
            </label>
            <p className="text-xs text-slate-500">
              A response is worth{" "}
              <span className="font-semibold text-slate-700">{peerMaxScore(peer.criteria, writtenCount)} marks</span> (
              {writtenCount} reviewed question{writtenCount === 1 ? "" : "s"}).
            </p>
            <PeerEditor value={peer} onChange={setPeer} hideCriteria={!!settings.peerFromRubric} />
          </div>
        )}

        {hasMulti && (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <p className="text-sm font-semibold text-slate-900">Marking multiple-answer questions</p>
            <div className="flex flex-wrap gap-2 text-sm">
              {([["exact", "All or nothing"], ["partial", "Partial credit"]] as [MultiScoring, string][]).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => set({ multiScoring: mode })}
                  className={`rounded-lg px-4 py-2 font-medium ${
                    (settings.multiScoring ?? "exact") === mode ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              {(settings.multiScoring ?? "exact") === "exact"
                ? "Full marks only when the student ticks exactly the right set — nothing otherwise."
                : "Each correct tick earns a share of the marks and each wrong tick cancels one, never going below zero."}
            </p>
          </div>
        )}

        <div className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2">
          {(
            [
              ["shuffleQuestions", "Shuffle questions"],
              ["shuffleOptions", "Shuffle options"],
              ["allowMultiple", "Allow more than one attempt"],
              ["examMode", "Exam Interface mode"],
              ["mstMode", "Adaptive paper (multistage)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={!!settings[key]}
                onChange={(e) => set({ [key]: e.target.checked } as Partial<QuizSettings>)}
                className="h-4 w-4"
              />
              {label}
            </label>
          ))}
        </div>

        {/* ---------- submission type ---------- */}
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <p className="text-sm font-semibold text-slate-900">Submission type</p>
          <div className="flex flex-wrap gap-2 text-sm">
            {([[false, "Individual"], [true, "Group work"]] as [boolean, string][]).map(([mode, label]) => (
              <button
                key={label}
                onClick={() => set({ groupMode: mode })}
                className={`rounded-lg px-4 py-2 font-medium ${
                  !!settings.groupMode === mode ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {settings.groupMode ? (
            <div className="flex flex-wrap gap-4 text-sm text-slate-700">
              <label>
                Minimum members
                <input
                  type="number"
                  min={1}
                  value={groupMin}
                  onChange={(e) => setGroupMin(e.target.value)}
                  className="ml-2 w-20 rounded-lg border border-slate-300 px-3 py-1.5 text-slate-900"
                />
              </label>
              <label>
                Maximum members
                <input
                  type="number"
                  min={1}
                  value={groupMax}
                  onChange={(e) => setGroupMax(e.target.value)}
                  className="ml-2 w-20 rounded-lg border border-slate-300 px-3 py-1.5 text-slate-900"
                />
              </label>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Each student submits their own attempt.</p>
          )}
          {attemptCount > 0 && (
            <p className="text-xs text-amber-700">
              Attempts already submitted keep the form they were made in; this only changes who submits from now on.
            </p>
          )}
        </div>

        {/* ---------- timer ---------- */}
        <div className="space-y-2 border-t border-slate-100 pt-3 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">Timer</p>
          <div className="flex flex-wrap gap-2">
            {([["none", "No timer"], ["quiz", "Whole-quiz limit"], ["question", "Per-question countdown"]] as [TimerMode, string][]).map(
              ([mode, label]) => {
                const blocked = (settings.examMode || settings.mstMode) && mode === "question";
                return (
                  <button
                    key={mode}
                    onClick={() => !blocked && setTimer(mode)}
                    disabled={blocked}
                    title={blocked ? "This mode uses a whole-paper timer." : undefined}
                    className={`rounded-lg px-4 py-2 font-medium ${
                      effectiveTimerMode === mode ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                    } ${blocked ? "cursor-not-allowed opacity-40" : ""}`}
                  >
                    {label}
                  </button>
                );
              }
            )}
          </div>
          {(settings.examMode || settings.mstMode) && (
            <p className="text-xs text-slate-500">
              {settings.mstMode ? "An adaptive paper" : "Exam Interface mode"} lets students move between questions, so
              it uses a whole-paper timer — the per-question countdown is unavailable.
            </p>
          )}
          {effectiveTimerMode === "quiz" && (
            <label className="block">
              Maximum minutes once a student starts
              <input
                type="number"
                min={1}
                value={settings.maxMinutes ?? 15}
                onChange={(e) => set({ maxMinutes: Number(e.target.value) || 1 })}
                className="ml-2 w-24 rounded-lg border border-slate-300 px-3 py-1.5 text-slate-900"
              />
            </label>
          )}
          {effectiveTimerMode === "question" && (
            <div className="space-y-2">
              <label className="block">
                Seconds per question
                <input
                  type="number"
                  min={5}
                  value={settings.perQuestionSeconds ?? 45}
                  onChange={(e) => set({ perQuestionSeconds: Number(e.target.value) || 5 })}
                  className="ml-2 w-24 rounded-lg border border-slate-300 px-3 py-1.5 text-slate-900"
                />
              </label>
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700">
                Per-question mode shows one question at a time and students cannot go back — like a rapid-fire round.
              </p>
            </div>
          )}
          <label className="block">
            Stop accepting responses at (optional)
            <input
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              className="ml-2 rounded-lg border border-slate-300 px-3 py-1.5 text-slate-900"
            />
            {closesAt && (
              <button onClick={() => setClosesAt("")} className="ml-2 text-xs font-semibold text-slate-500 hover:text-slate-800">
                Clear
              </button>
            )}
          </label>
        </div>

        {/* ---------- adaptive paper ---------- */}
        {settings.mstMode && (
          <div className="space-y-2 border-t border-slate-100 pt-3 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Adaptive paper</p>
            <div className="flex flex-wrap gap-4">
              <label>
                Sections
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={mst.stages}
                  onChange={(e) => {
                    setMst({ ...mst, stages: Math.max(1, Number(e.target.value) || 1) });
                    setPlan(null);
                  }}
                  className="ml-2 w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-slate-900"
                />
              </label>
              <label>
                Per section
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={mst.perStage}
                  onChange={(e) => {
                    setMst({ ...mst, perStage: Math.max(1, Number(e.target.value) || 1) });
                    setPlan(null);
                  }}
                  className="ml-2 w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-slate-900"
                />
              </label>
              <label>
                Start at
                <select
                  value={mst.startDifficulty}
                  onChange={(e) => setMst({ ...mst, startDifficulty: Number(e.target.value) })}
                  className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} · {difficultyLabel(n)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-4">
              <label>
                Step up at or above
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={mst.routeUpAt}
                  onChange={(e) => setMst({ ...mst, routeUpAt: Number(e.target.value) || 0 })}
                  className="ml-2 w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-slate-900"
                />
                %
              </label>
              <label>
                Step down at or below
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={mst.routeDownAt}
                  onChange={(e) => setMst({ ...mst, routeDownAt: Number(e.target.value) || 0 })}
                  className="ml-2 w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-slate-900"
                />
                %
              </label>
            </div>
            {mst.routeUpAt <= mst.routeDownAt && (
              <p className="text-xs text-amber-700">
                The step-up mark must be above the step-down mark, or a section would step both ways at once. It will be
                nudged up when you save.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["fixed", "Each question is worth what it says"],
                  ["byDifficulty", "Harder questions are worth more"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setMst({ ...mst, scoring: value })}
                  className={`rounded-lg px-4 py-2 font-medium ${mst.scoring === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={mst.abilityScore}
                onChange={(e) => setMst({ ...mst, abilityScore: e.target.checked })}
                className="h-4 w-4"
              />
              Report an ability estimate
            </label>
            {(() => {
              const capacity = mstCapacity(rows as Question[], mst);
              return capacity.warnings.length ? (
                <div className="text-xs text-amber-700">
                  {capacity.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </div>
              ) : null;
            })()}
            {attemptCount > 0 && (
              <p className="text-xs text-amber-700">
                Students who have already sat this paper keep the sections they were actually given; changing the
                routing only affects those who start from now on.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ---------- questions ---------- */}
      <section id="questions" className="mt-4 scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold text-slate-900">Questions ({rows.length})</h2>
        <p className="mt-1 text-xs text-slate-500">
          {gradingMode === "survey" || gradingMode === "peer"
            ? "Nothing in this quiz is marked at submission, so no marks or answer keys are set here."
            : "Change a question's type, its options, its marks or its answer key — and the material students read before it."}
        </p>
        <div className="mt-3">
          <QuestionEditor
            questions={rows}
            onChange={(next) => {
              setRows(next);
              setPlan(null);
            }}
            unscored={gradingMode === "survey" || gradingMode === "peer"}
            showIds
          />
        </div>
      </section>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">{saveBar}</div>

      <div className="fixed bottom-5 right-4 flex flex-col gap-2">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Jump to top"
          className="h-11 w-11 rounded-full bg-slate-900 text-lg font-bold text-white shadow-lg hover:bg-slate-700"
        >
          ↑
        </button>
        <button
          onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })}
          aria-label="Jump to bottom"
          className="h-11 w-11 rounded-full bg-slate-900 text-lg font-bold text-white shadow-lg hover:bg-slate-700"
        >
          ↓
        </button>
      </div>
    </main>
  );
}
