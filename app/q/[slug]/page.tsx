"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getTheme } from "@/lib/themes";
import { hashSeed, seededShuffle } from "@/lib/normalize";
import type { ReviewPayload } from "@/lib/types";
import Media from "@/components/Media";

interface PublicOption { key: string; text: string }
interface PublicQuestion {
  id: string;
  type: "mcq" | "short" | "essay";
  text: string;
  passage?: string;
  media?: string;
  points: number;
  options: PublicOption[];
}
interface PublicQuiz {
  title: string;
  description?: string;
  introMedia?: string;
  theme: string;
  settings: {
    timerMode: "none" | "quiz" | "question";
    maxMinutes?: number;
    perQuestionSeconds?: number;
    closesAt?: string;
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    allowMultiple: boolean;
  };
  questionCount: number;
  totalPoints: number;
  closed: boolean;
  questions: PublicQuestion[];
}

interface ActiveAttempt {
  attemptId: string;
  deadlineAt?: number;
  index: number;
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function StudentQuizPage() {
  const { slug } = useParams<{ slug: string }>();
  const [quiz, setQuiz] = useState<PublicQuiz | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [phase, setPhase] = useState<"loading" | "intro" | "taking" | "review">("loading");

  const [name, setName] = useState("");
  const [roll, setRoll] = useState("");
  const [semester, setSemester] = useState("");
  const [startError, setStartError] = useState("");
  const [starting, setStarting] = useState(false);

  const [attempt, setAttempt] = useState<ActiveAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0); // per-question mode
  const [now, setNow] = useState(Date.now());
  const [qDeadline, setQDeadline] = useState<number | null>(null); // per-question deadline
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [review, setReview] = useState<ReviewPayload | null>(null);

  const submittingRef = useRef(false);

  const activeKey = `qd-active-${slug}`;
  const reviewKey = `qd-review-${slug}`;
  const ansKey = attempt ? `qd-ans-${attempt.attemptId}` : "";

  // ------- load quiz + restore state -------
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/public/${slug}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const data: PublicQuiz = await res.json();
      setQuiz(data);

      const savedReview = localStorage.getItem(reviewKey);
      if (savedReview) {
        try {
          setReview(JSON.parse(savedReview));
          setPhase("review");
          return;
        } catch {}
      }
      const savedActive = localStorage.getItem(activeKey);
      if (savedActive && !data.closed) {
        try {
          const active: ActiveAttempt = JSON.parse(savedActive);
          const savedAns = localStorage.getItem(`qd-ans-${active.attemptId}`);
          setAttempt(active);
          setIndex(active.index ?? 0);
          if (savedAns) setAnswers(JSON.parse(savedAns));
          setPhase("taking");
          return;
        } catch {}
      }
      setPhase("intro");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // ------- clock tick -------
  useEffect(() => {
    if (phase !== "taking") return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [phase]);

  // ------- autosave -------
  useEffect(() => {
    if (phase === "taking" && ansKey) localStorage.setItem(ansKey, JSON.stringify(answers));
  }, [answers, ansKey, phase]);

  useEffect(() => {
    if (phase === "taking" && attempt) localStorage.setItem(activeKey, JSON.stringify({ ...attempt, index }));
  }, [attempt, index, phase, activeKey]);

  const theme = getTheme(quiz?.theme ?? "slate");
  const perQuestionMode = quiz?.settings.timerMode === "question" && !!quiz.settings.perQuestionSeconds;

  const ordered = useMemo(() => {
    if (!quiz || !attempt) return quiz?.questions ?? [];
    const seed = hashSeed(attempt.attemptId);
    let qs = quiz.questions;
    if (quiz.settings.shuffleQuestions) qs = seededShuffle(qs, seed);
    if (quiz.settings.shuffleOptions) {
      qs = qs.map((qn, i) => ({ ...qn, options: seededShuffle(qn.options, seed + i + 1) }));
    }
    return qs;
  }, [quiz, attempt]);

  // ------- per-question timer -------
  useEffect(() => {
    if (phase === "taking" && perQuestionMode && quiz?.settings.perQuestionSeconds) {
      setQDeadline(Date.now() + quiz.settings.perQuestionSeconds * 1000);
    }
  }, [phase, index, perQuestionMode, quiz?.settings.perQuestionSeconds]);

  const submit = useCallback(async () => {
    if (submittingRef.current || !attempt) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      const saved = localStorage.getItem(`qd-ans-${attempt.attemptId}`);
      const finalAnswers = saved ? JSON.parse(saved) : answers;
      const res = await fetch("/api/attempts/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: attempt.attemptId, answers: finalAnswers }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Submit failed (${res.status})`);
      }
      const data: ReviewPayload = await res.json();
      localStorage.setItem(reviewKey, JSON.stringify(data));
      localStorage.removeItem(activeKey);
      localStorage.removeItem(`qd-ans-${attempt.attemptId}`);
      setReview(data);
      setPhase("review");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit — check your connection and try again.");
      submittingRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [attempt, answers, activeKey, reviewKey]);

  // ------- deadline auto-submit / per-question auto-advance -------
  useEffect(() => {
    if (phase !== "taking") return;
    if (attempt?.deadlineAt && now >= attempt.deadlineAt) {
      submit();
      return;
    }
    if (perQuestionMode && qDeadline && now >= qDeadline) {
      if (index < ordered.length - 1) setIndex((i) => i + 1);
      else submit();
    }
  }, [now, phase, attempt, qDeadline, perQuestionMode, index, ordered.length, submit]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!quiz) return;
    setStarting(true);
    setStartError("");
    const res = await fetch("/api/attempts/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, name, roll, semester: Number(semester) }),
    });
    setStarting(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStartError(data.error ?? "Could not start the quiz.");
      return;
    }
    // Trust our own clock for the countdown but keep the server's duration.
    const duration = data.deadlineAt ? data.deadlineAt - data.serverNow : undefined;
    const active: ActiveAttempt = {
      attemptId: data.attemptId,
      deadlineAt: duration ? Date.now() + duration : undefined,
      index: 0,
    };
    setAttempt(active);
    setAnswers({});
    setIndex(0);
    localStorage.setItem(activeKey, JSON.stringify(active));
    setPhase("taking");
  }

  // ================= render =================

  if (notFound) {
    return (
      <main className="max-w-lg mx-auto px-6 py-24 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Quiz not found</h1>
        <p className="mt-2 text-slate-500">Check the link with your teacher.</p>
      </main>
    );
  }
  if (!quiz || phase === "loading") {
    return <main className="max-w-lg mx-auto px-6 py-24 text-center text-slate-500">Loading…</main>;
  }

  const pageStyle = { background: theme.bg, color: theme.text, minHeight: "100%" };
  const cardStyle = { background: theme.card, borderColor: theme.border };
  const accentBtn = { background: theme.accent, color: theme.accentText };

  // ------- review -------
  if (phase === "review" && review) {
    const pct = review.max ? Math.round((review.score / review.max) * 100) : 0;
    return (
      <div style={pageStyle} className="py-10 px-4 flex-1">
        <main className="max-w-2xl mx-auto">
          <div className="rounded-2xl border p-6 text-center shadow-sm print-page" style={cardStyle}>
            <p className="text-sm font-medium" style={{ color: theme.muted }}>{review.quizTitle}</p>
            <h1 className="mt-1 text-xl font-bold">{review.student.name} · {review.student.rollNorm} · Sem {review.student.semester}</h1>
            <p className="mt-4 text-5xl font-bold" style={{ color: theme.accent }}>
              {review.score}<span className="text-2xl font-semibold" style={{ color: theme.muted }}> / {review.max}</span>
            </p>
            <p className="mt-1 text-sm" style={{ color: theme.muted }}>
              {pct}%{review.pending > 0 && ` · ${review.pending} answer${review.pending === 1 ? "" : "s"} awaiting teacher review`}
              {review.flags.late && " · submitted late"}
            </p>
            <p className="mt-1 text-xs" style={{ color: theme.muted }}>Submitted {new Date(review.submittedAt).toLocaleString()}</p>
            <button onClick={() => window.print()} className="no-print mt-4 rounded-lg px-5 py-2.5 font-semibold" style={accentBtn}>
              Print / save your copy
            </button>
          </div>

          <div className="mt-6 space-y-4">
            {review.questions.map((qn, i) => {
              const per = review.per.find((p) => p.qid === qn.id);
              const chosen = qn.options.find((o) => o.key === per?.answer);
              const correctOpt = qn.options.find((o) => o.key === qn.correct);
              return (
                <div key={qn.id} className="rounded-2xl border p-5 shadow-sm print-page" style={cardStyle}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-semibold" style={{ color: theme.muted }}>Q{i + 1} · {qn.points} pt</p>
                    {qn.type === "mcq" ? (
                      <span className={`text-xs font-bold rounded-full px-2.5 py-1 ${per?.correct ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>
                        {per?.answer ? (per.correct ? `Correct +${per.awarded}` : "Incorrect") : "Not answered"}
                      </span>
                    ) : (
                      <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-amber-100 text-amber-800">Awaiting review</span>
                    )}
                  </div>
                  {qn.passage && <p className="mt-2 text-sm rounded-lg border p-3" style={{ borderColor: theme.border, color: theme.muted }}>{qn.passage}</p>}
                  <p className="mt-2 font-medium">{qn.text}</p>
                  <Media url={qn.media} compact />

                  {qn.type === "mcq" ? (
                    <div className="mt-3 space-y-1.5 text-sm">
                      {qn.options.map((o) => {
                        const isChosen = o.key === per?.answer;
                        const isCorrect = o.key === qn.correct;
                        return (
                          <div
                            key={o.key}
                            className={`rounded-lg border px-3 py-2 ${isCorrect ? "border-green-400 bg-green-50 text-green-900" : isChosen ? "border-red-300 bg-red-50 text-red-900" : ""}`}
                            style={isCorrect || isChosen ? undefined : { borderColor: theme.border }}
                          >
                            <span className="font-semibold">{o.key}.</span> {o.text}
                            {isCorrect && <span className="ml-1.5 text-xs font-semibold">✓ correct answer</span>}
                            {isChosen && !isCorrect && <span className="ml-1.5 text-xs font-semibold">your choice</span>}
                            {isChosen && isCorrect && <span className="ml-1.5 text-xs font-semibold">(your choice)</span>}
                          </div>
                        );
                      })}
                      {(chosen?.feedback || correctOpt?.feedback || qn.feedbackCorrect || qn.feedbackIncorrect) && (
                        <div className="mt-2 rounded-lg p-3 text-sm" style={{ background: theme.accentSoft }}>
                          {chosen?.feedback && (
                            <p><span className="font-semibold">Your answer ({chosen.key}):</span> {chosen.feedback}</p>
                          )}
                          {!per?.correct && correctOpt?.feedback && correctOpt.key !== chosen?.key && (
                            <p className="mt-1"><span className="font-semibold">Why {correctOpt.key} is right:</span> {correctOpt.feedback}</p>
                          )}
                          {per?.correct && qn.feedbackCorrect && <p className="mt-1">{qn.feedbackCorrect}</p>}
                          {!per?.correct && qn.feedbackIncorrect && <p className="mt-1">{qn.feedbackIncorrect}</p>}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 text-sm space-y-2">
                      <div className="rounded-lg border px-3 py-2 whitespace-pre-wrap" style={{ borderColor: theme.border }}>
                        {per?.answer || <span style={{ color: theme.muted }}>No answer given.</span>}
                      </div>
                      {qn.feedbackCorrect && (
                        <div className="rounded-lg p-3" style={{ background: theme.accentSoft }}>
                          <span className="font-semibold">Guidance: </span>{qn.feedbackCorrect}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </main>
      </div>
    );
  }

  // ------- intro -------
  if (phase === "intro") {
    const s = quiz.settings;
    return (
      <div style={pageStyle} className="py-10 px-4 flex-1">
        <main className="max-w-xl mx-auto">
          <div className="rounded-2xl border p-6 shadow-sm" style={cardStyle}>
            <h1 className="text-2xl font-bold">{quiz.title}</h1>
            {quiz.description && <p className="mt-2 text-sm whitespace-pre-wrap" style={{ color: theme.muted }}>{quiz.description}</p>}
            <Media url={quiz.introMedia} />
            <ul className="mt-4 text-sm space-y-1" style={{ color: theme.muted }}>
              <li>• {quiz.questionCount} questions · {quiz.totalPoints} points</li>
              {s.timerMode === "quiz" && s.maxMinutes && <li>• Time limit: {s.maxMinutes} minutes from when you start</li>}
              {s.timerMode === "question" && s.perQuestionSeconds && (
                <li>• {s.perQuestionSeconds} seconds per question, one at a time — you cannot go back</li>
              )}
              {s.closesAt && <li>• Closes {new Date(s.closesAt).toLocaleString()}</li>}
              <li>• Your score and feedback appear immediately after you submit</li>
            </ul>

            {quiz.closed ? (
              <p className="mt-6 rounded-lg bg-slate-100 text-slate-600 p-4 text-sm font-medium">
                This quiz is not accepting responses right now.
              </p>
            ) : (
              <form onSubmit={start} className="mt-6 space-y-3">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  required
                  className="w-full rounded-lg border px-4 py-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2"
                  style={{ borderColor: theme.border }}
                />
                <div className="flex gap-3">
                  <input
                    value={roll}
                    onChange={(e) => setRoll(e.target.value)}
                    placeholder="Class roll number"
                    required
                    className="flex-1 rounded-lg border px-4 py-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2"
                    style={{ borderColor: theme.border }}
                  />
                  <select
                    value={semester}
                    onChange={(e) => setSemester(e.target.value)}
                    required
                    className="rounded-lg border px-3 py-2.5 bg-white text-slate-900"
                    style={{ borderColor: theme.border }}
                  >
                    <option value="">Semester</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>Sem {n}</option>
                    ))}
                  </select>
                </div>
                {startError && <p className="text-sm text-red-600">{startError}</p>}
                <button type="submit" disabled={starting} className="w-full rounded-lg py-3 font-semibold disabled:opacity-50" style={accentBtn}>
                  {starting ? "Starting…" : "Start quiz"}
                </button>
              </form>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ------- taking -------
  const answered = ordered.filter((qn) => (answers[qn.id] ?? "").trim() !== "").length;
  const overallRemaining = attempt?.deadlineAt ? attempt.deadlineAt - now : null;

  const renderQuestion = (qn: PublicQuestion, i: number) => (
    <div key={qn.id} className="rounded-2xl border p-5 shadow-sm" style={cardStyle}>
      <p className="text-xs font-semibold" style={{ color: theme.muted }}>
        Question {i + 1} of {ordered.length} · {qn.points} pt
      </p>
      {qn.passage && <p className="mt-2 text-sm rounded-lg border p-3 whitespace-pre-wrap" style={{ borderColor: theme.border, color: theme.muted }}>{qn.passage}</p>}
      <p className="mt-2 font-medium text-lg">{qn.text}</p>
      <Media url={qn.media} />
      {qn.type === "mcq" ? (
        <div className="mt-3 space-y-2">
          {qn.options.map((o) => {
            const selected = answers[qn.id] === o.key;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => setAnswers((a) => ({ ...a, [qn.id]: selected ? "" : o.key }))}
                className="w-full text-left rounded-xl border-2 px-4 py-3 text-sm font-medium transition"
                style={selected ? { borderColor: theme.accent, background: theme.accentSoft } : { borderColor: theme.border, background: theme.card }}
              >
                <span className="font-bold mr-1.5">{o.key}.</span> {o.text}
              </button>
            );
          })}
        </div>
      ) : (
        <textarea
          value={answers[qn.id] ?? ""}
          onChange={(e) => setAnswers((a) => ({ ...a, [qn.id]: e.target.value }))}
          rows={qn.type === "essay" ? 8 : 4}
          placeholder="Type your answer…"
          className="mt-3 w-full rounded-xl border-2 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none"
          style={{ borderColor: theme.border }}
        />
      )}
    </div>
  );

  return (
    <div style={pageStyle} className="pb-12 flex-1">
      <div className="sticky top-0 z-10 border-b backdrop-blur px-4 py-3" style={{ background: `${theme.card}ee`, borderColor: theme.border }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3 text-sm">
          <p className="font-semibold truncate">{quiz.title}</p>
          <div className="flex items-center gap-3 shrink-0">
            <span style={{ color: theme.muted }}>{answered}/{ordered.length} answered</span>
            {perQuestionMode && qDeadline && (
              <span className={`font-mono font-bold ${qDeadline - now < 10_000 ? "text-red-600" : ""}`}>{fmtClock(qDeadline - now)}</span>
            )}
            {!perQuestionMode && overallRemaining !== null && (
              <span className={`font-mono font-bold ${overallRemaining < 60_000 ? "text-red-600" : ""}`}>{fmtClock(overallRemaining)}</span>
            )}
          </div>
        </div>
      </div>

      <main className="max-w-2xl mx-auto px-4 mt-6 space-y-5">
        {perQuestionMode ? (
          <>
            {renderQuestion(ordered[index], index)}
            <div className="flex justify-end">
              <button
                onClick={() => (index < ordered.length - 1 ? setIndex((i) => i + 1) : submit())}
                disabled={submitting}
                className="rounded-lg px-6 py-3 font-semibold disabled:opacity-50"
                style={accentBtn}
              >
                {index < ordered.length - 1 ? "Next →" : submitting ? "Submitting…" : "Submit quiz"}
              </button>
            </div>
          </>
        ) : (
          <>
            {ordered.map((qn, i) => renderQuestion(qn, i))}
            <div className="rounded-2xl border p-5 shadow-sm text-center" style={cardStyle}>
              <p className="text-sm" style={{ color: theme.muted }}>
                {answered < ordered.length
                  ? `${ordered.length - answered} question${ordered.length - answered === 1 ? "" : "s"} unanswered.`
                  : "All questions answered."}
              </p>
              <button onClick={submit} disabled={submitting} className="mt-3 rounded-lg px-8 py-3 font-semibold disabled:opacity-50" style={accentBtn}>
                {submitting ? "Submitting…" : "Submit quiz"}
              </button>
            </div>
          </>
        )}
        {submitError && <p className="text-sm text-red-600 text-center">{submitError}</p>}
        <p className="text-xs text-center" style={{ color: theme.muted }}>
          Your answers are saved on this device as you go — if the page reloads, you can continue.
        </p>
      </main>
    </div>
  );
}
