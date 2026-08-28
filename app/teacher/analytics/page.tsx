/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { groupByDimension, type AnalyticsResult, type StudentProfile, type StudentTagRow } from "@/lib/analytics";
import { semesterLabel } from "@/lib/normalize";
import Logo from "@/components/Logo";

interface QuizRow {
  id: string;
  title: string;
  created_at: string;
  responses: string | number;
}

/** Colour by how far a percentage sits from the pass mark, not by rank. */
function barColour(percent: number, passMark: number): string {
  if (percent >= passMark + 35) return "#059669";
  if (percent >= passMark + 15) return "#2563eb";
  if (percent >= passMark) return "#4f46e5";
  if (percent >= passMark - 15) return "#d97706";
  return "#e11d48";
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const signed = (n: number) => `${n > 0 ? "+" : ""}${fmt(n)}`;

function Bar({ percent, passMark }: { percent: number; passMark: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(1, Math.min(100, percent))}%`, background: barColour(percent, passMark) }}
      />
    </div>
  );
}

/** A tag's three readings side by side: against self, against the pass mark, against the class. */
function TagRowView({ row, passMark }: { row: StudentTagRow; passMark: number }) {
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-sm font-medium text-slate-800">{row.value}</p>
        <p className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{fmt(row.percent)}%</p>
      </div>
      <div className="mt-1.5">
        <Bar percent={row.percent} passMark={passMark} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className="tabular-nums">{row.attempted} questions</span>
        <span className={row.vsSelf >= 0 ? "text-emerald-700" : "text-rose-700"}>
          {signed(row.vsSelf)} vs their average
        </span>
        {row.vsClass !== null && (
          <span className={row.vsClass >= 0 ? "text-emerald-700" : "text-rose-700"}>
            {signed(row.vsClass)} vs the class
          </span>
        )}
        {row.belowPass && <span className="font-semibold text-rose-700">below the pass mark</span>}
        {row.delta !== null && Math.abs(row.delta) >= 5 && (
          <span className={row.delta > 0 ? "text-emerald-700" : "text-amber-700"}>
            {row.delta > 0 ? "improving" : "slipping"} {signed(row.delta)} over time
          </span>
        )}
        {row.verdict === "insufficient" && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-500">not enough evidence yet</span>
        )}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [quizzes, setQuizzes] = useState<QuizRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState(false);

  const [minEvidence, setMinEvidence] = useState(5);
  const [margin, setMargin] = useState(10);
  const [passMark, setPassMark] = useState(40);
  const [repeats, setRepeats] = useState<"best" | "latest">("best");

  const [focus, setFocus] = useState<string[]>([]); // roll numbers, empty = whole class
  const [openStudent, setOpenStudent] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/quizzes");
      if (res.status === 401) {
        setAuthError(true);
        return;
      }
      const data = await res.json();
      setQuizzes(data.quizzes ?? []);
    })();
  }, []);

  const run = useCallback(
    async (rolls?: string[]) => {
      if (!picked.size) return;
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/reports/analytics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quizIds: [...picked],
            minEvidence,
            margin,
            passMark,
            repeats,
            rolls: rolls?.length ? rolls : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not build the report.");
        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not build the report.");
      } finally {
        setLoading(false);
      }
    },
    [picked, minEvidence, margin, passMark, repeats]
  );

  const students = result?.students ?? [];
  const profile = useMemo(
    () => students.find((s) => s.roll === openStudent) ?? null,
    [students, openStudent]
  );

  /** Columns for the heatmap: the tags the selection actually has evidence on. */
  const heatTags = useMemo(() => {
    if (!result) return [];
    return result.classRows
      .filter((r) => r.reliableStudents > 0)
      .sort((a, b) => a.dimension.localeCompare(b.dimension) || a.percent - b.percent)
      .slice(0, 24);
  }, [result]);

  function exportWorkbook() {
    if (!result) return;
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        result.classRows.map((r) => ({
          Dimension: r.dimension,
          Tag: r.value,
          "Class %": r.percent,
          Questions: r.attempted,
          Students: r.students,
          "Students with enough evidence": r.reliableStudents,
          "Students below pass": r.strugglingStudents,
        }))
      ),
      "Class by tag"
    );

    const perStudent: Record<string, string | number>[] = [];
    for (const s of result.students) {
      for (const r of [...s.rows, ...s.difficultyRows]) {
        perStudent.push({
          Roll: s.roll,
          Name: s.name,
          Semester: semesterLabel(s.semester),
          "Overall %": s.percent,
          Dimension: r.dimension,
          Tag: r.value,
          "%": r.percent,
          Questions: r.attempted,
          "vs own average": r.vsSelf,
          "vs class": r.vsClass ?? "",
          Verdict: r.verdict,
          "Below pass": r.belowPass ? "yes" : "",
          Trend: r.delta ?? "",
        });
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(perStudent), "Student by tag");

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        result.students.map((s) => ({
          Roll: s.roll,
          Name: s.name,
          Semester: semesterLabel(s.semester),
          "Quizzes sat": s.quizzesSat,
          "Questions counted": s.attempted,
          "Overall %": s.percent,
          Strengths: s.strengths.slice(0, 5).map((r) => `${r.value} (${fmt(r.percent)}%)`).join("; "),
          Weaknesses: s.weaknesses.slice(0, 5).map((r) => `${r.value} (${fmt(r.percent)}%)`).join("; "),
          "Needs more evidence": s.insufficient.slice(0, 5).map((r) => r.value).join("; "),
        }))
      ),
      "Summary"
    );

    XLSX.writeFile(wb, `quizzine-strengths-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Logo />
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Strengths and weaknesses</h1>
          <p className="mt-1 text-sm text-slate-500">
            What your students&apos; marks say about the topics they know, pooled across as many quizzes as you like.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/teacher/reports" className="rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-700">
            Marks report
          </Link>
          <Link href="/teacher" className="rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-700">
            Quizzes
          </Link>
        </div>
      </div>

      {/* ---------- choose the quizzes ---------- */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold text-slate-900">Which quizzes?</h2>
        <p className="mt-1 text-sm text-slate-500">
          Pick the tests to pool. Only tagged, auto-marked questions can be counted.
        </p>
        <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
          {quizzes.map((z) => (
            <label key={z.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                checked={picked.has(z.id)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(z.id);
                  else next.delete(z.id);
                  setPicked(next);
                  setResult(null);
                }}
                className="h-4 w-4"
              />
              <span className="flex-1 truncate text-slate-800">{z.title}</span>
              <span className="shrink-0 text-xs text-slate-400">{z.responses} responses</span>
            </label>
          ))}
          {!quizzes.length && <p className="text-sm text-slate-400">No quizzes yet.</p>}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-slate-100 pt-4 text-sm">
          <label className="text-slate-700">
            Fewest questions before calling it:
            <input
              type="number"
              min={1}
              max={50}
              value={minEvidence}
              onChange={(e) => setMinEvidence(Number(e.target.value) || 1)}
              className="ml-2 w-16 rounded-lg border border-slate-300 px-2 py-1.5"
            />
          </label>
          <label className="text-slate-700">
            Gap that counts:
            <input
              type="number"
              min={1}
              max={50}
              value={margin}
              onChange={(e) => setMargin(Number(e.target.value) || 1)}
              className="ml-2 w-16 rounded-lg border border-slate-300 px-2 py-1.5"
            />
            %
          </label>
          <label className="text-slate-700">
            Pass mark:
            <input
              type="number"
              min={0}
              max={100}
              value={passMark}
              onChange={(e) => setPassMark(Number(e.target.value) || 0)}
              className="ml-2 w-16 rounded-lg border border-slate-300 px-2 py-1.5"
            />
            %
          </label>
          <label className="text-slate-700">
            Repeat attempts:
            <select
              value={repeats}
              onChange={(e) => setRepeats(e.target.value as "best" | "latest")}
              className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5"
            >
              <option value="best">count the best</option>
              <option value="latest">count the latest</option>
            </select>
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          A topic with fewer than {minEvidence} questions behind it is reported as &ldquo;not enough evidence
          yet&rdquo; rather than as a strength or a weakness. Two wrong answers out of three is noise, and planning a
          term&apos;s teaching around it would be planning around nothing.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => {
              setFocus([]);
              setOpenStudent(null);
              run();
            }}
            disabled={!picked.size || loading}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {loading ? "Working…" : "Build the report"}
          </button>
          {result && (
            <button
              onClick={exportWorkbook}
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
            >
              Download as Excel
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </section>

      {result && (
        <>
          {/* ---------- what could not be counted ---------- */}
          {(result.untaggedQuestions > 0 || result.unanalysableQuestions > 0 || (!result.classRows.length && !result.rubricRows.length)) && (
            <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {!result.classRows.length && !result.rubricRows.length && (
                <p className="font-semibold">
                  Nothing here is tagged yet, so there is nothing to report on.{" "}
                  <Link href="/teacher/tags" className="underline">
                    Tag your questions
                  </Link>{" "}
                  and this fills in — including for quizzes students have already sat.
                </p>
              )}
              {result.untaggedQuestions > 0 && (
                <p className="mt-1">
                  {result.untaggedQuestions} scored question{result.untaggedQuestions === 1 ? " carries" : "s carry"} no
                  tag, so {result.untaggedQuestions === 1 ? "it is" : "they are"} counted in the marks but not in any
                  topic.
                </p>
              )}
              {result.unanalysableQuestions > 0 && (
                <p className="mt-1">
                  {result.unanalysableQuestions} written answer{result.unanalysableQuestions === 1 ? " is" : "s are"}{" "}
                  still unmarked, so {result.unanalysableQuestions === 1 ? "it counts" : "they count"} towards nothing
                  here yet.{" "}
                  <Link href="/teacher" className="underline">
                    Mark them
                  </Link>{" "}
                  and they join the report — marks, topics and all.
                </p>
              )}
            </section>
          )}

          {/* ---------- the rubric ---------- */}
          {result.rubricRows.length > 0 && (
            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="font-bold text-slate-900">Written answers, by rubric band</h2>
              <p className="mt-1 text-sm text-slate-500">
                Averaged over every marked answer in the selection. This is the question the tags cannot answer: not
                which topic the class is weak on, but which <em>part of writing</em> — and it names next week's lesson.
              </p>
              <div className="mt-3 space-y-1.5">
                {result.rubricRows.map((row) => (
                  <div
                    key={`${row.kind}-${row.id}`}
                    className={`flex items-center gap-3 rounded-lg px-2 py-1.5 ${
                      row.kind === "band" ? "bg-slate-50" : ""
                    }`}
                  >
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        row.kind === "band" ? "font-semibold text-slate-900" : "pl-4 text-slate-600"
                      }`}
                    >
                      {row.label}
                      <span className="ml-1.5 text-xs text-slate-400">{row.weight}%</span>
                    </span>
                    <div className="h-3 w-40 overflow-hidden rounded bg-slate-100">
                      <div
                        className={`h-full ${row.belowPass ? "bg-red-500" : row.kind === "band" ? "bg-blue-600" : "bg-blue-400"}`}
                        style={{ width: `${Math.min(100, row.percent)}%` }}
                      />
                    </div>
                    <span
                      className={`w-14 text-right text-sm tabular-nums ${
                        row.belowPass ? "font-semibold text-red-600" : "text-slate-700"
                      }`}
                    >
                      {row.percent}%
                    </span>
                    <span className="w-24 text-right text-xs text-slate-400">
                      {row.marked} marked · {row.students} student{row.students === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ---------- the class ---------- */}
          {result.classRows.length > 0 && (
            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-bold text-slate-900">
                  {focus.length ? `The chosen ${focus.length} students, by topic` : "The whole class, by topic"}
                </h2>
                <p className="text-sm text-slate-500">{students.length} students</p>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Where the whole group is below the pass mark, the problem is more likely the teaching than the
                students — those rows are the ones worth reteaching rather than remediating one by one.
              </p>

              <div className="mt-4 space-y-5">
                {groupByDimension(result.classRows).map((group) => (
                  <div key={group.dimension}>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">{group.dimension}</h3>
                    <div className="mt-1 divide-y divide-slate-100">
                      {group.rows.map((row) => (
                        <div key={row.tag} className="py-2.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="truncate text-sm font-medium text-slate-800">{row.value}</p>
                            <p className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{fmt(row.percent)}%</p>
                          </div>
                          <div className="mt-1.5">
                            <Bar percent={row.percent} passMark={passMark} />
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                            <span className="tabular-nums">{row.attempted} answers</span>
                            <span className="tabular-nums">{row.reliableStudents} students with enough evidence</span>
                            {row.strugglingStudents > 0 && (
                              <span className="text-rose-700">{row.strugglingStudents} below the pass mark</span>
                            )}
                            {row.belowPass && row.reliableStudents > 1 && (
                              <span className="font-semibold text-rose-700">the group as a whole is below it</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {result.classDifficultyRows.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">By difficulty</h3>
                    <div className="mt-1 divide-y divide-slate-100">
                      {[...result.classDifficultyRows]
                        .sort((a, b) => a.value.localeCompare(b.value))
                        .map((row) => (
                          <div key={row.tag} className="flex items-center gap-3 py-2">
                            <p className="w-36 shrink-0 truncate text-sm text-slate-700">{row.value}</p>
                            <div className="flex-1">
                              <Bar percent={row.percent} passMark={passMark} />
                            </div>
                            <p className="w-14 shrink-0 text-right text-sm font-bold tabular-nums text-slate-900">
                              {fmt(row.percent)}%
                            </p>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ---------- heatmap ---------- */}
          {heatTags.length > 0 && students.length > 1 && (
            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="font-bold text-slate-900">Everyone at a glance</h2>
              <p className="mt-1 text-sm text-slate-500">
                A blank cell means that student has not answered enough questions on that topic to say. Click a name
                for their full profile.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-separate border-spacing-0 text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left font-semibold text-slate-500">
                        Student
                      </th>
                      {heatTags.map((t) => (
                        <th key={t.tag} className="px-1 py-1 text-left align-bottom font-medium text-slate-500">
                          <span className="block max-w-[3.5rem] truncate" title={t.tag}>
                            {t.value}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => {
                      const byTag = new Map([...s.rows, ...s.difficultyRows].map((r) => [r.tag, r]));
                      return (
                        <tr key={s.roll}>
                          <td className="sticky left-0 z-10 bg-white py-1 pr-2">
                            <button
                              onClick={() => setOpenStudent(s.roll)}
                              className="max-w-[9rem] truncate text-left font-medium text-slate-800 hover:text-blue-700"
                            >
                              {s.name}
                            </button>
                          </td>
                          {heatTags.map((t) => {
                            const cell = byTag.get(t.tag);
                            const enough = cell && cell.attempted >= minEvidence;
                            return (
                              <td key={t.tag} className="p-0.5">
                                <div
                                  title={
                                    cell
                                      ? `${s.name} — ${t.value}: ${fmt(cell.percent)}% over ${cell.attempted} questions`
                                      : `${s.name} — ${t.value}: not tested`
                                  }
                                  className="flex h-7 items-center justify-center rounded text-[10px] font-semibold tabular-nums"
                                  style={
                                    enough
                                      ? { background: barColour(cell!.percent, passMark), color: "#fff" }
                                      : { background: "#f1f5f9", color: "#94a3b8" }
                                  }
                                >
                                  {enough ? Math.round(cell!.percent) : cell ? "·" : ""}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ---------- pick students for a group report ---------- */}
          {students.length > 1 && (
            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="font-bold text-slate-900">Report on a group</h2>
              <p className="mt-1 text-sm text-slate-500">
                Tick a few students and rebuild to compare them only against each other — useful for a tutorial
                group or a set you have pulled out for extra work.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {students.map((s) => {
                  const on = focus.includes(s.roll);
                  return (
                    <button
                      key={s.roll}
                      onClick={() => setFocus(on ? focus.filter((r) => r !== s.roll) : [...focus, s.roll])}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium ${on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
                    >
                      {s.name} · {fmt(s.percent)}%
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => run(focus)}
                  disabled={!focus.length || loading}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Report on {focus.length || "…"} selected
                </button>
                {focus.length > 0 && (
                  <button
                    onClick={() => {
                      setFocus([]);
                      run();
                    }}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    Back to everyone
                  </button>
                )}
              </div>
            </section>
          )}

          {/* ---------- individual profiles ---------- */}
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-bold text-slate-900">Individual profiles</h2>
            <div className="mt-3 divide-y divide-slate-100">
              {students.map((s) => (
                <div key={s.roll}>
                  <button
                    onClick={() => setOpenStudent(openStudent === s.roll ? null : s.roll)}
                    className="flex w-full items-center gap-3 py-3 text-left"
                  >
                    <span className="flex-1 truncate">
                      <span className="font-semibold text-slate-900">{s.name}</span>
                      <span className="ml-2 text-xs text-slate-400">
                        {s.roll} · {semesterLabel(s.semester)} · {s.quizzesSat} quiz
                        {s.quizzesSat === 1 ? "" : "zes"}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{fmt(s.percent)}%</span>
                    <span className="shrink-0 text-xs text-slate-400">{openStudent === s.roll ? "hide" : "open"}</span>
                  </button>
                  {openStudent === s.roll && profile && <Profile profile={profile} passMark={passMark} />}
                </div>
              ))}
              {!students.length && (
                <p className="py-3 text-sm text-slate-400">Nobody has submitted to the quizzes you picked.</p>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function Profile({ profile, passMark }: { profile: StudentProfile; passMark: number }) {
  const [showMisses, setShowMisses] = useState(false);

  return (
    <div className="pb-5">
      <div className="rounded-xl bg-slate-50 p-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <p className="text-slate-600">
            <span className="font-semibold text-slate-900">{profile.correct}</span> of {profile.attempted} auto-marked
            questions right
          </p>
          <p className="text-slate-600">
            Overall <span className="font-semibold text-slate-900">{fmt(profile.percent)}%</span>
          </p>
          {profile.nameVariants.length > 1 && (
            <p className="text-slate-400">also submitted as {profile.nameVariants.slice(1).join(", ")}</p>
          )}
        </div>

        {profile.quizLines.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {profile.quizLines.map((line) => (
              <span key={line.quizId} className="rounded bg-white px-2 py-1 text-xs text-slate-600">
                {fmt(line.percent)}%
                {line.viaGroup && <span className="ml-1 text-slate-400">({line.viaGroup})</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-emerald-700">Strengths</h4>
          <div className="mt-1 divide-y divide-slate-100">
            {profile.strengths.length ? (
              profile.strengths.map((r) => <TagRowView key={r.tag} row={r} passMark={passMark} />)
            ) : (
              <p className="py-2 text-sm text-slate-400">
                Nothing stands out above their own average yet — an even performance across topics.
              </p>
            )}
          </div>
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-rose-700">Weaknesses</h4>
          <div className="mt-1 divide-y divide-slate-100">
            {profile.weaknesses.length ? (
              profile.weaknesses.map((r) => <TagRowView key={r.tag} row={r} passMark={passMark} />)
            ) : (
              <p className="py-2 text-sm text-slate-400">
                No topic is meaningfully below their own average or below the pass mark.
              </p>
            )}
          </div>
        </div>
      </div>

      {profile.difficultyRows.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">By difficulty</h4>
          <div className="mt-1 divide-y divide-slate-100">
            {[...profile.difficultyRows]
              .sort((a, b) => a.value.localeCompare(b.value))
              .map((r) => (
                <div key={r.tag} className="flex items-center gap-3 py-2">
                  <p className="w-36 shrink-0 truncate text-sm text-slate-700">{r.value}</p>
                  <div className="flex-1">
                    <Bar percent={r.percent} passMark={passMark} />
                  </div>
                  <p className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-500">
                    {fmt(r.percent)}% of {r.attempted}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-slate-400">
          Everything measured ({profile.rows.length} topics)
        </summary>
        <div className="mt-2 space-y-4">
          {groupByDimension(profile.rows).map((group) => (
            <div key={group.dimension}>
              <h5 className="text-xs font-semibold text-slate-500">{group.dimension}</h5>
              <div className="divide-y divide-slate-100">
                {group.rows.map((r) => (
                  <TagRowView key={r.tag} row={r} passMark={passMark} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>

      {profile.insufficient.length > 0 && (
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">Not tested enough to say:</span>{" "}
          {profile.insufficient.map((r) => `${r.value} (${r.attempted})`).join(", ")}. Ask more questions on these
          before drawing a conclusion.
        </p>
      )}

      {profile.misses.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowMisses((v) => !v)}
            className="text-xs font-semibold text-blue-700 hover:underline"
          >
            {showMisses ? "Hide" : "Show"} the {profile.misses.length} questions they got wrong on weak topics
          </button>
          {showMisses && (
            <ul className="mt-2 space-y-1.5">
              {profile.misses.map((m) => (
                <li key={`${m.quizId}-${m.qid}`} className="rounded-lg border border-slate-200 p-2.5 text-xs">
                  <p className="text-slate-800">{m.text}</p>
                  <p className="mt-1 text-slate-400">
                    {m.quizTitle}
                    {m.tags.length > 0 && ` · ${m.tags.join(" · ")}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
