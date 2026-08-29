/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TeacherBar from "@/components/TeacherBar";
import { difficultyLabel, findPreset, parseTag, type TagPreset, type TagVariantGroup } from "@/lib/tags";
import type { Question } from "@/lib/types";
import Logo from "@/components/Logo";

interface Vocabulary {
  counts: Record<string, number>;
  quizzesFor: Record<string, string[]>;
  untagged: number;
  total: number;
  variants: TagVariantGroup[];
  presets: TagPreset[];
  preset: string | null;
}

interface QuizRow {
  id: string;
  title: string;
  created_at: string;
}

export default function TagsPage() {
  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [quizzes, setQuizzes] = useState<QuizRow[]>([]);
  const [authError, setAuthError] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const [editing, setEditing] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [draft, setDraft] = useState<Record<string, { tags: string; difficulty: string }>>({});
  const [preset, setPreset] = useState<string>("");
  const [bulk, setBulk] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await fetch("/api/tags");
    if (res.status === 401) {
      setAuthError(true);
      return;
    }
    const data: Vocabulary = await res.json();
    setVocab(data);
    setPreset((p) => p || data.preset || "");
  }, []);

  useEffect(() => {
    load();
    (async () => {
      const res = await fetch("/api/quizzes");
      if (!res.ok) return;
      const data = await res.json();
      setQuizzes(data.quizzes ?? []);
    })();
  }, [load]);

  async function openQuiz(id: string) {
    setEditing(id);
    setMessage("");
    setChosen(new Set());
    const res = await fetch(`/api/quizzes/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    const qs: Question[] = data.quiz.questions ?? [];
    setQuestions(qs);
    setPreset(data.quiz.preset ?? preset);
    setDraft(
      Object.fromEntries(
        qs.map((qn) => [qn.id, { tags: (qn.tags ?? []).join("; "), difficulty: qn.difficulty ? String(qn.difficulty) : "" }])
      )
    );
  }

  async function saveTags() {
    if (!editing) return;
    setBusy("saving");
    const payload = Object.fromEntries(
      Object.entries(draft).map(([qid, v]) => [qid, { tags: v.tags, difficulty: v.difficulty === "" ? null : Number(v.difficulty) }])
    );
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quizId: editing, tags: payload, preset: preset || null }),
    });
    setBusy("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(data.error ?? "Could not save the tags.");
      return;
    }
    setMessage("Tags saved. Every attempt already submitted counts towards them from now on.");
    load();
  }

  async function applyMerge(group: TagVariantGroup, keep: string) {
    setBusy(`merge-${group.keep}`);
    const merges: Record<string, string> = {};
    for (const tag of [group.keep, ...group.merge]) {
      if (tag !== keep) merges[tag] = keep;
    }
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merges }),
    });
    setBusy("");
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? `Merged into “${keep}” across ${data.changed} questions.` : (data.error ?? "Could not merge."));
    load();
  }

  /** Apply the bulk box to every ticked question, adding rather than replacing. */
  function applyBulk() {
    if (!bulk.trim() || !chosen.size) return;
    setDraft((d) => {
      const next = { ...d };
      for (const qid of chosen) {
        const existing = next[qid]?.tags ?? "";
        next[qid] = {
          ...next[qid],
          tags: existing.trim() ? `${existing}; ${bulk.trim()}` : bulk.trim(),
        };
      }
      return next;
    });
    setBulk("");
  }

  const activePreset = findPreset(preset);
  const suggestions = useMemo(() => {
    const fromVocab = Object.keys(vocab?.counts ?? {});
    if (!activePreset) return fromVocab.sort();
    const fromPreset: string[] = [];
    for (const d of activePreset.dimensions) {
      if (d.name === "Difficulty") continue;
      for (const v of d.values) fromPreset.push(`${d.name}: ${v}`);
    }
    return [...new Set([...fromPreset, ...fromVocab])].sort();
  }, [vocab, activePreset]);

  const sortedTags = useMemo(() => {
    const entries = Object.entries(vocab?.counts ?? {});
    const groups = new Map<string, { tag: string; n: number }[]>();
    for (const [tag, n] of entries) {
      const dimension = parseTag(tag)?.dimension ?? "Topic";
      groups.set(dimension, [...(groups.get(dimension) ?? []), { tag, n }]);
    }
    return [...groups.entries()]
      .map(([dimension, rows]) => ({ dimension, rows: rows.sort((a, b) => b.n - a.n) }))
      .sort((a, b) => a.dimension.localeCompare(b.dimension));
  }, [vocab]);

  if (authError) {
    return (
      <main className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Please sign in</h1>
        <Link href="/teacher" className="mt-3 inline-block text-sm font-semibold text-blue-700">
          Go to the teacher area
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <TeacherBar />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Logo />
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Tags</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Tags are what turn a mark into a diagnosis. Tagging a quiz counts backwards as well as forwards —
            every attempt already submitted is measured against the tags the moment you add them, so nobody has to
            re-sit anything.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/teacher/analytics" className="rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-700">
            Strengths report
          </Link>
          <Link href="/teacher" className="rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-700">
            Quizzes
          </Link>
        </div>
      </div>

      {message && (
        <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{message}</p>
      )}

      {vocab && (
        <>
          <section className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-2xl font-bold text-slate-900">{vocab.total - vocab.untagged}</p>
              <p className="text-sm text-slate-500">questions tagged</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-2xl font-bold text-slate-900">{vocab.untagged}</p>
              <p className="text-sm text-slate-500">still untagged</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-2xl font-bold text-slate-900">{Object.keys(vocab.counts).length}</p>
              <p className="text-sm text-slate-500">distinct tags in use</p>
            </div>
          </section>

          {/* ---------- drift ---------- */}
          {vocab.variants.length > 0 && (
            <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <h2 className="font-bold text-amber-900">Spellings that look like one tag</h2>
              <p className="mt-1 text-sm text-amber-900">
                Two spellings of one topic split it into two buckets, each too small to draw a conclusion from.
                Nothing is merged until you choose which spelling to keep.
              </p>
              <div className="mt-3 space-y-3">
                {vocab.variants.map((group) => (
                  <div key={group.keep} className="rounded-xl border border-amber-200 bg-white p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(group.counts).map(([tag, n]) => (
                        <button
                          key={tag}
                          onClick={() => applyMerge(group, tag)}
                          disabled={busy === `merge-${group.keep}`}
                          title={`Keep “${tag}” and fold the others into it`}
                          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-900 hover:bg-slate-900 hover:text-white disabled:opacity-40"
                        >
                          {tag} <span className="opacity-60">×{n}</span>
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-amber-800">Click the spelling to keep.</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ---------- vocabulary ---------- */}
          {sortedTags.length > 0 && (
            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="font-bold text-slate-900">Your vocabulary</h2>
              <div className="mt-3 space-y-3">
                {sortedTags.map((group) => (
                  <div key={group.dimension}>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">{group.dimension}</h3>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {group.rows.map(({ tag, n }) => (
                        <span
                          key={tag}
                          title={`${n} question${n === 1 ? "" : "s"} · ${(vocab.quizzesFor[tag] ?? []).join(", ")}`}
                          className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700"
                        >
                          {parseTag(tag)?.value ?? tag} <span className="text-slate-400">{n}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* ---------- per-quiz tag editor ---------- */}
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold text-slate-900">Tag a quiz</h2>
        <p className="mt-1 text-sm text-slate-500">
          Only tags and difficulty can be changed here. Question text, options and answer keys are left alone, so
          this can never disturb a mark that has already been awarded.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {quizzes.map((z) => (
            <button
              key={z.id}
              onClick={() => openQuiz(z.id)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${editing === z.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              {z.title}
            </button>
          ))}
          {!quizzes.length && <p className="text-sm text-slate-400">No quizzes yet.</p>}
        </div>

        {editing && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm text-slate-700">
                Vocabulary:
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value)}
                  className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="">No fixed list</option>
                  {(vocab?.presets ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={saveTags}
                disabled={busy === "saving"}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy === "saving" ? "Saving…" : "Save tags"}
              </button>
            </div>

            <div className="mt-3 rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">
                Add to the {chosen.size || "…"} ticked question{chosen.size === 1 ? "" : "s"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  value={bulk}
                  onChange={(e) => setBulk(e.target.value)}
                  list="tag-suggestions"
                  placeholder="Period: Victorian; Genre: Poetry"
                  className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
                <button
                  onClick={applyBulk}
                  disabled={!bulk.trim() || !chosen.size}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:opacity-40"
                >
                  Add to ticked
                </button>
                <button
                  onClick={() => setChosen(new Set(chosen.size === questions.length ? [] : questions.map((qn) => qn.id)))}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700"
                >
                  {chosen.size === questions.length ? "Untick all" : "Tick all"}
                </button>
              </div>
            </div>

            <datalist id="tag-suggestions">
              {suggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>

            <div className="mt-3 space-y-2">
              {questions.map((qn, i) => (
                <div key={qn.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={chosen.has(qn.id)}
                      onChange={(e) => {
                        const next = new Set(chosen);
                        if (e.target.checked) next.add(qn.id);
                        else next.delete(qn.id);
                        setChosen(next);
                      }}
                      className="mt-1 h-4 w-4"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-400">
                        Q{i + 1} · {qn.type.toUpperCase()}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-800">{qn.text}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <input
                          value={draft[qn.id]?.tags ?? ""}
                          onChange={(e) => setDraft({ ...draft, [qn.id]: { ...draft[qn.id], tags: e.target.value } })}
                          list="tag-suggestions"
                          placeholder="Dimension: Value; Dimension: Value"
                          className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                        />
                        <select
                          value={draft[qn.id]?.difficulty ?? ""}
                          onChange={(e) =>
                            setDraft({ ...draft, [qn.id]: { ...draft[qn.id], difficulty: e.target.value } })
                          }
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        >
                          <option value="">Difficulty —</option>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n} · {difficultyLabel(n)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
