/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getTheme } from "@/lib/themes";
import { hashSeed, NO_SEMESTER, SEMESTER_CHOICES, seededShuffle, semesterLabel } from "@/lib/normalize";
import { correctKeysOf, groupByPassage, joinKeys, shuffleWithinPassageGroups, splitKeys } from "@/lib/questions";
import type { ReviewPayload } from "@/lib/types";
import {
  emptyProgress,
  examKey,
  LEGEND_ORDER,
  parseProgress,
  serializeProgress,
  STATUS_STYLES,
  type ExamProgress,
} from "@/lib/examstate";
import { TelemetryCollector } from "@/lib/telemetry";
import Material from "@/components/Material";
import Media from "@/components/Media";
import ExamShell from "@/components/ExamShell";
import WrittenAnswer from "@/components/WrittenAnswer";

interface PublicOption { key: string; text: string }
interface PublicQuestion {
  id: string;
  type: "mcq" | "multi" | "short" | "essay";
  text: string;
  passage?: string;
  passageTitle?: string;
  media?: string;
  points: number;
  graded: boolean;
  wordLimit?: number;
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
    examMode?: boolean;
    mstMode?: boolean;
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    allowMultiple: boolean;
    groupMode?: boolean;
    groupMin?: number;
    groupMax?: number;
    multiScoring?: "exact" | "partial";
    pasteGuard?: boolean;
    hardWordLimit?: boolean;
  };
  questionCount: number;
  totalPoints?: number;
  mst?: { stages: number; perStage: number };
  survey: boolean;
  peerReview: boolean;
  /** Marked by the teacher against a rubric and released; nothing scored on submit. */
  rubricMode: boolean;
  phase: "responding" | "reviewing" | "closed";
  closed: boolean;
  questions: PublicQuestion[];
}

interface ActiveAttempt {
  attemptId: string;
  deadlineAt?: number;
  index: number;
  /** Shown in the exam header, which outlives the intro form a reload discards. */
  candidate?: string;
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function StudentQuizPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [quiz, setQuiz] = useState<PublicQuiz | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [phase, setPhase] = useState<"loading" | "intro" | "taking" | "review">("loading");

  const [name, setName] = useState("");
  const [roll, setRoll] = useState("");
  const [semester, setSemester] = useState("");
  const [groupName, setGroupName] = useState("");
  const [members, setMembers] = useState<{ name: string; roll: string }[]>([]);
  const [startError, setStartError] = useState("");
  const [starting, setStarting] = useState(false);

  const [attempt, setAttempt] = useState<ActiveAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // Exam mode only: which questions have been landed on and which flagged.
  const [progress, setProgress] = useState<ExamProgress>(emptyProgress);
  const [index, setIndex] = useState(0); // per-question mode
  const [now, setNow] = useState(Date.now());
  const [qDeadline, setQDeadline] = useState<number | null>(null); // per-question deadline
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [review, setReview] = useState<ReviewPayload | null>(null);
  // Adaptive papers arrive one stage at a time from the server; the bank never
  // reaches the browser. See lib/mst.ts.
  const [stageQuestions, setStageQuestions] = useState<PublicQuestion[] | null>(null);
  const [stageNumber, setStageNumber] = useState(0);
  const [totalStages, setTotalStages] = useState(0);
  const [rechecking, setRechecking] = useState(false);
  const [recheckedAt, setRecheckedAt] = useState(0);

  const submittingRef = useRef(false);
  /**
   * How the written answers were typed — counts only, never content. Held in a
   * ref because it is written on every keystroke and must never cause a render.
   * Students are told about it on the intro screen before they start.
   */
  const telemetryRef = useRef<TelemetryCollector | null>(null);
  if (!telemetryRef.current) telemetryRef.current = new TelemetryCollector();

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
      if (data.settings.groupMode) {
        const n = data.settings.groupMin ?? 1;
        setMembers(Array.from({ length: n }, () => ({ name: "", roll: "" })));
      }

      const savedReview = localStorage.getItem(reviewKey);
      if (savedReview) {
        try {
          const parsed = JSON.parse(savedReview);
          // Their part is done and the marking round is on — reloading this link
          // should land them in front of their classmates' work, not their own.
          if (data.peerReview && data.phase === "reviewing") {
            router.replace(`/q/${slug}/review`);
            return;
          }
          setReview(parsed);
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
          setProgress(parseProgress(localStorage.getItem(examKey(active.attemptId))));
          // The stage a reload landed in comes back from the server rather than
          // from storage, so a cleared browser does not end the attempt.
          if (data.settings.mstMode) {
            const stage = await fetch(`/api/attempts/stage?attemptId=${encodeURIComponent(active.attemptId)}`, {
              cache: "no-store",
            });
            if (stage.ok) {
              const s = await stage.json();
              if (s.done) {
                setPhase("intro");
                localStorage.removeItem(activeKey);
                return;
              }
              setStageQuestions(s.questions ?? []);
              setStageNumber(s.stage ?? 0);
              setTotalStages(s.totalStages ?? 0);
            }
          }
          setPhase("taking");
          return;
        } catch {}
      }
      setPhase("intro");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  /**
   * Re-read the quiz so a student sitting on their result page can find out that
   * peer review has opened without hunting for the link again. The page is a
   * client component that only loads once, so without this they would have to
   * know to reload — and a reload lands them right back on the same screen.
   */
  const recheckPhase = useCallback(
    async (quiet = false) => {
      if (!quiet) setRechecking(true);
      const res = await fetch(`/api/public/${slug}`, { cache: "no-store" });
      if (!quiet) {
        setRechecking(false);
        setRecheckedAt(Date.now());
      }
      if (!res.ok) return;
      const data: PublicQuiz = await res.json();
      // The round is on — straight through, same as a reload would go.
      if (data.peerReview && data.phase === "reviewing") {
        router.replace(`/q/${slug}/review`);
        return;
      }
      setQuiz(data);
    },
    [slug, router]
  );

  // A student left waiting on their result page is carried into the review round
  // the moment the teacher opens it — no reload, no button, nothing to know.
  useEffect(() => {
    if (phase !== "review" || quiz?.phase === "closed") return;
    if (!quiz?.peerReview && !quiz?.rubricMode) return;
    if (quiz.peerReview && quiz.phase !== "responding") return;
    const t = setInterval(() => recheckPhase(true), 15000);
    return () => clearInterval(t);
  }, [phase, quiz?.peerReview, quiz?.rubricMode, quiz?.phase, recheckPhase]);

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

  // One key holds both sets, so a reload can never restore the flags without the
  // visits that go with them.
  useEffect(() => {
    if (phase === "taking" && attempt) localStorage.setItem(examKey(attempt.attemptId), serializeProgress(progress));
  }, [progress, attempt, phase]);

  const theme = getTheme(quiz?.theme ?? "slate");
  const examMode = !!quiz?.settings.examMode;
  // The per-question timer forbids going back, which is exactly what the exam
  // palette is for; the two never travel together (enforced when the quiz is saved).
  const perQuestionMode =
    !examMode && quiz?.settings.timerMode === "question" && !!quiz.settings.perQuestionSeconds;

  const mstMode = !!quiz?.settings.mstMode;

  const ordered = useMemo(() => {
    if (!quiz || !attempt) return quiz?.questions ?? [];
    const seed = hashSeed(attempt.attemptId);
    // The server has already chosen this stage and its order; reshuffling here
    // would undo the routing that put these questions in front of this student.
    let qs = mstMode ? (stageQuestions ?? []) : quiz.questions;
    if (!mstMode && quiz.settings.shuffleQuestions) qs = shuffleWithinPassageGroups(qs, seed);
    if (quiz.settings.shuffleOptions) {
      qs = qs.map((qn, i) => ({ ...qn, options: seededShuffle(qn.options, seed + i + 1) }));
    }
    return qs;
  }, [quiz, attempt, mstMode, stageQuestions]);

  // Landing on a question is what turns its palette tile from grey to red — the
  // student has now seen it and chosen to leave it, which is different from
  // never having reached it at all.
  const currentQid = examMode ? ordered[index]?.id : undefined;
  useEffect(() => {
    if (phase !== "taking" || !currentQid) return;
    setProgress((p) => (p.visited.has(currentQid) ? p : { ...p, visited: new Set(p.visited).add(currentQid) }));
  }, [currentQid, phase]);

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
      const lengths: Record<string, number> = {};
      for (const [qid, text] of Object.entries(finalAnswers as Record<string, string>)) {
        lengths[qid] = String(text ?? "").length;
      }
      const res = await fetch("/api/attempts/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptId: attempt.attemptId,
          answers: finalAnswers,
          telemetry: telemetryRef.current?.snapshot(lengths),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Submit failed (${res.status})`);
      }
      const data: ReviewPayload = await res.json();
      localStorage.setItem(reviewKey, JSON.stringify(data));
      localStorage.removeItem(activeKey);
      localStorage.removeItem(`qd-ans-${attempt.attemptId}`);
      localStorage.removeItem(examKey(attempt.attemptId));
      setReview(data);
      setPhase("review");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit — check your connection and try again.");
      submittingRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [attempt, answers, activeKey, reviewKey]);

  /**
   * Close the stage on screen. The server marks it, decides where the student
   * goes next and hands back that stage; when the paper is spent it says so and
   * the ordinary submit takes over. The answers to a closed stage stay in the
   * record but can no longer be changed, which is the one-way boundary the
   * whole design turns on.
   */
  const nextStage = useCallback(async () => {
    if (!attempt || submittingRef.current) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const stageAnswers: Record<string, string> = {};
      for (const qn of ordered) {
        if (answers[qn.id] !== undefined) stageAnswers[qn.id] = answers[qn.id];
      }
      const res = await fetch("/api/attempts/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: attempt.attemptId, answers: stageAnswers }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Could not save this section (${res.status})`);
      if (data.done) {
        setSubmitting(false);
        await submit();
        return;
      }
      setStageQuestions(data.questions ?? []);
      setStageNumber(data.stage ?? 0);
      setTotalStages(data.totalStages ?? totalStages);
      // A new stage is a fresh palette: nothing in it has been visited or flagged.
      setProgress(emptyProgress());
      setIndex(0);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not save this section — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }, [attempt, answers, ordered, totalStages, submit]);

  /** What the Submit button does: move on a stage, or finish the paper. */
  const finishOrAdvance = useCallback(() => {
    if (mstMode) return nextStage();
    return submit();
  }, [mstMode, nextStage, submit]);

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
    const payload = quiz.settings.groupMode
      ? { slug, group: { name: groupName, semester, members } }
      : { slug, name, roll, semester };
    const res = await fetch("/api/attempts/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
      candidate: quiz.settings.groupMode ? groupName.trim() : name.trim(),
    };
    setAttempt(active);
    setAnswers({});
    setProgress(emptyProgress());
    setIndex(0);
    if (data.mst) {
      setStageQuestions(data.mst.questions ?? []);
      setStageNumber(data.mst.stage ?? 0);
      setTotalStages(data.mst.totalStages ?? 0);
    }
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
            {review.group ? (
              <>
                <h1 className="mt-1 text-xl font-bold">{review.group.name} · {semesterLabel(review.group.semester)}</h1>
                <p className="mt-1 text-sm" style={{ color: theme.muted }}>
                  {review.group.members.map((m) => `${m.name} (${m.roll})`).join(" · ")}
                </p>
              </>
            ) : (
              <h1 className="mt-1 text-xl font-bold">{review.student.name} · {review.student.rollNorm} · {semesterLabel(review.student.semester)}</h1>
            )}
            {review.survey ? (
              <>
                <p className="mt-4 text-3xl font-bold" style={{ color: theme.accent }}>Response recorded</p>
                <p className="mt-1 text-sm" style={{ color: theme.muted }}>
                  {review.peerReview
                    ? "Thank you — your classmates will mark this. Use the button below when your teacher opens the peer-review round; if you stay on this page, you will be taken through automatically."
                    : review.rubricMode
                      ? "Thank you — your written answers will be marked against your teacher's rubric. Your marks and feedback appear here once they release them."
                      : "Thank you — this one is not scored, so there is nothing to mark."}
                  {review.flags.late && " Submitted late."}
                </p>
              </>
            ) : (
              <>
                <p className="mt-4 text-5xl font-bold" style={{ color: theme.accent }}>
                  {review.score}<span className="text-2xl font-semibold" style={{ color: theme.muted }}> / {review.max}</span>
                </p>
                <p className="mt-1 text-sm" style={{ color: theme.muted }}>
                  {pct}%{review.pending > 0 && ` · ${review.pending} answer${review.pending === 1 ? "" : "s"} awaiting teacher review`}
                  {review.flags.late && " · submitted late"}
                </p>
                {review.ability && (
                  <p className="mt-2 text-sm" style={{ color: theme.muted }}>
                    Ability estimate{" "}
                    <span className="font-bold" style={{ color: theme.accent }}>{review.ability.scaled}</span>
                    /100
                    {review.ability.extreme
                      ? " — every answer went one way, so this is the edge of what these questions can measure rather than a precise figure."
                      : review.ability.se >= 0.6
                        ? " — from a short paper, so read it loosely."
                        : ""}
                    <span className="mt-1 block text-xs">
                      This places you on the difficulty scale itself, so it does not reward an easier paper.
                    </span>
                  </p>
                )}
              </>
            )}
            <p className="mt-1 text-xs" style={{ color: theme.muted }}>Submitted {new Date(review.submittedAt).toLocaleString()}</p>
            <button onClick={() => window.print()} className="no-print mt-4 rounded-lg px-5 py-2.5 font-semibold" style={accentBtn}>
              Print / save your copy
            </button>
          </div>

          {/*
            The way back into peer review. A student who has submitted always lands
            here on every later visit, so this card — not the intro screen — is the
            only place they can be told that reviewing has opened.
          */}
          {quiz.rubricMode && (
            <div className="no-print mt-6 rounded-2xl border-2 p-5" style={{ borderColor: theme.accent, background: theme.accentSoft }}>
              <h2 className="font-bold">
                {quiz.phase === "closed" ? "Your marked result is ready" : "Marking is under way"}
              </h2>
              <p className="mt-1 text-sm" style={{ color: theme.muted }}>
                {quiz.phase === "closed"
                  ? "Your marks, the rubric band by band, and your teacher's written feedback."
                  : "Your teacher is marking the written answers. Check back once they tell you the results are out."}
              </p>
              {quiz.phase === "closed" ? (
                <a href={`/q/${slug}/result`} className="mt-3 inline-block rounded-lg px-6 py-3 font-semibold" style={accentBtn}>
                  See my marks and feedback →
                </a>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => recheckPhase()}
                    disabled={rechecking}
                    className="rounded-lg px-5 py-2.5 font-semibold disabled:opacity-50"
                    style={accentBtn}
                  >
                    {rechecking ? "Checking…" : "Check if my result is ready"}
                  </button>
                  {!!recheckedAt && !rechecking && (
                    <span className="text-sm" style={{ color: theme.muted }}>Not released yet — try again later.</span>
                  )}
                </div>
              )}
            </div>
          )}

          {quiz.peerReview && (
            <div className="no-print mt-6 rounded-2xl border-2 p-5" style={{ borderColor: theme.accent, background: theme.accentSoft }}>
              <h2 className="font-bold">
                {quiz.phase === "reviewing"
                  ? "Your turn to mark your classmates"
                  : quiz.phase === "closed"
                    ? "Peer review is complete"
                    : "Peer review has not opened yet"}
              </h2>
              <p className="mt-1 text-sm" style={{ color: theme.muted }}>
                {quiz.phase === "reviewing"
                  ? "A few classmates' answers are waiting for you. You will not be told whose work it is, and they will never be told who marked theirs."
                  : quiz.phase === "closed"
                    ? "Your mark and the comments your classmates left on your work are ready."
                    : "Your teacher has not opened the round yet. Stay on this page and you will be taken through the moment it opens, or tap the button below once they announce it."}
              </p>
              {quiz.phase === "responding" ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => recheckPhase()}
                    disabled={rechecking}
                    className="rounded-lg px-5 py-2.5 font-semibold disabled:opacity-50"
                    style={accentBtn}
                  >
                    {rechecking ? "Checking…" : "Review my peers"}
                  </button>
                  {!!recheckedAt && !rechecking && (
                    <span className="text-sm" style={{ color: theme.muted }}>Not open yet — try again later.</span>
                  )}
                </div>
              ) : (
                <a href={`/q/${slug}/review`} className="mt-3 inline-block rounded-lg px-6 py-3 font-semibold" style={accentBtn}>
                  {quiz.phase === "reviewing" ? "Start reviewing →" : "See my mark and comments →"}
                </a>
              )}
            </div>
          )}

          <div className="mt-6 space-y-4">
            {groupByPassage(review.questions).map((group) => (
              <div key={group.start} className="space-y-4">
                <Material text={group.passage} title={group.passageTitle} colours={theme} collapsible={false} />
                {group.questions.map((qn, j) => {
                  const i = group.start + j;
                  const per = review.per.find((p) => p.qid === qn.id);
                  const scored = qn.graded !== false;
                  const choiceQ = qn.type === "mcq" || qn.type === "multi";
                  const chosenKeys = qn.type === "multi" ? splitKeys(per?.answer) : per?.answer ? [per.answer] : [];
                  const rightKeys = scored ? correctKeysOf(qn) : [];
                  const partial = scored && !per?.correct && (per?.awarded ?? 0) > 0;
                  const missed = qn.options.filter((o) => rightKeys.includes(o.key) && !chosenKeys.includes(o.key));
                  const picked = qn.options.filter((o) => chosenKeys.includes(o.key));
                  return (
                    <div key={qn.id} className="rounded-2xl border p-5 shadow-sm print-page" style={cardStyle}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs font-semibold" style={{ color: theme.muted }}>
                          Q{i + 1}
                          {scored ? ` · ${qn.points} pt` : ""}
                        </p>
                        {!scored ? (
                          <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-slate-100 text-slate-600">Recorded</span>
                        ) : !choiceQ ? (
                          <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-amber-100 text-amber-800">Awaiting review</span>
                        ) : (
                          <span
                            className={`text-xs font-bold rounded-full px-2.5 py-1 ${
                              per?.correct ? "bg-green-100 text-green-800" : partial ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"
                            }`}
                          >
                            {!chosenKeys.length
                              ? "Not answered"
                              : per?.correct
                                ? `Correct +${per.awarded}`
                                : partial
                                  ? `Partly correct +${per?.awarded}`
                                  : "Incorrect"}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 font-medium">{qn.text}</p>
                      <Media url={qn.media} compact />

                      {choiceQ ? (
                        <div className="mt-3 space-y-1.5 text-sm">
                          {qn.options.map((o) => {
                            const isChosen = chosenKeys.includes(o.key);
                            const isCorrect = rightKeys.includes(o.key);
                            // In an unscored question there is nothing to be right about —
                            // only the student's own choice is highlighted.
                            const tone = !scored
                              ? isChosen
                                ? "border-2"
                                : ""
                              : isCorrect
                                ? "border-green-400 bg-green-50 text-green-900"
                                : isChosen
                                  ? "border-red-300 bg-red-50 text-red-900"
                                  : "";
                            return (
                              <div
                                key={o.key}
                                className={`rounded-lg border px-3 py-2 ${tone}`}
                                style={scored && (isCorrect || isChosen) ? undefined : { borderColor: isChosen ? theme.accent : theme.border }}
                              >
                                {o.text}
                                {scored && isCorrect && <span className="ml-1.5 text-xs font-semibold">✓ correct answer</span>}
                                {scored && isChosen && !isCorrect && <span className="ml-1.5 text-xs font-semibold">your choice</span>}
                                {scored && isChosen && isCorrect && <span className="ml-1.5 text-xs font-semibold">(your choice)</span>}
                                {!scored && isChosen && <span className="ml-1.5 text-xs font-semibold">your choice</span>}
                              </div>
                            );
                          })}
                          {scored && (picked.some((o) => o.feedback) || missed.some((o) => o.feedback) || qn.feedbackCorrect || qn.feedbackIncorrect) && (
                            <div className="mt-2 rounded-lg p-3 text-sm" style={{ background: theme.accentSoft }}>
                              {picked
                                .filter((o) => o.feedback)
                                .map((o) => (
                                  <p key={o.key} className="mt-1 first:mt-0">
                                    <span className="font-semibold">You chose “{o.text}”:</span> {o.feedback}
                                  </p>
                                ))}
                              {missed
                                .filter((o) => o.feedback)
                                .map((o) => (
                                  <p key={o.key} className="mt-1">
                                    <span className="font-semibold">“{o.text}” was also correct:</span> {o.feedback}
                                  </p>
                                ))}
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
                          {scored && qn.feedbackCorrect && (
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
            ))}
          </div>

          <div className="no-print mt-6 rounded-2xl border p-5 text-center shadow-sm" style={cardStyle}>
            <p className="text-sm" style={{ color: theme.muted }}>
              Keep a copy of this response for your records.
            </p>
            <button onClick={() => window.print()} className="mt-3 rounded-lg px-6 py-2.5 font-semibold" style={accentBtn}>
              Print / save your copy
            </button>
          </div>

          <div className="no-print fixed bottom-5 right-4 flex flex-col gap-2">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              aria-label="Jump to top"
              className="w-11 h-11 rounded-full shadow-lg text-lg font-bold"
              style={accentBtn}
            >
              ↑
            </button>
            <button
              onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })}
              aria-label="Jump to bottom"
              className="w-11 h-11 rounded-full shadow-lg text-lg font-bold"
              style={accentBtn}
            >
              ↓
            </button>
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
              <li>
                • {quiz.questionCount} questions
                {quiz.peerReview
                  ? " · marked by your classmates"
                  : quiz.rubricMode
                    ? " · marked against a rubric"
                    : quiz.survey
                      ? " · not scored"
                      : quiz.totalPoints !== undefined
                        ? ` · ${quiz.totalPoints} points`
                        : ""}
              </li>
              {quiz.rubricMode && (
                <li>
                  • Written answers are marked against your teacher&apos;s rubric — band by band, with written feedback.
                  Nothing is scored as you answer; your marks appear when your teacher releases them.
                </li>
              )}
              {quiz.questions.some((qn) => qn.type === "short" || qn.type === "essay") && (
                <>
                  {quiz.questions.some((qn) => !!qn.wordLimit) && (
                    <li>• Some answers have a word limit. The counter warns you; going over is marked down, not blocked.</li>
                  )}
                  {s.pasteGuard && <li>• Pasting into written answers is turned off for this quiz.</li>}
                  <li>• Typing activity on written answers is recorded for your teacher.</li>
                </>
              )}
              {quiz.mst && (
                <li>
                  • This paper comes in {quiz.mst.stages} sections of {quiz.mst.perStage}. Each section is chosen from how the
                  one before it went, so once you finish a section you cannot go back to it.
                </li>
              )}
              {quiz.peerReview ? (
                <li>• Nothing is marked as you answer — classmates review your work afterwards, anonymously both ways.</li>
              ) : (
                quiz.survey && <li>• There are no right or wrong answers here — your responses are simply recorded.</li>
              )}
              {s.groupMode && (
                <li>
                  • Group quiz — one submission per group of{" "}
                  {s.groupMin === s.groupMax ? s.groupMin : `${s.groupMin}–${s.groupMax}`} members
                </li>
              )}
              {s.timerMode === "quiz" && s.maxMinutes && <li>• Time limit: {s.maxMinutes} minutes from when you start</li>}
              {s.timerMode === "question" && s.perQuestionSeconds && (
                <li>• {s.perQuestionSeconds} seconds per question, one at a time — you cannot go back</li>
              )}
              {s.closesAt && <li>• Closes {new Date(s.closesAt).toLocaleString()}</li>}
              <li>
                {quiz.peerReview
                  ? "• When your teacher opens the review round, this same link takes you to your classmates' work"
                  : quiz.survey
                    ? "• You can print or save a copy of your responses after submitting"
                    : "• Your score and feedback appear immediately after you submit"}
              </li>
            </ul>

            {/*
              The interface is the thing being rehearsed, so it is explained
              before the clock starts rather than discovered under it — above all
              the rule that costs first-timers marks: a choice is not an answer
              until it is saved.
            */}
            {examMode && quiz.phase === "responding" && !quiz.closed && (
              <div className="mt-5 rounded-xl border-2 border-slate-300 bg-slate-50 p-4 text-slate-900">
                <h2 className="text-sm font-bold uppercase tracking-wide">Exam interface — read before you start</h2>
                <p className="mt-2 text-sm">
                  This paper is presented one question at a time, in a layout modelled on national-level
                  competitive examinations. You may move freely between questions using the palette.
                </p>
                <p className="mt-2 rounded-lg bg-amber-100 p-2.5 text-sm font-medium text-amber-900">
                  Choosing an option does not record it. Press <strong>Save &amp; Next</strong> (or{" "}
                  <strong>Save &amp; Mark for Review</strong>) or your choice is discarded when you leave the
                  question — exactly as in the real examination.
                </p>
                <p className="mt-3 text-sm font-semibold">The palette shows every question as one of:</p>
                <ul className="mt-2 space-y-1.5">
                  {LEGEND_ORDER.map((s) => (
                    <li key={s} className="flex items-center gap-2.5 text-sm">
                      <span
                        aria-hidden
                        className={`inline-block h-4 w-4 shrink-0 border ${
                          STATUS_STYLES[s].shape === "circle" ? "rounded-full" : "rounded-sm"
                        }`}
                        style={{ background: STATUS_STYLES[s].bg, borderColor: STATUS_STYLES[s].border }}
                      />
                      {STATUS_STYLES[s].label}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm">
                  <strong>Mark for Review</strong> is a note to yourself — a flagged answer is marked no
                  differently from any other. You will see a summary before your paper is submitted.
                </p>
              </div>
            )}

            {quiz.phase !== "responding" ? (
              <div className="mt-6 rounded-lg p-4 text-sm" style={{ background: theme.accentSoft }}>
                <p className="font-semibold">
                  {quiz.rubricMode
                    ? quiz.phase === "closed"
                      ? "Results are out"
                      : "Responses are closed — marking is under way"
                    : quiz.phase === "reviewing"
                      ? "Peer review is open"
                      : "This quiz has finished"}
                </p>
                <p className="mt-1" style={{ color: theme.muted }}>
                  {quiz.rubricMode
                    ? quiz.phase === "closed"
                      ? "If you took part, you can read your marks and your teacher's feedback."
                      : "Your teacher is marking the written answers. Check back once they say the results are out."
                    : quiz.phase === "reviewing"
                      ? "Responses are closed. If you submitted one, you now have a few classmates' answers to mark."
                      : "Marking is done. If you took part, you can read your result and the comments left on your work."}
                </p>
                {(!quiz.rubricMode || quiz.phase === "closed") && (
                  <a
                    href={quiz.rubricMode ? `/q/${slug}/result` : `/q/${slug}/review`}
                    className="mt-3 inline-block rounded-lg px-5 py-2.5 font-semibold"
                    style={accentBtn}
                  >
                    {quiz.rubricMode ? "See my marks and feedback" : quiz.phase === "reviewing" ? "Go to peer review" : "See my result"}
                  </a>
                )}
              </div>
            ) : quiz.closed ? (
              <p className="mt-6 rounded-lg bg-slate-100 text-slate-600 p-4 text-sm font-medium">
                This quiz is not accepting responses right now.
              </p>
            ) : (
              <form onSubmit={start} className="mt-6 space-y-3">
                {s.groupMode ? (
                  <>
                    <input
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="Group name"
                      required
                      className="w-full rounded-lg border px-4 py-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2"
                      style={{ borderColor: theme.border }}
                    />
                    <div className="flex gap-3">
                      <label className="flex-1 text-sm" style={{ color: theme.muted }}>
                        Members in your group
                        <select
                          value={members.length}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            setMembers((m) =>
                              Array.from({ length: n }, (_, i) => m[i] ?? { name: "", roll: "" })
                            );
                          }}
                          className="mt-1 w-full rounded-lg border px-3 py-2.5 bg-white text-slate-900"
                          style={{ borderColor: theme.border }}
                        >
                          {Array.from(
                            { length: (s.groupMax ?? 1) - (s.groupMin ?? 1) + 1 },
                            (_, i) => (s.groupMin ?? 1) + i
                          ).map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex-1 text-sm" style={{ color: theme.muted }}>
                        Semester
                        <select
                          value={semester}
                          onChange={(e) => setSemester(e.target.value)}
                          required
                          className="mt-1 w-full rounded-lg border px-3 py-2.5 bg-white text-slate-900"
                          style={{ borderColor: theme.border }}
                        >
                          <option value="">Semester</option>
                          {SEMESTER_CHOICES.map((n) => (
                            <option key={n} value={n}>Sem {n}</option>
                          ))}
                          <option value={NO_SEMESTER}>Not applicable</option>
                        </select>
                      </label>
                    </div>
                    {members.map((m, i) => (
                      <div key={i} className="flex gap-3">
                        <input
                          value={m.name}
                          onChange={(e) =>
                            setMembers((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                          }
                          placeholder={`Member ${i + 1} full name`}
                          required
                          className="flex-[2] rounded-lg border px-4 py-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2"
                          style={{ borderColor: theme.border }}
                        />
                        <input
                          value={m.roll}
                          onChange={(e) =>
                            setMembers((arr) =>
                              arr.map((x, j) => (j === i ? { ...x, roll: e.target.value.replace(/\D/g, "") } : x))
                            )
                          }
                          placeholder="Class roll number"
                          inputMode="numeric"
                          pattern="[0-9]+"
                          title="Digits only"
                          required
                          className="flex-1 min-w-0 rounded-lg border px-4 py-2.5 bg-white text-slate-900 focus:outline-none focus:ring-2"
                          style={{ borderColor: theme.border }}
                        />
                      </div>
                    ))}
                  </>
                ) : (
                  <>
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
                        onChange={(e) => setRoll(e.target.value.replace(/\D/g, ""))}
                        placeholder="Class roll number"
                        inputMode="numeric"
                        pattern="[0-9]+"
                        title="Digits only"
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
                        {SEMESTER_CHOICES.map((n) => (
                          <option key={n} value={n}>Sem {n}</option>
                        ))}
                        <option value={NO_SEMESTER}>Not applicable</option>
                      </select>
                    </div>
                  </>
                )}
                {/*
                  Your marks are gathered under your roll number across every
                  test of the semester, so a student who switches between their
                  class roll and their university one splits their own record.
                */}
                <p className="text-xs" style={{ color: theme.muted }}>
                  Use your <strong>class roll number</strong> — not your university registration number — and the same
                  one in every test, so all your marks stay together.
                </p>
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

  /** Add or remove one key from a multi-answer question's stored "A,C" string. */
  const toggleKey = (qid: string, key: string) =>
    setAnswers((a) => {
      const picked = splitKeys(a[qid]);
      const next = picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key];
      return { ...a, [qid]: joinKeys(next) };
    });

  // One question at a time means the material cannot sit above the run, so it
  // travels with each question instead; on the scrolling page it is shown once.
  const renderQuestion = (qn: PublicQuestion, i: number, withMaterial = false) => (
    <div key={qn.id} className="rounded-2xl border p-5 shadow-sm" style={cardStyle}>
      <p className="text-xs font-semibold" style={{ color: theme.muted }}>
        Question {i + 1} of {ordered.length}
        {qn.graded ? ` · ${qn.points} pt` : ""}
      </p>
      {withMaterial && <Material text={qn.passage} title={qn.passageTitle} colours={theme} />}
      <p className="mt-2 font-medium text-lg">{qn.text}</p>
      <Media url={qn.media} />
      {qn.type === "mcq" || qn.type === "multi" ? (
        <>
          {qn.type === "multi" && (
            <p className="mt-2 text-xs font-semibold" style={{ color: theme.accent }}>
              Select all that apply.
            </p>
          )}
          <div className="mt-3 space-y-2">
            {qn.options.map((o) => {
              const selected =
                qn.type === "multi" ? splitKeys(answers[qn.id]).includes(o.key) : answers[qn.id] === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  role={qn.type === "multi" ? "checkbox" : "radio"}
                  aria-checked={selected}
                  onClick={() =>
                    qn.type === "multi"
                      ? toggleKey(qn.id, o.key)
                      : setAnswers((a) => ({ ...a, [qn.id]: selected ? "" : o.key }))
                  }
                  className="flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm font-medium transition"
                  style={selected ? { borderColor: theme.accent, background: theme.accentSoft } : { borderColor: theme.border, background: theme.card }}
                >
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center border-2 text-xs font-bold ${qn.type === "multi" ? "rounded" : "rounded-full"}`}
                    style={{
                      borderColor: selected ? theme.accent : theme.border,
                      background: selected ? theme.accent : "transparent",
                      color: theme.accentText,
                    }}
                  >
                    {selected ? (qn.type === "multi" ? "✓" : "●") : ""}
                  </span>
                  <span className="flex-1">{o.text}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <WrittenAnswer
          qid={qn.id}
          value={answers[qn.id] ?? ""}
          onChange={(next) => setAnswers((a) => ({ ...a, [qn.id]: next }))}
          rows={qn.type === "essay" ? 8 : 4}
          wordLimit={qn.wordLimit}
          hardLimit={quiz.settings.hardWordLimit}
          pasteGuard={quiz.settings.pasteGuard}
          telemetry={telemetryRef.current ?? undefined}
          colours={{ border: theme.border, muted: theme.muted }}
        />
      )}
    </div>
  );

  // ------- exam interface -------
  if (examMode) {
    return (
      <ExamShell
        questions={ordered}
        attemptId={attempt?.attemptId ?? ""}
        pasteGuard={quiz.settings.pasteGuard}
        hardWordLimit={quiz.settings.hardWordLimit}
        telemetry={telemetryRef.current ?? undefined}
        answers={answers}
        progress={progress}
        index={index}
        remainingMs={overallRemaining}
        candidate={attempt?.candidate || (quiz.settings.groupMode ? groupName : name)}
        quizTitle={quiz.title}
        subtitle={quiz.description}
        submitting={submitting}
        submitError={submitError}
        onIndexChange={setIndex}
        onSaveAnswer={(qid, answer) => setAnswers((a) => ({ ...a, [qid]: answer }))}
        onSetMarked={(qid, marked) =>
          setProgress((p) => {
            const next = new Set(p.marked);
            if (marked) next.add(qid);
            else next.delete(qid);
            return { ...p, marked: next };
          })
        }
        onSubmit={finishOrAdvance}
        stage={
          mstMode && totalStages
            ? { number: stageNumber + 1, total: totalStages, last: stageNumber + 1 >= totalStages }
            : undefined
        }
      />
    );
  }

  return (
    <div style={pageStyle} className="pb-12 flex-1">
      <div className="sticky top-0 z-10 border-b backdrop-blur px-4 py-3" style={{ background: `${theme.card}ee`, borderColor: theme.border }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3 text-sm">
          <p className="font-semibold truncate">{quiz.title}</p>
          <div className="flex items-center gap-3 shrink-0">
            {mstMode && totalStages > 0 && (
              <span className="font-semibold" style={{ color: theme.muted }}>
                Section {stageNumber + 1}/{totalStages}
              </span>
            )}
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
            {renderQuestion(ordered[index], index, true)}
            <div className="flex justify-end">
              <button
                onClick={() => (index < ordered.length - 1 ? setIndex((i) => i + 1) : submit())}
                disabled={submitting}
                className="rounded-lg px-6 py-3 font-semibold disabled:opacity-50"
                style={accentBtn}
              >
                {index < ordered.length - 1 ? "Next →" : submitting ? "Submitting…" : quiz.survey ? "Submit responses" : "Submit quiz"}
              </button>
            </div>
          </>
        ) : (
          <>
            {groupByPassage(ordered).map((group) => (
              <div key={group.start} className="space-y-5">
                <Material text={group.passage} title={group.passageTitle} colours={theme} />
                {group.questions.map((qn, j) => renderQuestion(qn, group.start + j))}
              </div>
            ))}
            <div className="rounded-2xl border p-5 shadow-sm text-center" style={cardStyle}>
              <p className="text-sm" style={{ color: theme.muted }}>
                {answered < ordered.length
                  ? `${ordered.length - answered} question${ordered.length - answered === 1 ? "" : "s"} unanswered.`
                  : "All questions answered."}
              </p>
              {mstMode && stageNumber + 1 < totalStages && (
                <p className="mt-2 text-xs" style={{ color: theme.muted }}>
                  The next section is chosen from how this one goes, so you cannot come back to these questions.
                </p>
              )}
              <button
                onClick={finishOrAdvance}
                disabled={submitting}
                className="mt-3 rounded-lg px-8 py-3 font-semibold disabled:opacity-50"
                style={accentBtn}
              >
                {submitting
                  ? mstMode && stageNumber + 1 < totalStages
                    ? "Saving…"
                    : "Submitting…"
                  : mstMode && stageNumber + 1 < totalStages
                    ? "Finish section →"
                    : quiz.survey
                      ? "Submit responses"
                      : "Submit quiz"}
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
