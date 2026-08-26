/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { DEFAULT_MST, mstCapacity, normalizeMstConfig, type MstConfig } from "@/lib/mst";
import { TAG_PRESETS, difficultyLabel } from "@/lib/tags";
import { correctKeysOf, isGraded } from "@/lib/questions";
import { THEMES } from "@/lib/themes";
import type { EditPlan } from "@/lib/edit";
import type { Question, QuizSettings, TimerMode } from "@/lib/types";
import Logo from "@/components/Logo";

/** A question in the form: the stored shape, plus the raw text of its tag box. */
interface Row extends Question {
  tagText: string;
}

const toRow = (qn: Question): Row => ({ ...qn, tagText: (qn.tags ?? []).join("; ") });

export default function EditQuizPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [theme, setTheme] = useState("slate");
  const [preset, setPreset] = useState("");
  const [settings, setSettings] = useState<QuizSettings | null>(null);
  const [mst, setMst] = useState<MstConfig>(DEFAULT_MST);
  const [rows, setRows] = useState<Row[]>([]);
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
      setTheme(data.quiz.theme ?? "slate");
      setPreset(data.quiz.preset ?? "");
      setSettings(data.quiz.settings ?? null);
      setMst(normalizeMstConfig(data.quiz.settings?.mst));
      setRows((data.quiz.questions ?? []).map(toRow));
      setAttemptCount((data.attempts ?? []).length);
      setLoading(false);
    })();
  }, [id]);

  function patch(i: number, change: Partial<Row>) {
    setRows((list) => list.map((r, j) => (j === i ? { ...r, ...change } : r)));
    setPlan(null);
  }

  function move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
    setPlan(null);
  }

  async function save(confirm: boolean) {
    if (!settings) return;
    setSaving(true);
    setError("");
    setDone("");
    try {
      const payload = {
        title,
        description,
        theme,
        preset: preset || null,
        confirm,
        settings: { ...settings, mst: settings.mstMode ? mst : undefined },
        questions: rows.map((r) => ({
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
          tags: r.tagText,
          difficulty: r.difficulty,
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

  const set = (change: Partial<QuizSettings>) => {
    setSettings({ ...settings, ...change });
    setPlan(null);
  };

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
              disabled={saving}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save and re-mark"}
            </button>
          </div>
        </div>
      )}

      {/* ---------- basics ---------- */}
      <section className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <label className="block text-sm font-semibold text-slate-700">
          Title
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setPlan(null);
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
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
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
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
      <section className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold text-slate-900">Settings</h2>
        <div className="grid gap-2 sm:grid-cols-2">
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

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-sm text-slate-700">
          <label>
            Timer
            <select
              value={settings.timerMode}
              onChange={(e) => set({ timerMode: e.target.value as TimerMode })}
              className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5"
            >
              <option value="none">None</option>
              <option value="quiz">Whole quiz</option>
              <option value="question" disabled={!!settings.examMode || !!settings.mstMode}>
                Per question
              </option>
            </select>
          </label>
          {settings.timerMode === "quiz" && (
            <label>
              Minutes
              <input
                type="number"
                min={1}
                value={settings.maxMinutes ?? 15}
                onChange={(e) => set({ maxMinutes: Number(e.target.value) || 1 })}
                className="ml-2 w-20 rounded-lg border border-slate-300 px-2 py-1.5"
              />
            </label>
          )}
        </div>

        {settings.mstMode && (
          <div className="space-y-2 border-t border-slate-100 pt-3 text-sm text-slate-700">
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
                  className="ml-2 w-20 rounded-lg border border-slate-300 px-2 py-1.5"
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
                  className="ml-2 w-20 rounded-lg border border-slate-300 px-2 py-1.5"
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
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={mst.abilityScore}
                  onChange={(e) => setMst({ ...mst, abilityScore: e.target.checked })}
                  className="h-4 w-4"
                />
                Report an ability estimate
              </label>
            </div>
            {(() => {
              const capacity = mstCapacity(rows, mst);
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
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-900">Questions ({rows.length})</h2>
          <button
            onClick={() => {
              setRows([
                ...rows,
                {
                  id: "",
                  type: "mcq",
                  text: "",
                  options: [
                    { key: "A", text: "" },
                    { key: "B", text: "" },
                  ],
                  correct: "A",
                  points: 1,
                  tagText: "",
                } as Row,
              ]);
              setPlan(null);
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700"
          >
            Add a question
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {rows.map((r, i) => {
            const scored = isGraded(r);
            const keys = correctKeysOf(r);
            return (
              <div key={`${r.id || "new"}-${i}`} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-400">
                    Q{i + 1} · {r.type.toUpperCase()}
                    {r.id && <span className="ml-1 font-normal text-slate-300">({r.id})</span>}
                  </p>
                  <div className="flex gap-1">
                    <button onClick={() => move(i, -1)} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                      ↑
                    </button>
                    <button onClick={() => move(i, 1)} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                      ↓
                    </button>
                    <button
                      onClick={() => {
                        setRows(rows.filter((_, j) => j !== i));
                        setPlan(null);
                      }}
                      className="rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <textarea
                  value={r.text}
                  onChange={(e) => patch(i, { text: e.target.value })}
                  rows={2}
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />

                {(r.type === "mcq" || r.type === "multi") && (
                  <div className="mt-2 space-y-1.5">
                    {r.options.map((o, oi) => {
                      const right = scored && keys.includes(o.key);
                      return (
                        <div key={o.key} className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              patch(
                                i,
                                r.type === "multi"
                                  ? {
                                      correctKeys: right ? keys.filter((k) => k !== o.key) : [...keys, o.key].sort(),
                                      correct: undefined,
                                    }
                                  : { correct: o.key, correctKeys: undefined }
                              )
                            }
                            title={right ? "Correct" : "Mark as correct"}
                            className={`w-7 shrink-0 rounded px-1 py-1 text-xs font-bold ${right ? "bg-green-600 text-white" : "bg-slate-100 text-slate-500"}`}
                          >
                            {o.key}
                          </button>
                          <input
                            value={o.text}
                            onChange={(e) =>
                              patch(i, {
                                options: r.options.map((x, xi) => (xi === oi ? { ...x, text: e.target.value } : x)),
                              })
                            }
                            className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    value={r.tagText}
                    onChange={(e) => patch(i, { tagText: e.target.value })}
                    placeholder="Period: Victorian; Genre: Poetry"
                    className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
                  <select
                    value={r.difficulty ?? ""}
                    onChange={(e) => patch(i, { difficulty: e.target.value ? Number(e.target.value) : undefined })}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
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
                        value={r.points}
                        onChange={(e) => patch(i, { points: Number(e.target.value) || 0 })}
                        className="ml-1 w-20 rounded-lg border border-slate-300 px-2 py-1.5"
                      />
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => save(false)}
          disabled={saving}
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
      </div>
    </main>
  );
}
