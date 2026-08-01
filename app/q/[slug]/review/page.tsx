/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getTheme } from "@/lib/themes";
import { NO_SEMESTER, SEMESTER_CHOICES } from "@/lib/normalize";
import type { PeerCriterion, QuestionFeedback } from "@/lib/peer";
import type { ReviewPayload } from "@/lib/types";

interface Feedback {
  total: number | null;
  max: number;
  rubricMax: number;
  peerScore: number | null;
  reviewCredit: number;
  reviewPoints: number;
  reviewerCount: number;
  teacherSet: boolean;
  aggregate: "mean" | "median";
  questions: (QuestionFeedback & { answer: string })[];
}

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
  feedback: Feedback | null;
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
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState(0);
  const attempted = useRef(false);

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

  const open = useCallback(
    async (rollValue: string, semesterValue: string, quiet = false) => {
      setBusy(true);
      setError("");
      const res = await fetch("/api/peer/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, roll: rollValue, semester: semesterValue }),
      });
      setBusy(false);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A silent attempt that fails just leaves the form filled in for them.
        if (!quiet) setError(data.error ?? "Could not open your reviews.");
        return;
      }
      setSession(data);
      setActive(Math.max(0, data.tasks.findIndex((t: Task) => t.status !== "submitted")));
    },
    [slug]
  );

  /**
   * This device already submitted a response, so it knows who this is. Fill the
   * form in from the stored result and try it straight away — the student came
   * here from a button on their own result page and should not have to prove
   * who they are twice.
   */
  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    let saved: ReviewPayload | null = null;
    try {
      const raw = localStorage.getItem(`qd-review-${slug}`);
      if (raw) saved = JSON.parse(raw);
    } catch {}
    if (!saved) return;
    const savedRoll = saved.group ? (saved.group.members[0]?.roll ?? "") : saved.student.rollNorm;
    const savedSemester = saved.group ? saved.group.semester : saved.student.semester;
    if (!savedRoll || savedSemester === undefined || savedSemester === null) return;
    setRoll(String(savedRoll));
    setSemester(String(savedSemester));
    open(String(savedRoll), String(savedSemester), true);
  }, [slug, open]);

  function signIn(e: React.FormEvent) {
    e.preventDefault();
    open(roll, semester);
  }

  /** Ask again whether the teacher has released results, without a page reload. */
  async function checkResults() {
    setChecking(true);
    await open(roll, semester, true);
    setChecking(false);
    setCheckedAt(Date.now());
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
    const byId = new Map(session.questions.map((qn) => [qn.id, qn]));
    // The breakdown is an average per criterion; a median-aggregated quiz takes
    // the middle reviewer's total instead, which these need not add up to.
    const breakdownDiffers = !!fb && fb.aggregate === "median" && fb.reviewerCount > 1;
    return (
      <div style={pageStyle} className="flex-1 px-4 py-10">
        <main className="mx-auto max-w-2xl space-y-4">
          <div className="rounded-2xl border p-6 text-center shadow-sm print-page" style={cardStyle}>
            <p className="text-sm font-medium" style={{ color: theme.muted }}>{session.quizTitle}</p>
            <h1 className="mt-1 text-xl font-bold">Peer review is complete</h1>
            {fb && fb.total !== null ? (
              <>
                <p className="mt-3 text-sm" style={{ color: theme.muted }}>Your score is</p>
                <p className="text-5xl font-bold" style={{ color: theme.accent }}>
                  {fb.total}
                  <span className="text-2xl font-semibold" style={{ color: theme.muted }}> / {fb.max}</span>
                </p>
                <p className="mt-2 text-sm" style={{ color: theme.muted }}>
                  {fb.teacherSet
                    ? "Your teacher set this mark themselves."
                    : `Marked by ${fb.reviewerCount} classmate${fb.reviewerCount === 1 ? "" : "s"}.`}
                  {!fb.teacherSet && fb.reviewPoints > 0 &&
                    ` Includes ${fb.reviewCredit} of ${fb.reviewPoints} mark${fb.reviewPoints === 1 ? "" : "s"} for completing your own reviews.`}
                </p>
              </>
            ) : (
              <p className="mt-4 text-sm" style={{ color: theme.muted }}>Your mark has not been released.</p>
            )}
            <button onClick={() => window.print()} className="no-print mt-4 rounded-lg px-5 py-2.5 font-semibold" style={accentBtn}>
              Print / save your feedback
            </button>
          </div>

          {fb?.questions.map((f, i) => {
            const qn = byId.get(f.questionId);
            if (!qn) return null;
            return (
              <div key={f.questionId} className="rounded-2xl border p-5 shadow-sm print-page" style={cardStyle}>
                <p className="text-xs font-semibold" style={{ color: theme.muted }}>
                  Question {i + 1} of {fb.questions.length}
                </p>
                {qn.passage && (
                  <p className="mt-2 whitespace-pre-wrap rounded-lg border p-3 text-sm" style={{ borderColor: theme.border, color: theme.muted }}>
                    {qn.passage}
                  </p>
                )}
                <p className="mt-2 font-medium">{qn.text}</p>

                <p className="mt-4 text-xs font-semibold" style={{ color: theme.muted }}>Your response</p>
                <div className="mt-1 whitespace-pre-wrap rounded-lg border p-3 text-sm" style={{ borderColor: theme.border }}>
                  {f.answer.trim() || <span style={{ color: theme.muted }}>You left this blank.</span>}
                </div>

                <p className="mt-4 text-xs font-semibold" style={{ color: theme.muted }}>
                  {f.comments.length === 1 ? "Your reviewer’s comment" : "Your reviewers’ comments"}
                </p>
                {f.comments.length ? (
                  <ul className="mt-1 space-y-2 text-sm">
                    {f.comments.map((c, ci) => (
                      <li key={ci} className="whitespace-pre-wrap rounded-lg border p-3" style={{ borderColor: theme.border, background: theme.accentSoft }}>
                        {c}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm" style={{ color: theme.muted }}>Nobody left a comment on this one.</p>
                )}

                <p className="mt-4 text-xs font-semibold" style={{ color: theme.muted }}>Score breakdown</p>
                <div className="mt-1 rounded-lg border" style={{ borderColor: theme.border }}>
                  {f.criteria.map((c) => (
                    <div key={c.id} className="flex items-baseline justify-between border-b px-3 py-2 text-sm last:border-b-0" style={{ borderColor: theme.border }}>
                      <span>{c.label}</span>
                      <span className="font-semibold">
                        {c.average === null ? "—" : c.average} <span className="font-normal" style={{ color: theme.muted }}>/ {c.max}</span>
                      </span>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between px-3 py-2 text-sm font-semibold" style={{ background: theme.accentSoft }}>
                    <span>This question</span>
                    <span>
                      {f.subtotal === null ? "—" : f.subtotal} <span className="font-normal" style={{ color: theme.muted }}>/ {f.subtotalMax}</span>
                    </span>
                  </div>
                </div>
                {fb.reviewerCount > 1 && (
                  <p className="mt-1.5 text-xs" style={{ color: theme.muted }}>
                    Averaged across your {fb.reviewerCount} reviewers.
                  </p>
                )}
              </div>
            );
          })}

          {breakdownDiffers && (
            <p className="text-xs" style={{ color: theme.muted }}>
              Your final mark is the middle reviewer’s total rather than an average, so it may not match the sum of the
              figures above.
            </p>
          )}

          <div className="no-print rounded-2xl border p-5 text-center shadow-sm" style={cardStyle}>
            <p className="text-sm" style={{ color: theme.muted }}>Keep a copy of this feedback for your records.</p>
            <button onClick={() => window.print()} className="mt-3 rounded-lg px-6 py-2.5 font-semibold" style={accentBtn}>
              Print / save your feedback
            </button>
          </div>
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
        {session.tasks.length === 0 && session.questions.length > 0 && (
          <div className="rounded-2xl border p-6 text-center shadow-sm" style={cardStyle}>
            <p className="font-semibold">Nothing to review yet</p>
            <p className="mt-1 text-sm" style={{ color: theme.muted }}>
              Your teacher has not assigned you any responses. Check back shortly.
            </p>
          </div>
        )}

        {/* Peers mark written work; a quiz of nothing but choice questions is marked by the app itself. */}
        {session.questions.length === 0 && (
          <div className="rounded-2xl border p-6 text-center shadow-sm" style={cardStyle}>
            <p className="font-semibold">Nothing here for you to mark</p>
            <p className="mt-1 text-sm" style={{ color: theme.muted }}>
              This quiz has no written answers — every question is multiple choice, and those are marked automatically.
            </p>
          </div>
        )}

        {session.tasks.length > 0 && session.questions.length > 0 && (
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

        {/*
          Their marking is done, so the only thing left is their own result — and
          that waits on the teacher, not on their reviewers. A button to ask again
          beats telling a student to reload a page they are already sitting on.
        */}
        {allDone && session.tasks.length > 0 && session.questions.length > 0 && (
          <div className="rounded-2xl border-2 p-5" style={{ borderColor: theme.accent, background: theme.accentSoft }}>
            <h2 className="font-bold">All your reviews are in — thank you</h2>
            <p className="mt-1 text-sm" style={{ color: theme.muted }}>
              Waiting for your teacher to release results. You can still revise any of your reviews below until then.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={checkResults}
                disabled={checking}
                className="rounded-lg px-5 py-2.5 font-semibold disabled:opacity-50"
                style={accentBtn}
              >
                {checking ? "Checking…" : "Check if my results are ready"}
              </button>
              {!!checkedAt && !checking && (
                <span className="text-sm" style={{ color: theme.muted }}>Not released yet — try again later.</span>
              )}
            </div>
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

        {task && session.questions.length > 0 && (
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
