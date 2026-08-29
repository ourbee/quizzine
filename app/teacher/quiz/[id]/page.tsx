/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import TeacherBar from "@/components/TeacherBar";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import { correctKeysOf, isChoice, isGraded, isSurvey, splitKeys } from "@/lib/questions";
import { normalizeAllotment } from "@/lib/allot";
import { semesterLabel } from "@/lib/normalize";
import PeerReviewPanel from "@/components/PeerReviewPanel";
import SharePanel from "@/components/SharePanel";
import type { AttemptFlags, GroupInfo, PerQuestionResult, Question, QuizSettings, StudentInfo } from "@/lib/types";
import { scoreLabel } from "@/lib/score";

interface QuizRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  questions: Question[];
  settings: QuizSettings;
  theme: string;
  accepting: boolean;
  created_at: string;
  phase?: string | null;
  /** Set when this quiz arrived as a colleague's copy — see the share route. */
  shared_by?: string | null;
  /** Allotted tests: the roster and the roll → question deal. */
  allotment?: unknown;
}

interface AttemptRow {
  id: string;
  student: StudentInfo;
  group_info: GroupInfo | null;
  answers: Record<string, string> | null;
  per_question: PerQuestionResult[] | null;
  score: number | null;
  max_score: number | null;
  flags: AttemptFlags;
  submitted_at: string;
  /** Allotted tests: the qids this student was dealt. */
  allotted?: string[] | null;
}

export default function QuizDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [quiz, setQuiz] = useState<QuizRow | null>(null);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [error, setError] = useState("");
  const [qr, setQr] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/quizzes/${id}`);
    if (res.status === 401) {
      router.push("/teacher");
      return;
    }
    if (!res.ok) {
      setError("Could not load this quiz.");
      return;
    }
    const data = await res.json();
    setQuiz(data.quiz);
    setAttempts(data.attempts ?? []);
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  const quizUrl = quiz ? `${typeof window !== "undefined" ? window.location.origin : ""}/q/${quiz.slug}` : "";

  useEffect(() => {
    if (quizUrl) QRCode.toDataURL(quizUrl, { width: 480, margin: 1 }).then(setQr);
  }, [quizUrl]);

  // Attempt ids that share a roll number (any member's, for group quizzes) with another attempt.
  const duplicateIds = useMemo(() => {
    const byKey = new Map<string, string[]>();
    for (const a of attempts) {
      const keys = a.group_info
        ? a.group_info.members.map((m) => `${m.roll}|${a.group_info!.semester}`)
        : [`${a.student.rollNorm}|${a.student.semester}`];
      for (const key of new Set(keys)) {
        byKey.set(key, [...(byKey.get(key) ?? []), a.id]);
      }
    }
    const dups = new Set<string>();
    for (const ids of byKey.values()) {
      if (ids.length > 1) ids.forEach((id) => dups.add(id));
    }
    return dups;
  }, [attempts]);

  const analysis = useMemo(() => {
    if (!quiz) return [];
    return quiz.questions.map((qn) => {
      const dist: Record<string, number> = {};
      let answered = 0;
      let correct = 0;
      let picks = 0; // ticks cast, which exceeds `answered` on multi-answer questions
      for (const a of attempts) {
        const per = a.per_question?.find((p) => p.qid === qn.id);
        if (!per?.answer) continue;
        answered++;
        if (isChoice(qn)) {
          for (const key of qn.type === "multi" ? splitKeys(per.answer) : [per.answer]) {
            dist[key] = (dist[key] ?? 0) + 1;
            picks++;
          }
          if (per.correct) correct++;
        }
      }
      return { qn, answered, correct, dist, picks };
    });
  }, [quiz, attempts]);

  // The roster is what lets an allotted quiz say who has NOT submitted yet —
  // something no other mode can know.
  const allotted = !!quiz?.settings.allotMode;
  const allotmentInfo = useMemo(() => {
    if (!quiz || !allotted) return null;
    const a = normalizeAllotment(quiz.allotment);
    if (!a) return null;
    const submitted = new Set(attempts.map((at) => at.student.rollNorm));
    const missing = a.entries.filter((e) => !submitted.has(e.roll)).map((e) => e.roll);
    return { semester: a.semester, rosterSize: a.entries.length, missing };
  }, [quiz, attempts, allotted]);

  // A quiz with nothing to score has no meaningful average. A peer-reviewed or
  // rubric-marked one has no marks either until they are in and released.
  const peerMode = quiz?.settings.gradingMode === "peer";
  const rubricMode = quiz?.settings.gradingMode === "rubric";
  const survey = quiz
    ? quiz.settings.gradingMode === "survey" ||
      (peerMode || rubricMode ? (quiz.phase ?? "responding") !== "closed" : isSurvey(quiz.questions))
    : false;
  // Written answers can be marked in any scored quiz, not only a rubric one —
  // this is what finally resolves the `pending` items grade() leaves behind.
  const writtenCount = quiz
    ? quiz.questions.filter((qn) => !isChoice(qn) && isGraded(qn)).length
    : 0;
  const avg = attempts.length
    ? attempts.reduce((s, a) => s + (a.score ?? 0), 0) / attempts.length
    : 0;

  async function toggleAccepting() {
    if (!quiz) return;
    const res = await fetch(`/api/quizzes/${quiz.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accepting: !quiz.accepting }),
    });
    if (!res.ok) {
      // The one refusal this can meet: opening an allotted quiz whose roster
      // still has a roll with no question.
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Could not change whether the quiz is open.");
    }
    load();
  }

  async function deleteQuiz() {
    if (!quiz) return;
    if (!confirm(`Delete "${quiz.title}" and all ${attempts.length} responses? This cannot be undone.`)) return;
    await fetch(`/api/quizzes/${quiz.id}`, { method: "DELETE" });
    router.push("/teacher");
  }

  function exportXlsx() {
    if (!quiz) return;
    const qs = quiz.questions;
    const rows = attempts.map((a) => {
      const row: Record<string, unknown> = a.group_info
        ? {
            GroupName: a.group_info.name,
            Members: a.group_info.members.map((m) => `${m.name} (${m.roll})`).join(", "),
            MemberCount: a.group_info.members.length,
            Semester: semesterLabel(a.group_info.semester),
          }
        : {
            Name: a.student.name,
            RollNumber: a.student.rollNorm,
            Semester: semesterLabel(a.student.semester),
          };
      Object.assign(row, {
        Score: a.score ?? 0,
        MaxScore: a.max_score ?? 0,
        Percent: a.max_score ? Math.round(((a.score ?? 0) / a.max_score) * 1000) / 10 : 0,
        Late: a.flags?.late ? "YES" : "",
        Duplicate: duplicateIds.has(a.id) ? "YES" : "",
        SubmittedAt: new Date(a.submitted_at).toLocaleString(),
      });
      qs.forEach((qn, i) => {
        const per = a.per_question?.find((p) => p.qid === qn.id);
        const ans = per?.answer ?? "";
        if (!isChoice(qn) || !isGraded(qn)) {
          row[`Q${i + 1}`] = ans;
          return;
        }
        row[`Q${i + 1}`] = ans ? `${ans}${per?.correct ? " ✓" : (per?.awarded ?? 0) > 0 ? ` ~${per?.awarded}` : " ✗"}` : "—";
      });
      return row;
    });
    const wsResponses = XLSX.utils.json_to_sheet(rows);
    const wsQuestions = XLSX.utils.json_to_sheet(
      qs.map((qn, i) => ({
        No: `Q${i + 1}`,
        Question: qn.text,
        Type: qn.type,
        Scored: isGraded(qn) ? "yes" : "no",
        CorrectAnswer: correctKeysOf(qn).join(","),
        Points: qn.points,
        PercentCorrect: (() => {
          const st = analysis[i];
          return st && st.answered && isChoice(qn) && isGraded(qn) ? Math.round((st.correct / st.answered) * 100) : "";
        })(),
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsResponses, "Responses");
    XLSX.utils.book_append_sheet(wb, wsQuestions, "Questions");
    XLSX.writeFile(wb, `${quiz.slug}-responses.xlsx`);
  }

  if (error) return <main className="max-w-4xl mx-auto px-6 py-16 text-red-600">{error}</main>;
  if (!quiz) return <main className="max-w-4xl mx-auto px-6 py-16 text-slate-500">Loading…</main>;

  return (
    <main className="max-w-4xl mx-auto px-6 py-10 w-full">
      <TeacherBar />
      <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{quiz.title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {allotted && (
              <span className="mr-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                Allotted{allotmentInfo ? ` · ${semesterLabel(allotmentInfo.semester)} · ${allotmentInfo.rosterSize} on roster` : ""}
              </span>
            )}
            {quiz.questions.length} questions{allotted ? " in the bank" : ""} · created {new Date(quiz.created_at).toLocaleDateString()}
          </p>
          {allotted && !allotmentInfo && (
            <p className="mt-1 text-sm font-medium text-amber-700">
              No roster attached yet — students cannot start until you{" "}
              <Link href={`/teacher/quiz/${quiz.id}/edit#allotment`} className="underline underline-offset-2">
                attach one and deal the questions
              </Link>
              .
            </p>
          )}
          {quiz.shared_by && (
            // Said on the copy itself, because "why does my colleague's edit not
            // show up here?" is only a puzzle if nobody said it was a copy.
            <p className="mt-1 text-sm text-slate-600">
              Copied to you by <span className="font-medium">{quiz.shared_by}</span> — it is yours now, and editing it
              does not change theirs.
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            href={`/teacher/quiz/${quiz.id}/edit`}
            className="rounded-lg px-4 py-2 text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            Edit
          </Link>
          {writtenCount > 0 && (
            <Link
              href={`/teacher/quiz/${quiz.id}/mark`}
              className="rounded-lg px-4 py-2 text-sm font-semibold bg-blue-700 text-white hover:bg-blue-800"
            >
              Mark written answers
            </Link>
          )}
          <Link
            href="/teacher/tags"
            className="rounded-lg px-4 py-2 text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            Tags
          </Link>
          <button
            onClick={toggleAccepting}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              quiz.accepting ? "bg-green-100 text-green-800 hover:bg-green-200" : "bg-slate-200 text-slate-600 hover:bg-slate-300"
            }`}
          >
            {quiz.accepting ? "Open — click to close" : "Closed — click to open"}
          </button>
          <button onClick={deleteQuiz} className="rounded-lg px-4 py-2 text-sm font-semibold bg-red-50 text-red-700 hover:bg-red-100">
            Delete
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 flex items-center gap-3 flex-wrap">
        <code className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">{quizUrl}</code>
        <button
          onClick={() => { navigator.clipboard.writeText(quizUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="rounded-lg bg-blue-700 px-4 py-1.5 text-sm text-white font-semibold hover:bg-blue-800"
        >
          {copied ? "Copied ✓" : "Copy link"}
        </button>
        <button onClick={() => setShowQr((v) => !v)} className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
          {showQr ? "Hide QR" : "Show QR"}
        </button>
        <a href={quizUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-700 underline underline-offset-2">
          Open as student
        </a>
      </div>
      <SharePanel quizId={quiz.id} questionCount={quiz.questions.length} />

      {showQr && qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR code" className="mt-3 w-64 h-64 rounded-xl border border-slate-200 bg-white p-2" />
      )}

      <div className="mt-6 grid grid-cols-3 gap-3 text-center">
        {[
          ["Responses", String(attempts.length)],
          [
            survey ? "Not scored" : "Average score",
            survey ? "—" : attempts.length ? scoreLabel(Math.round(avg * 10) / 10, attempts[0]?.max_score ?? 0) : "—",
          ],
          ["Flagged", String(attempts.filter((a) => a.flags?.late || duplicateIds.has(a.id)).length)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-2xl font-bold text-slate-900">{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {allotmentInfo && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">
            <span className="font-semibold text-slate-900">
              {attempts.length} of {allotmentInfo.rosterSize}
            </span>{" "}
            on the roster have submitted.
          </p>
          {allotmentInfo.missing.length > 0 ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-sm font-semibold text-amber-700">
                Not yet submitted — {allotmentInfo.missing.length} roll{allotmentInfo.missing.length === 1 ? "" : "s"}
              </summary>
              <p className="mt-1.5 font-mono text-sm text-slate-600">{allotmentInfo.missing.join(", ")}</p>
            </details>
          ) : (
            attempts.length > 0 && <p className="mt-1 text-sm text-green-700">Everyone on the roster is in. 🎉</p>
          )}
        </div>
      )}

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-900">Responses</h2>
          <button
            onClick={exportXlsx}
            disabled={!attempts.length}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white font-semibold hover:bg-slate-700 disabled:opacity-40"
          >
            Export Excel
          </button>
        </div>
        {attempts.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No responses yet — share the link above.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">{quiz.settings.groupMode ? "Group" : "Name"}</th>
                  <th className="px-4 py-2.5">{quiz.settings.groupMode ? "Members" : "Roll"}</th>
                  <th className="px-4 py-2.5">Sem</th>
                  <th className="px-4 py-2.5">{survey ? "Answered" : "Score"}</th>
                  <th className="px-4 py-2.5">Submitted</th>
                  <th className="px-4 py-2.5">Flags</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => {
                  const dup = duplicateIds.has(a.id);
                  return (
                    <tr
                      key={a.id}
                      onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                      className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-900">{a.group_info ? a.group_info.name : a.student.name}</td>
                      <td className="px-4 py-2.5">{a.group_info ? `${a.group_info.members.length} members` : a.student.rollNorm}</td>
                      <td className="px-4 py-2.5">{semesterLabel(a.group_info ? a.group_info.semester : a.student.semester)}</td>
                      <td className="px-4 py-2.5 font-semibold">
                        {survey
                          ? `${a.per_question?.filter((p) => p.answer).length ?? 0} / ${quiz.questions.length}`
                          : scoreLabel(a.score, a.max_score)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{new Date(a.submitted_at).toLocaleString()}</td>
                      <td className="px-4 py-2.5 space-x-1">
                        {a.flags?.late && <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-medium">late</span>}
                        {dup && <span className="rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-xs font-medium">duplicate</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {expanded && (() => {
          const a = attempts.find((x) => x.id === expanded);
          if (!a) return null;
          return (
            <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4 text-sm space-y-2">
              <p className="font-semibold text-slate-900">{a.group_info ? a.group_info.name : a.student.name} — answers</p>
              {a.group_info && (
                <p className="text-slate-600">
                  Members: {a.group_info.members.map((m) => `${m.name} (${m.roll})`).join(", ")}
                </p>
              )}
              {quiz.questions
                // An allotted student only ever sat their own hand; listing the
                // whole bank with dashes would bury the one answer that exists.
                .filter((qn) => !a.allotted || a.allotted.includes(qn.id))
                .map((qn) => {
                const i = quiz.questions.indexOf(qn);
                const per = a.per_question?.find((p) => p.qid === qn.id);
                const scored = isGraded(qn);
                return (
                  <p key={qn.id} className="text-slate-700">
                    <span className="font-semibold">Q{i + 1}.</span>{" "}
                    {isChoice(qn) ? (
                      <>
                        {per?.answer ?? "—"}{" "}
                        {scored && per?.answer ? (
                          per.correct ? (
                            <span className="text-green-700">✓</span>
                          ) : (
                            <span className="text-red-600">
                              {(per.awarded ?? 0) > 0 ? `partly right +${per.awarded}` : "✗"} (correct: {correctKeysOf(qn).join(", ")})
                            </span>
                          )
                        ) : null}
                      </>
                    ) : (
                      <span className="italic">{per?.answer ?? "—"}</span>
                    )}
                  </p>
                );
              })}
            </div>
          );
        })()}
      </section>

      {quiz.settings.gradingMode === "peer" && (
        <PeerReviewPanel quizId={quiz.id} slug={quiz.slug} onPhaseChange={load} />
      )}

      {rubricMode && (
        <section className="mt-10 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-bold text-slate-900">Rubric marking</h2>
          <p className="mt-1 text-sm text-slate-600">
            {(quiz.phase ?? "responding") === "closed"
              ? `Results are released. Students see their marks and feedback at /q/${quiz.slug}/result.`
              : "Students see “response recorded” until you release. Mark the written answers, then release when you are ready — with or without an AI pass to start you off."}
          </p>
          <Link
            href={`/teacher/quiz/${quiz.id}/mark`}
            className="mt-3 inline-block rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Go to marking →
          </Link>
        </section>
      )}

      <section className="mt-10">
        <h2 className="font-bold text-slate-900">Item analysis</h2>
        {attempts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Appears once responses arrive.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {analysis.map(({ qn, answered, correct, dist }, i) => {
              const scored = isGraded(qn);
              const keys = scored ? correctKeysOf(qn) : [];
              return (
                <div key={qn.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-medium text-slate-900">
                    <span className="text-slate-400 font-semibold">Q{i + 1}.</span> {qn.text}
                  </p>
                  {isChoice(qn) ? (
                    <>
                      <p className="mt-1 text-xs text-slate-500">
                        {answered} answered
                        {scored && ` · ${answered ? Math.round((correct / answered) * 100) : 0}% got it fully right`}
                        {qn.type === "multi" && " · several answers allowed, so the bars can total more than 100%"}
                        {!scored && " · no correct answer, so this is the spread of opinion"}
                      </p>
                      <div className="mt-2 space-y-1">
                        {qn.options.map((o) => {
                          const n = dist[o.key] ?? 0;
                          const pct = answered ? Math.round((n / answered) * 100) : 0;
                          const right = keys.includes(o.key);
                          return (
                            <div key={o.key} className="flex items-center gap-2 text-xs">
                              <span className={`w-5 font-semibold ${right ? "text-green-700" : "text-slate-500"}`}>{o.key}</span>
                              <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                                <div
                                  className={`h-full ${right ? "bg-green-500" : scored ? "bg-slate-400" : "bg-blue-400"}`}
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
                              </div>
                              <span className="w-16 text-right text-slate-500">{n} ({pct}%)</span>
                            </div>
                          );
                        })}
                      </div>
                      <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
                        {qn.options.map((o) => (
                          <li key={o.key}>
                            <span className="font-semibold text-slate-600">{o.key}.</span> {o.text}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="mt-1 text-xs italic text-slate-500">
                      {answered} typed answer{answered === 1 ? "" : "s"} — see the responses table or Excel export.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
