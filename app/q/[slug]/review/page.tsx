/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getTheme } from "@/lib/themes";
import { NO_SEMESTER, SEMESTER_CHOICES } from "@/lib/normalize";
import type { PeerCriterion } from "@/lib/peer";

interface Task {
  reviewId: string;
  label: string;
  status: string;
  scores: Record<string, Record<string, number>>;
  comments: Record<string, string>;
  answers: Record<string, string>;
}

interface ReviewQuestion {
  id: string;
  text: string;
  passage?: string;
}

interface Session {
  quizTitle: string;
  theme: string;
  phase: "reviewing" | "closed";
  reviewerAttemptId: string;
  criteria: PeerCriterion[];
  commentRequired: boolean;
  questions: ReviewQuestion[];
  tasks: Task[];
  feedback: { total: number | null; max: number; comments: string[] } | null;
}

export default function PeerReviewPage() {
  const { slug } = useParams<{ slug: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [roll, setRoll] = useState("");
  const [semester, setSemester] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const [scores, setScores] = useState<Record<string, Record<string, number>>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  const theme = getTheme(session?.theme ?? "slate");
  const draftKey = session ? `qz-peer-${slug}-${session.reviewerAttemptId}` : "";

  // Load whichever task is open into the working copy, preferring an unsent draft.
  const task = session?.tasks[active];
  useEffect(() => {
    if (!task) return;
    let draft: { scores?: typeof scores; comments?: typeof comments } | null = null;
    try {
      const raw = localStorage.getItem(`${draftKey}-${task.reviewId}`);
      if (raw) draft = JSON.parse(raw);
    } catch {}
    setScores(draft?.scores ?? task.scores ?? {});
    setComments(draft?.comments ?? task.comments ?? {});
    setSaveError("");
  }, [task, draftKey]);

  // Autosave, so a lost connection never costs a written review.
  useEffect(() => {
    if (!task || !draftKey) return;
    localStorage.setItem(`${draftKey}-${task.reviewId}`, JSON.stringify({ scores, comments }));
  }, [scores, comments, task, draftKey]);

  const done = session?.tasks.filter((t) => t.status === "submitted").length ?? 0;

  const complete = useMemo(() => {
    if (!session || !task) return false;
    return session.questions.every(
      (qn) =>
        session.criteria.every((c) => Number.isFinite(scores?.[qn.id]?.[c.id])) &&
        (!session.commentRequired || (comments[qn.id] ?? "").trim() !== "")
    );
  }, [session, task, scores, comments]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/peer/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, roll, semester }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not open your reviews.");
      return;
    }
    setSession(data);
    setActive(Math.max(0, data.tasks.findIndex((t: Task) => t.status !== "submitted")));
  }

  async function submitReview() {
    if (!session || !task) return;
    setBusy(true);
    setSaveError("");
    const res = await fetch("/api/peer/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: task.reviewId, reviewerAttemptId: session.reviewerAttemptId, scores, comments }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaveError(data.error ?? "Could not send this review.");
      return;
    }
    localStorage.removeItem(`${draftKey}-${task.reviewId}`);
    const tasks = session.tasks.map((t, i) => (i === active ? { ...t, status: "submitted", scores, comments } : t));
    setSession({ ...session, tasks });
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2500);
    const next = tasks.findIndex((t) => t.status !== "submitted");
    if (next >= 0) setActive(next);
  }

  const pageStyle = { background: theme.bg, color: theme.text, minHeight: "100%" };
  const cardStyle = { background: theme.card, borderColor: theme.border };
  const accentBtn = { background: theme.accent, color: theme.accentText };

  // ---------------- sign in ----------------
  if (!session) {
    return (
      <div style={pageStyle} className="flex-1 px-4 py-10">
        <main className="mx-auto max-w-md">
          <div className="rounded-2xl border p-6 shadow-sm" style={cardStyle}>
            <h1 className="text-xl font-bold">Peer review</h1>
            <p className="mt-2 text-sm" style={{ color: theme.muted }}>
              Enter the roll number and semester you submitted with, and you will be given a few classmates&apos;
              responses to mark. You will not be told whose work it is, and they will not be told who marked it.
            </p>
            <form onSubmit={signIn} className="mt-5 space-y-3">
              <input
                value={roll}
                onChange={(e) => setRoll(e.target.value.replace(/\D/g, ""))}
                placeholder="Class roll number"
                inputMode="numeric"
                required
                className="w-full rounded-lg border bg-white px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2"
                style={{ borderColor: theme.border }}
              />
              <select
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                required
                className="w-full rounded-lg border bg-white px-3 py-2.5 text-slate-900"
                style={{ borderColor: theme.border }}
              >
                <option value="">Semester</option>
                {SEMESTER_CHOICES.map((n) => (
                  <option key={n} value={n}>Sem {n}</option>
                ))}
                <option value={NO_SEMESTER}>Not applicable</option>
              </select>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button type="submit" disabled={busy} className="w-full rounded-lg py-3 font-semibold disabled:opacity-50" style={accentBtn}>
                {busy ? "Checking…" : "Open my reviews"}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  // ---------------- results released ----------------
  if (session.phase === "closed") {
    const fb = session.feedback;
    return (
      <div style={pageStyle} className="flex-1 px-4 py-10">
        <main className="mx-auto max-w-2xl space-y-4">
          <div className="rounded-2xl border p-6 text-center shadow-sm" style={cardStyle}>
            <p className="text-sm font-medium" style={{ color: theme.muted }}>{session.quizTitle}</p>
            <h1 className="mt-1 text-xl font-bold">Peer review is finished</h1>
            {fb && fb.total !== null ? (
              <p className="mt-4 text-5xl font-bold" style={{ color: theme.accent }}>
                {fb.total}
                <span className="text-2xl font-semibold" style={{ color: theme.muted }}> / {fb.max}</span>
              </p>
            ) : (
              <p className="mt-4 text-sm" style={{ color: theme.muted }}>Your mark has not been released.</p>
            )}
          </div>
          {fb && fb.comments.length > 0 && (
            <div className="rounded-2xl border p-5 shadow-sm" style={cardStyle}>
              <h2 className="font-semibold">What your classmates said</h2>
              <p className="mt-1 text-xs" style={{ color: theme.muted }}>
                Comments are shown without names and in no particular order.
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {fb.comments.map((c, i) => (
                  <li key={i} className="rounded-lg border p-3 whitespace-pre-wrap" style={{ borderColor: theme.border }}>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </main>
      </div>
    );
  }

  // ---------------- reviewing ----------------
  const allDone = done === session.tasks.length;
  return (
    <div style={pageStyle} className="flex-1 pb-12">
      <div className="sticky top-0 z-10 border-b px-4 py-3 backdrop-blur" style={{ background: `${theme.card}ee`, borderColor: theme.border }}>
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 text-sm">
          <p className="truncate font-semibold">{session.quizTitle} — peer review</p>
          <span style={{ color: theme.muted }}>{done}/{session.tasks.length} reviews done</span>
        </div>
      </div>

      <main className="mx-auto mt-6 max-w-2xl space-y-5 px-4">
        {session.tasks.length === 0 && (
          <div className="rounded-2xl border p-6 text-center shadow-sm" style={cardStyle}>
            <p className="font-semibold">Nothing to review yet</p>
            <p className="mt-1 text-sm" style={{ color: theme.muted }}>
              Your teacher has not assigned you any responses. Check back shortly.
            </p>
          </div>
        )}

        {session.tasks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {session.tasks.map((t, i) => (
              <button
                key={t.reviewId}
                onClick={() => setActive(i)}
                className="rounded-lg border-2 px-3 py-1.5 text-xs font-semibold"
                style={
                  i === active
                    ? { borderColor: theme.accent, background: theme.accentSoft }
                    : { borderColor: theme.border, opacity: t.status === "submitted" ? 0.6 : 1 }
                }
              >
                {t.label}{t.status === "submitted" ? " ✓" : ""}
              </button>
            ))}
          </div>
        )}

        {allDone && session.tasks.length > 0 && (
          <div className="rounded-2xl border-2 p-4 text-sm" style={{ borderColor: theme.accent, background: theme.accentSoft }}>
            All your reviews are in — thank you. You can still revise any of them until your teacher closes the quiz.
          </div>
        )}

        {task &&
          session.questions.map((qn, qi) => (
            <div key={qn.id} className="rounded-2xl border p-5 shadow-sm" style={cardStyle}>
              <p className="text-xs font-semibold" style={{ color: theme.muted }}>
                {task.label} · Part {qi + 1} of {session.questions.length}
              </p>
              {qn.passage && (
                <p className="mt-2 whitespace-pre-wrap rounded-lg border p-3 text-sm" style={{ borderColor: theme.border, color: theme.muted }}>
                  {qn.passage}
                </p>
              )}
              <p className="mt-2 font-medium">{qn.text}</p>

              <div className="mt-3 rounded-xl border p-4" style={{ borderColor: theme.border, background: theme.accentSoft }}>
                <p className="text-xs font-semibold" style={{ color: theme.muted }}>Their answer</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {task.answers[qn.id]?.trim() || <span style={{ color: theme.muted }}>They left this blank.</span>}
                </p>
              </div>

              <div className="mt-4 space-y-3">
                {session.criteria.map((c) => {
                  const value = scores?.[qn.id]?.[c.id];
                  return (
                    <div key={c.id}>
                      <div className="flex items-baseline justify-between">
                        <label className="text-sm font-semibold">{c.label}</label>
                        <span className="text-xs" style={{ color: theme.muted }}>
                          {Number.isFinite(value) ? `${value} / ${c.max}` : `— / ${c.max}`}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {Array.from({ length: c.max + 1 }, (_, n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() =>
                              setScores((s) => ({ ...s, [qn.id]: { ...(s[qn.id] ?? {}), [c.id]: n } }))
                            }
                            aria-pressed={value === n}
                            className="h-9 w-9 rounded-lg border-2 text-sm font-semibold"
                            style={
                              value === n
                                ? { borderColor: theme.accent, background: theme.accent, color: theme.accentText }
                                : { borderColor: theme.border }
                            }
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <label className="mt-4 block text-sm font-semibold">
                Comment{session.commentRequired ? "" : " (optional)"}
                <textarea
                  value={comments[qn.id] ?? ""}
                  onChange={(e) => setComments((c) => ({ ...c, [qn.id]: e.target.value }))}
                  rows={4}
                  placeholder="What worked, and what would make it stronger?"
                  className="mt-1.5 w-full rounded-xl border-2 bg-white px-4 py-3 text-sm font-normal text-slate-900 focus:outline-none"
                  style={{ borderColor: theme.border }}
                />
              </label>
            </div>
          ))}

        {task && (
          <div className="rounded-2xl border p-5 text-center shadow-sm" style={cardStyle}>
            {saveError && <p className="mb-2 text-sm text-red-600">{saveError}</p>}
            {justSaved && <p className="mb-2 text-sm font-semibold text-green-700">Review sent ✓</p>}
            <p className="text-sm" style={{ color: theme.muted }}>
              {complete ? "Everything is filled in." : "Score every criterion and leave a comment on each part."}
            </p>
            <button
              onClick={submitReview}
              disabled={busy || !complete}
              className="mt-3 rounded-lg px-8 py-3 font-semibold disabled:opacity-40"
              style={accentBtn}
            >
              {busy ? "Sending…" : task.status === "submitted" ? "Update this review" : "Send this review"}
            </button>
            <p className="mt-3 text-xs" style={{ color: theme.muted }}>
              Your notes are saved on this device as you type. The person you are reviewing will never see your name.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
