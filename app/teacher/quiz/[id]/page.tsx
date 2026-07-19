"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import type { AttemptFlags, GroupInfo, PerQuestionResult, Question, QuizSettings, StudentInfo } from "@/lib/types";

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
      for (const a of attempts) {
        const per = a.per_question?.find((p) => p.qid === qn.id);
        if (!per?.answer) continue;
        answered++;
        if (qn.type === "mcq") {
          dist[per.answer] = (dist[per.answer] ?? 0) + 1;
          if (per.correct) correct++;
        }
      }
      return { qn, answered, correct, dist };
    });
  }, [quiz, attempts]);

  const avg = attempts.length
    ? attempts.reduce((s, a) => s + (a.score ?? 0), 0) / attempts.length
    : 0;

  async function toggleAccepting() {
    if (!quiz) return;
    await fetch(`/api/quizzes/${quiz.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accepting: !quiz.accepting }),
    });
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
            Semester: a.group_info.semester,
          }
        : {
            Name: a.student.name,
            RollNumber: a.student.rollNorm,
            Semester: a.student.semester,
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
        row[`Q${i + 1}`] = qn.type === "mcq" ? (ans ? `${ans}${per?.correct ? " ✓" : " ✗"}` : "—") : ans;
      });
      return row;
    });
    const wsResponses = XLSX.utils.json_to_sheet(rows);
    const wsQuestions = XLSX.utils.json_to_sheet(
      qs.map((qn, i) => ({
        No: `Q${i + 1}`,
        Question: qn.text,
        Type: qn.type,
        CorrectAnswer: qn.correct ?? "",
        Points: qn.points,
        PercentCorrect: (() => {
          const st = analysis[i];
          return st && st.answered && qn.type === "mcq" ? Math.round((st.correct / st.answered) * 100) : "";
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
      <Link href="/teacher" className="text-sm text-slate-500 hover:text-slate-800">← Dashboard</Link>
      <div className="mt-2 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{quiz.title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {quiz.questions.length} questions · created {new Date(quiz.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
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
      {showQr && qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR code" className="mt-3 w-64 h-64 rounded-xl border border-slate-200 bg-white p-2" />
      )}

      <div className="mt-6 grid grid-cols-3 gap-3 text-center">
        {[
          ["Responses", String(attempts.length)],
          ["Average score", attempts.length ? `${Math.round(avg * 10) / 10} / ${attempts[0]?.max_score ?? ""}` : "—"],
          ["Flagged", String(attempts.filter((a) => a.flags?.late || duplicateIds.has(a.id)).length)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-2xl font-bold text-slate-900">{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

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
                  <th className="px-4 py-2.5">Score</th>
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
                      <td className="px-4 py-2.5">{a.group_info ? a.group_info.semester : a.student.semester}</td>
                      <td className="px-4 py-2.5 font-semibold">{a.score ?? 0} / {a.max_score ?? 0}</td>
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
              {quiz.questions.map((qn, i) => {
                const per = a.per_question?.find((p) => p.qid === qn.id);
                return (
                  <p key={qn.id} className="text-slate-700">
                    <span className="font-semibold">Q{i + 1}.</span>{" "}
                    {qn.type === "mcq" ? (
                      <>
                        {per?.answer ?? "—"}{" "}
                        {per?.answer ? (per.correct ? <span className="text-green-700">✓</span> : <span className="text-red-600">✗ (correct: {qn.correct})</span>) : null}
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

      <section className="mt-10">
        <h2 className="font-bold text-slate-900">Item analysis</h2>
        {attempts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Appears once responses arrive.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {analysis.map(({ qn, answered, correct, dist }, i) => (
              <div key={qn.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-medium text-slate-900">
                  <span className="text-slate-400 font-semibold">Q{i + 1}.</span> {qn.text}
                </p>
                {qn.type === "mcq" ? (
                  <>
                    <p className="mt-1 text-xs text-slate-500">
                      {answered} answered · {answered ? Math.round((correct / answered) * 100) : 0}% correct
                    </p>
                    <div className="mt-2 space-y-1">
                      {qn.options.map((o) => {
                        const n = dist[o.key] ?? 0;
                        const pct = answered ? Math.round((n / answered) * 100) : 0;
                        return (
                          <div key={o.key} className="flex items-center gap-2 text-xs">
                            <span className={`w-5 font-semibold ${o.key === qn.correct ? "text-green-700" : "text-slate-500"}`}>{o.key}</span>
                            <div className="flex-1 h-4 rounded bg-slate-100 overflow-hidden">
                              <div
                                className={`h-full ${o.key === qn.correct ? "bg-green-500" : "bg-slate-400"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-16 text-right text-slate-500">{n} ({pct}%)</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-slate-500 italic">Typed answers — see the responses table or Excel export.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
