/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { getTheme } from "@/lib/themes";
import { NO_SEMESTER, SEMESTER_CHOICES } from "@/lib/normalize";
import { groupByPassage } from "@/lib/questions";
import Material from "@/components/Material";

interface Band {
  id: string;
  label: string;
  weight: number;
  percent: number | null;
}

interface ResultQuestion {
  id: string;
  text: string;
  passage?: string;
  passageTitle?: string;
  points: number;
  graded: boolean;
  written: boolean;
  answer: string;
  words: number;
  wordLimit?: number;
  awarded: number;
  percent: number | null;
  marked: boolean;
  modelAnswer?: string;
  bands: Band[];
  strengths?: string;
  improvements?: string;
  corrections?: string;
  oneThing?: string;
  comment?: string;
}

interface ResultPayload {
  quizTitle: string;
  theme: string;
  who: string;
  score: number;
  max: number;
  submittedAt: string;
  questions: ResultQuestion[];
}

/**
 * A student's released result on a rubric-marked quiz.
 *
 * The four written fields are the point of the exercise, so they are given more
 * room than the mark is. The band bars sit above them because a student who
 * knows they lost the marks in Language rather than Content knows what to
 * practise; a bare percentage tells them only how they did.
 */
export default function RubricResultPage() {
  const { slug } = useParams<{ slug: string }>();
  const [roll, setRoll] = useState("");
  const [semester, setSemester] = useState("");
  const [data, setData] = useState<ResultPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const theme = getTheme(data?.theme ?? "slate");
  const pageStyle = { background: theme.bg, color: theme.text, minHeight: "100%" };
  const cardStyle = { background: theme.card, borderColor: theme.border };
  const accentBtn = { background: theme.accent, color: theme.accentText };

  const look = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setError("");
      const res = await fetch("/api/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, roll, semester }),
      });
      setBusy(false);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not find your result.");
        return;
      }
      setData(body);
    },
    [slug, roll, semester]
  );

  if (!data) {
    return (
      <div style={pageStyle} className="flex-1 px-4 py-12">
        <main className="mx-auto max-w-md">
          <div className="rounded-2xl border p-6 shadow-sm" style={cardStyle}>
            <h1 className="text-xl font-bold">Your marked result</h1>
            <p className="mt-2 text-sm" style={{ color: theme.muted }}>
              Enter the roll number and semester you submitted with.
            </p>
            <form onSubmit={look} className="mt-4 space-y-3">
              <input
                value={roll}
                onChange={(e) => setRoll(e.target.value.replace(/\D/g, ""))}
                placeholder="Class roll number"
                inputMode="numeric"
                required
                className="w-full rounded-lg border px-4 py-2.5 bg-white text-slate-900"
                style={{ borderColor: theme.border }}
              />
              <select
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                required
                className="w-full rounded-lg border px-3 py-2.5 bg-white text-slate-900"
                style={{ borderColor: theme.border }}
              >
                <option value="">Semester</option>
                {SEMESTER_CHOICES.map((n) => (
                  <option key={n} value={n}>Sem {n}</option>
                ))}
                <option value={NO_SEMESTER}>Not applicable</option>
              </select>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg py-3 font-semibold disabled:opacity-50"
                style={accentBtn}
              >
                {busy ? "Looking…" : "See my result"}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  const pct = data.max ? Math.round((data.score / data.max) * 100) : 0;

  return (
    <div style={pageStyle} className="flex-1 px-4 py-10">
      <main className="mx-auto max-w-2xl">
        <div className="rounded-2xl border p-6 text-center shadow-sm print-page" style={cardStyle}>
          <p className="text-sm font-medium" style={{ color: theme.muted }}>{data.quizTitle}</p>
          <h1 className="mt-1 text-xl font-bold">{data.who}</h1>
          <p className="mt-4 text-5xl font-bold" style={{ color: theme.accent }}>
            {data.score}
            <span className="text-2xl font-semibold" style={{ color: theme.muted }}> / {data.max}</span>
          </p>
          <p className="mt-1 text-sm" style={{ color: theme.muted }}>
            {pct}% · marked against your teacher&apos;s rubric
          </p>
          <button onClick={() => window.print()} className="no-print mt-4 rounded-lg px-5 py-2.5 font-semibold" style={accentBtn}>
            Print / save your copy
          </button>
        </div>

        <div className="mt-6 space-y-4">
          {groupByPassage(data.questions).map((group) => (
            <div key={group.start} className="space-y-4">
              <Material text={group.passage} title={group.passageTitle} colours={theme} collapsible={false} />
              {group.questions.map((qn, j) => (
                <div key={qn.id} className="rounded-2xl border p-5 shadow-sm print-page" style={cardStyle}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-semibold" style={{ color: theme.muted }}>
                      Q{group.start + j + 1}
                      {qn.graded ? ` · ${qn.points} pt` : ""}
                    </p>
                    {qn.graded && (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                        {qn.marked ? `${qn.awarded} / ${qn.points}` : "Not marked"}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 font-medium">{qn.text}</p>

                  <div className="mt-3 rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap" style={{ borderColor: theme.border }}>
                    {qn.answer || <span style={{ color: theme.muted }}>No answer given.</span>}
                  </div>
                  {qn.written && !!qn.wordLimit && (
                    <p className="mt-1 text-xs" style={{ color: theme.muted }}>
                      {qn.words} words{qn.wordLimit ? ` · limit ${qn.wordLimit}` : ""}
                      {qn.words > qn.wordLimit ? " — over the limit" : ""}
                    </p>
                  )}

                  {qn.bands.length > 0 && (
                    <div className="mt-4 space-y-1.5">
                      {qn.bands.map((b) => (
                        <div key={b.id} className="flex items-center gap-2 text-xs">
                          <span className="w-40 shrink-0 truncate" style={{ color: theme.muted }}>{b.label}</span>
                          <div className="h-3 flex-1 overflow-hidden rounded" style={{ background: theme.accentSoft }}>
                            <div
                              className="h-full"
                              style={{ width: `${Math.min(100, b.percent ?? 0)}%`, background: theme.accent }}
                            />
                          </div>
                          <span className="w-12 text-right tabular-nums" style={{ color: theme.muted }}>
                            {b.percent === null ? "—" : `${b.percent}%`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(qn.strengths || qn.improvements || qn.corrections || qn.oneThing || qn.comment) && (
                    <div className="mt-4 space-y-2 rounded-lg p-3 text-sm" style={{ background: theme.accentSoft }}>
                      {[
                        ["What worked", qn.strengths],
                        ["What would raise the mark", qn.improvements],
                        ["Corrections", qn.corrections],
                        ["One thing to fix next time", qn.oneThing],
                        ["Note from your teacher", qn.comment],
                      ]
                        .filter(([, text]) => !!text)
                        .map(([label, text]) => (
                          <p key={label} className="whitespace-pre-wrap">
                            <span className="font-semibold">{label}: </span>
                            {text}
                          </p>
                        ))}
                    </div>
                  )}

                  {qn.modelAnswer && (
                    <details className="mt-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: theme.border }}>
                      <summary className="cursor-pointer font-semibold">Model answer</summary>
                      <p className="mt-2 whitespace-pre-wrap">{qn.modelAnswer}</p>
                    </details>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
