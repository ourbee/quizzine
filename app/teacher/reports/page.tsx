/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TeacherBar from "@/components/TeacherBar";
import * as XLSX from "xlsx";
import { NO_SEMESTER } from "@/lib/normalize";
import {
  BAND_COLORS,
  DEFAULT_BANDS,
  DEFAULT_OPTIONS,
  bandRange,
  buildReport,
  normalizeBands,
  suspectPairs,
  type AliasMap,
  type Band,
  type BandColor,
  type BandScheme,
  type Missing,
  type ReportAttempt,
  type ReportQuiz,
  type Repeats,
  type StudentReportRow,
  type Weighting,
} from "@/lib/report";

interface QuizListRow {
  id: string;
  title: string;
  created_at: string;
  responses: string | number;
}

const CHIP: Record<BandColor, string> = {
  emerald: "bg-emerald-100 text-emerald-800",
  blue: "bg-blue-100 text-blue-800",
  indigo: "bg-indigo-100 text-indigo-800",
  amber: "bg-amber-100 text-amber-800",
  rose: "bg-rose-100 text-rose-800",
  slate: "bg-slate-200 text-slate-700",
};

const BAR: Record<BandColor, string> = {
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  slate: "bg-slate-400",
};

const SELECTION_KEY = "quizzine.report.quizIds";

/**
 * Semester labels in a report. 0 is the combined row the report itself adds;
 * -1 is a student who chose "not applicable" when they submitted.
 */
function semLabel(n: number, long = true): string {
  if (n === 0) return "All semesters";
  if (n === NO_SEMESTER) return long ? "No semester" : "N/A";
  return long ? `Semester ${n}` : `Sem ${n}`;
}

export default function ReportsPage() {
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<QuizListRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [source, setSource] = useState<{ quizzes: ReportQuiz[]; attempts: ReportAttempt[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // The saved selection is restored asynchronously; until it lands, writing back
  // would overwrite it with the empty starting state.
  const [restored, setRestored] = useState(false);

  const [weighting, setWeighting] = useState<Weighting>(DEFAULT_OPTIONS.weighting);
  const [missing, setMissing] = useState<Missing>(DEFAULT_OPTIONS.missing);
  const [repeats, setRepeats] = useState<Repeats>(DEFAULT_OPTIONS.repeats);
  const [semester, setSemester] = useState<number | "all">("all");

  const [schemes, setSchemes] = useState<BandScheme[]>([]);
  const [bands, setBands] = useState<Band[]>(DEFAULT_BANDS);
  const [schemeId, setSchemeId] = useState("");
  const [schemeName, setSchemeName] = useState("");
  const [editingBands, setEditingBands] = useState(false);
  const [savingBands, setSavingBands] = useState(false);

  const [aliases, setAliases] = useState<AliasMap>({});
  const [aliasBusy, setAliasBusy] = useState("");

  // Quiz list + saved band schemes.
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/quizzes");
      if (res.status === 401) {
        router.push("/teacher");
        return;
      }
      const data = await res.json();
      setQuizzes(data.quizzes ?? []);
      try {
        const saved = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? "[]");
        if (Array.isArray(saved)) {
          const ids: string[] = (data.quizzes ?? []).map((z: QuizListRow) => z.id);
          setSelected(saved.filter((id: unknown) => typeof id === "string" && ids.includes(id)));
        }
      } catch {
        /* ignore a corrupt selection */
      }
      setRestored(true);

      const aliasRes = await fetch("/api/aliases");
      if (aliasRes.ok) setAliases((await aliasRes.json()).aliases ?? {});

      const bandRes = await fetch("/api/bands");
      if (bandRes.ok) {
        const bandData = await bandRes.json();
        const list: BandScheme[] = bandData.schemes ?? [];
        setSchemes(list);
        const preferred = list.find((s) => s.isDefault) ?? list[0];
        if (preferred) {
          setBands(preferred.bands);
          setSchemeId(preferred.id);
          setSchemeName(preferred.name);
        }
      }
    })();
  }, [router]);

  useEffect(() => {
    if (!restored) return;
    localStorage.setItem(SELECTION_KEY, JSON.stringify(selected));
  }, [selected, restored]);

  const loadReport = useCallback(async (ids: string[]) => {
    if (!ids.length) {
      setSource(null);
      return;
    }
    setLoading(true);
    setError("");
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quizIds: ids }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not build the report.");
      setSource(null);
      return;
    }
    setSource(await res.json());
  }, []);

  useEffect(() => {
    loadReport(selected);
  }, [selected, loadReport]);

  const availableSemesters = useMemo(() => {
    const set = new Set<number>();
    for (const a of source?.attempts ?? []) {
      if (a.group_info) set.add(a.group_info.semester);
      else set.add(a.student.semester);
    }
    return [...set].sort((a, b) => a - b);
  }, [source]);

  const report = useMemo(() => {
    if (!source) return null;
    return buildReport(source.quizzes, source.attempts, { weighting, missing, repeats, bands, semester, aliases });
  }, [source, weighting, missing, repeats, bands, semester, aliases]);

  // One student under two roll numbers. Merges already confirmed are applied
  // first, so a pair only stays on the list until the teacher deals with it.
  const suspects = useMemo(
    () => (source ? suspectPairs(source.attempts, aliases) : []),
    [source, aliases]
  );
  const mergedPairs = useMemo(() => Object.entries(aliases), [aliases]);

  const mergeRolls = useCallback(async (merge: string, keep: string) => {
    setAliasBusy(merge);
    const res = await fetch("/api/aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merge, keep }),
    });
    setAliasBusy("");
    if (res.ok) setAliases((await res.json()).aliases ?? {});
  }, []);

  const unmergeRoll = useCallback(async (variant: string) => {
    setAliasBusy(variant);
    const res = await fetch(`/api/aliases?variant=${encodeURIComponent(variant)}`, { method: "DELETE" });
    setAliasBusy("");
    if (res.ok) setAliases((await res.json()).aliases ?? {});
  }, []);

  const nameClashes = useMemo(
    () => (report?.students ?? []).filter((s) => s.nameVariants.length > 1),
    [report]
  );
  const semesterMovers = useMemo(
    () => (report?.students ?? []).filter((s) => s.semesters.length > 1),
    [report]
  );

  function toggleQuiz(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function updateBand(i: number, patch: Partial<Band>) {
    setBands((prev) => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }

  function addBand() {
    setBands((prev) => {
      const lowest = prev[prev.length - 1]?.min ?? 0;
      const next = [...prev, { label: "New band", min: Math.max(0, lowest - 10), color: "slate" as BandColor }];
      return next;
    });
  }

  function removeBand(i: number) {
    setBands((prev) => (prev.length <= 2 ? prev : prev.filter((_, j) => j !== i)));
  }

  async function saveScheme(asNew: boolean) {
    const name = schemeName.trim() || "My bands";
    setSavingBands(true);
    const res = await fetch("/api/bands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: asNew ? undefined : schemeId || undefined,
        name,
        bands: normalizeBands(bands),
        isDefault: true,
      }),
    });
    setSavingBands(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not save the bands.");
      return;
    }
    const saved: BandScheme = await res.json();
    setSchemeId(saved.id);
    setSchemeName(saved.name);
    setBands(saved.bands);
    const list = await (await fetch("/api/bands")).json();
    setSchemes(list.schemes ?? []);
    setEditingBands(false);
  }

  async function deleteScheme() {
    if (!schemeId) return;
    if (!confirm(`Delete the band scheme "${schemeName}"?`)) return;
    await fetch(`/api/bands?id=${encodeURIComponent(schemeId)}`, { method: "DELETE" });
    const list = await (await fetch("/api/bands")).json();
    const remaining: BandScheme[] = list.schemes ?? [];
    setSchemes(remaining);
    const next = remaining.find((s) => s.isDefault) ?? remaining[0];
    setSchemeId(next?.id ?? "");
    setSchemeName(next?.name ?? "");
    setBands(next?.bands ?? DEFAULT_BANDS);
  }

  function pickScheme(id: string) {
    if (!id) {
      setSchemeId("");
      setSchemeName("");
      setBands(DEFAULT_BANDS);
      return;
    }
    const s = schemes.find((x) => x.id === id);
    if (!s) return;
    setSchemeId(s.id);
    setSchemeName(s.name);
    setBands(s.bands);
  }

  function exportXlsx() {
    if (!report) return;
    const shortTitle = (t: string, i: number) => `Q${i + 1} ${t}`.slice(0, 28);

    const students = report.students.map((s) => {
      const row: Record<string, unknown> = {
        RollNumber: s.roll,
        Name: s.name,
        Semester: semLabel(s.semester, false),
      };
      report.quizzes.forEach((z, i) => {
        const r = s.byQuiz[z.id];
        row[shortTitle(z.title, i)] = r ? Math.round(r.percent * 10) / 10 : "";
      });
      Object.assign(row, {
        Attempted: s.attempted,
        Missed: s.missed,
        TotalScore: s.totalScore,
        TotalMax: s.totalMax,
        OverallPercent: s.percent,
        Band: s.band.label,
        LateSubmissions: s.lateCount,
        ViaGroupWork: s.groupCount,
        OtherNameSpellings: s.nameVariants.slice(1).join(", "),
        OtherSemesters: s.semesters.filter((x) => x !== s.semester).join(", "),
      });
      return row;
    });

    const summaryRows = [...report.semesters, ...(report.overall ? [report.overall] : [])].map((sem) => {
      const row: Record<string, unknown> = {
        Semester: semLabel(sem.semester),
        Students: sem.students,
        AveragePercent: sem.average,
        MedianPercent: sem.median,
        Best: sem.best,
        Worst: sem.worst,
        ParticipationPercent: sem.participation,
      };
      for (const { band, count } of sem.bandCounts) row[band.label] = count;
      return row;
    });

    const perQuiz = report.quizzes.map((z, i) => {
      const row: Record<string, unknown> = {
        Quiz: shortTitle(z.title, i),
        FullTitle: z.title,
        Created: new Date(z.created_at).toLocaleDateString(),
      };
      for (const sem of report.semesters) {
        row[`${semLabel(sem.semester, false)} avg%`] = sem.byQuiz[z.id]?.average ?? "";
        row[`${semLabel(sem.semester, false)} sat`] = sem.byQuiz[z.id]?.sat ?? 0;
      }
      if (report.overall) {
        row["Overall avg%"] = report.overall.byQuiz[z.id]?.average ?? "";
        row["Overall sat"] = report.overall.byQuiz[z.id]?.sat ?? 0;
      }
      return row;
    });

    const settings = [
      { Setting: "Quizzes in report", Value: report.quizzes.length },
      { Setting: "Semester filter", Value: semester === "all" ? "All" : semLabel(semester) },
      {
        Setting: "Weighting",
        Value: weighting === "equal" ? "Each quiz counts equally" : "Every mark counts equally",
      },
      {
        Setting: "Quizzes not sat",
        Value: missing === "exclude" ? "Left out of the average" : "Counted as zero",
      },
      { Setting: "Repeat attempts", Value: repeats === "best" ? "Best attempt counts" : "Latest attempt counts" },
      { Setting: "Band scheme", Value: schemeName || "Default bands" },
      ...normalizeBands(bands).map((b, i) => {
        const [lo, hi] = bandRange(normalizeBands(bands), i);
        return { Setting: `Band: ${b.label}`, Value: `${lo}–${hi}%` };
      }),
      { Setting: "Generated", Value: new Date().toLocaleString() },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(students), "Students");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Semester summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(perQuiz), "Per-quiz averages");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(settings), "Report settings");
    XLSX.writeFile(wb, `quizzine-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const shown = normalizeBands(bands);

  return (
    <main className="max-w-6xl mx-auto px-6 py-10 w-full">
      <div className="print:hidden">
        <TeacherBar />
      </div>
      <div className="mt-2 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Combine any set of quizzes into one performance report, by student and by semester.
            Students are matched on roll number, so spelling differences in names never split a record.
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button
            onClick={() => window.print()}
            disabled={!report?.students.length}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            Print
          </button>
          <button
            onClick={exportXlsx}
            disabled={!report?.students.length}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white font-semibold hover:bg-slate-700 disabled:opacity-40"
          >
            Export Excel
          </button>
          <Link
            href="/teacher/analytics"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 print:hidden"
          >
            Strengths and weaknesses
          </Link>
        </div>
      </div>

      {/* ---------- quiz picker ---------- */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-bold text-slate-900">
            Quizzes in this report
            <span className="ml-2 text-sm font-normal text-slate-500">{selected.length} selected</span>
          </h2>
          <div className="flex gap-2 text-sm">
            <button
              onClick={() => setSelected(quizzes.map((z) => z.id))}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
            >
              Select all
            </button>
            <button
              onClick={() => setSelected([])}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
            >
              Clear
            </button>
          </div>
        </div>
        {quizzes.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No quizzes yet.</p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {quizzes.map((z) => (
              <label
                key={z.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer text-sm ${
                  selected.includes(z.id) ? "border-blue-300 bg-blue-50/60" : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(z.id)}
                  onChange={() => toggleQuiz(z.id)}
                  className="h-4 w-4"
                />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-slate-900 truncate">{z.title}</span>
                  <span className="block text-xs text-slate-500">
                    {Number(z.responses)} response{Number(z.responses) === 1 ? "" : "s"} ·{" "}
                    {new Date(z.created_at).toLocaleDateString()}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      {/* ---------- how marks are combined ---------- */}
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <h2 className="font-bold text-slate-900">How marks are combined</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Weighting</span>
            <select
              value={weighting}
              onChange={(e) => setWeighting(e.target.value as Weighting)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 bg-white"
            >
              <option value="equal">Each quiz counts equally</option>
              <option value="marks">Every mark counts equally</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Quizzes a student never sat</span>
            <select
              value={missing}
              onChange={(e) => setMissing(e.target.value as Missing)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 bg-white"
            >
              <option value="exclude">Leave out of their average</option>
              <option value="zero">Count as zero</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">If a quiz allowed repeats</span>
            <select
              value={repeats}
              onChange={(e) => setRepeats(e.target.value as Repeats)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 bg-white"
            >
              <option value="best">Best attempt counts</option>
              <option value="latest">Latest attempt counts</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Semester</span>
            <select
              value={semester}
              onChange={(e) => setSemester(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 bg-white"
            >
              <option value="all">All semesters</option>
              {availableSemesters.map((n) => (
                <option key={n} value={n}>
                  {semLabel(n)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Group-work quizzes credit the group&apos;s score to every member listed on the submission, so a
          student&apos;s report covers individual and group work together.
        </p>
      </section>

      {/* ---------- bands ---------- */}
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-bold text-slate-900">Performance bands</h2>
          <div className="flex items-center gap-2 text-sm print:hidden">
            <select
              value={schemeId}
              onChange={(e) => pickScheme(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 bg-white"
            >
              <option value="">Default bands</option>
              {schemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isDefault ? " ★" : ""}
                </option>
              ))}
            </select>
            <button
              onClick={() => setEditingBands((v) => !v)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
            >
              {editingBands ? "Done" : "Edit bands"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {shown.map((b, i) => {
            const [lo, hi] = bandRange(shown, i);
            return (
              <span key={`${b.label}-${b.min}`} className={`rounded-full px-3 py-1 text-xs font-semibold ${CHIP[b.color]}`}>
                {b.label} · {lo}–{hi}%
              </span>
            );
          })}
        </div>

        {editingBands && (
          <div className="mt-4 space-y-2 print:hidden">
            {bands.map((b, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap">
                <input
                  value={b.label}
                  onChange={(e) => updateBand(i, { label: e.target.value })}
                  placeholder="Label"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-44 bg-white"
                />
                <span className="text-xs text-slate-500">from</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={b.min}
                  onChange={(e) => updateBand(i, { min: Number(e.target.value) })}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-20 bg-white"
                />
                <span className="text-xs text-slate-500">%</span>
                <select
                  value={b.color}
                  onChange={(e) => updateBand(i, { color: e.target.value as BandColor })}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
                >
                  {BAND_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => removeBand(i)}
                  disabled={bands.length <= 2}
                  className="rounded-lg px-2.5 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-30"
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2 flex-wrap pt-2">
              <button
                onClick={addBand}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                + Add band
              </button>
              <input
                value={schemeName}
                onChange={(e) => setSchemeName(e.target.value)}
                placeholder="Name this scheme"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-52 bg-white"
              />
              <button
                onClick={() => saveScheme(false)}
                disabled={savingBands}
                className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm text-white font-semibold hover:bg-blue-800 disabled:opacity-50"
              >
                {schemeId ? "Save" : "Save scheme"}
              </button>
              {schemeId && (
                <>
                  <button
                    onClick={() => saveScheme(true)}
                    disabled={savingBands}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Save as new
                  </button>
                  <button
                    onClick={deleteScheme}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    Delete scheme
                  </button>
                </>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Each band runs from its cut-off up to the next one. The lowest band is always pulled down to 0%,
              so every student lands in exactly one band.
            </p>
          </div>
        )}
      </section>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {loading && <p className="mt-6 text-sm text-slate-500">Building report…</p>}

      {!loading && !selected.length && (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          <p className="font-medium">Pick the quizzes to report on</p>
          <p className="text-sm mt-1">Tick a term&apos;s worth of quizzes above and the report builds itself.</p>
        </div>
      )}

      {report && !loading && (
        <>
          {report.students.length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">No submitted responses in the selected quizzes.</p>
          ) : (
            <>
              {/* ---------- semester summaries ---------- */}
              <section className="mt-8">
                <h2 className="font-bold text-slate-900">
                  {semester === "all" ? "By semester" : semLabel(semester)}
                </h2>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {[...report.semesters, ...(report.semesters.length > 1 && report.overall ? [report.overall] : [])].map(
                    (sem) => (
                      <div key={sem.semester} className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-semibold text-slate-900">
                            {semLabel(sem.semester)}
                          </p>
                          <p className="text-sm text-slate-500">
                            {sem.students} student{sem.students === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                          {[
                            ["Average", `${sem.average}%`],
                            ["Median", `${sem.median}%`],
                            ["Range", `${sem.worst}–${sem.best}%`],
                            ["Took part", `${sem.participation}%`],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <p className="text-base font-bold text-slate-900">{value}</p>
                              <p className="text-[11px] text-slate-500">{label}</p>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100">
                          {sem.bandCounts.map(({ band, count }) => (
                            <div
                              key={band.label}
                              className={BAR[band.color]}
                              style={{ width: `${sem.students ? (count / sem.students) * 100 : 0}%` }}
                              title={`${band.label}: ${count}`}
                            />
                          ))}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                          {sem.bandCounts.map(({ band, count }) => (
                            <span key={band.label}>
                              <span className={`inline-block h-2 w-2 rounded-full align-middle ${BAR[band.color]}`} />{" "}
                              {band.label} {count}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </section>

              {/* ---------- per-quiz averages ---------- */}
              <section className="mt-8">
                <h2 className="font-bold text-slate-900">Quiz by quiz</h2>
                <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5">Quiz</th>
                        {report.semesters.map((s) => (
                          <th key={s.semester} className="px-4 py-2.5 whitespace-nowrap">
                            {semLabel(s.semester, false)}
                          </th>
                        ))}
                        <th className="px-4 py-2.5">All</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.quizzes.map((z, i) => (
                        <tr key={z.id} className="border-t border-slate-100">
                          <td className="px-4 py-2.5">
                            <span className="text-slate-400 font-semibold">Q{i + 1}.</span>{" "}
                            <span className="font-medium text-slate-900">{z.title}</span>
                            {z.group_mode && (
                              <span className="ml-2 rounded-full bg-violet-100 text-violet-800 px-2 py-0.5 text-[11px] font-medium">
                                group
                              </span>
                            )}
                            {report.emptyQuizzes.includes(z.id) && (
                              <span className="ml-2 text-xs text-slate-400">no responses</span>
                            )}
                          </td>
                          {report.semesters.map((s) => (
                            <td key={s.semester} className="px-4 py-2.5 whitespace-nowrap">
                              {s.byQuiz[z.id]?.sat ? (
                                <>
                                  {s.byQuiz[z.id].average}%{" "}
                                  <span className="text-xs text-slate-400">({s.byQuiz[z.id].sat})</span>
                                </>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          ))}
                          <td className="px-4 py-2.5 font-semibold whitespace-nowrap">
                            {report.overall?.byQuiz[z.id]?.sat ? `${report.overall.byQuiz[z.id].average}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ---------- students ---------- */}
              <section className="mt-8">
                <h2 className="font-bold text-slate-900">
                  Students
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    {report.students.length} matched by roll number
                  </span>
                </h2>
                <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-2.5">Roll</th>
                        <th className="px-3 py-2.5">Name</th>
                        <th className="px-3 py-2.5">Sem</th>
                        {report.quizzes.map((_, i) => (
                          <th key={i} className="px-2 py-2.5 text-center whitespace-nowrap">
                            Q{i + 1}
                          </th>
                        ))}
                        <th className="px-3 py-2.5 text-center">Sat</th>
                        <th className="px-3 py-2.5 text-right">Overall</th>
                        <th className="px-3 py-2.5">Band</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.students.map((s) => (
                        <StudentRow key={s.roll} student={s} quizIds={report.quizzes.map((z) => z.id)} total={report.quizzes.length} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {(suspects.length > 0 || mergedPairs.length > 0) && (
                <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm">
                  <p className="font-semibold text-slate-900">Roll numbers</p>
                  <p className="mt-1 text-slate-500">
                    A student who writes their class roll on one test and their university roll on the next appears
                    twice here, with half their work under each. Merging joins them in every report from now on. The
                    responses themselves are never changed, so you can undo this at any time.
                  </p>

                  {suspects.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {suspects.map((p) => (
                        <li
                          key={`${p.keep}-${p.merge}`}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
                        >
                          <span className="text-slate-700">
                            <span className="font-semibold">{p.name}</span> · {semLabel(p.semester, false)} — roll{" "}
                            <span className="font-mono font-semibold">{p.keep}</span> on {p.keepQuizzes} quiz
                            {p.keepQuizzes === 1 ? "" : "zes"} and{" "}
                            <span className="font-mono font-semibold">{p.merge}</span> on {p.mergeQuizzes}, never on
                            the same one.
                          </span>
                          <button
                            onClick={() => mergeRolls(p.merge, p.keep)}
                            disabled={aliasBusy === p.merge}
                            className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            {aliasBusy === p.merge ? "Merging…" : `Same student — use ${p.keep}`}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {mergedPairs.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Merged</p>
                      <ul className="mt-1.5 space-y-1.5">
                        {mergedPairs.map(([variant, canonical]) => (
                          <li key={variant} className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-slate-600">
                              <span className="font-mono">{variant}</span> counts as{" "}
                              <span className="font-mono font-semibold">{canonical}</span>
                            </span>
                            <button
                              onClick={() => unmergeRoll(variant)}
                              disabled={aliasBusy === variant}
                              className="text-xs font-semibold text-slate-500 underline disabled:opacity-50"
                            >
                              {aliasBusy === variant ? "Undoing…" : "Undo"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              )}

              {(nameClashes.length > 0 || semesterMovers.length > 0) && (
                <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm">
                  <p className="font-semibold text-amber-900">Worth a look</p>
                  {nameClashes.length > 0 && (
                    <p className="mt-1 text-amber-900">
                      {nameClashes.length} roll number{nameClashes.length === 1 ? " was" : "s were"} entered under
                      more than one spelling — the most recent is shown. For example{" "}
                      {nameClashes
                        .slice(0, 3)
                        .map((s) => `${s.roll} (${s.nameVariants.join(" / ")})`)
                        .join("; ")}
                      .
                    </p>
                  )}
                  {semesterMovers.length > 0 && (
                    <p className="mt-1 text-amber-900">
                      {semesterMovers.length} student{semesterMovers.length === 1 ? "" : "s"} submitted under more
                      than one semester; the most frequent one is used for grouping.
                    </p>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}

function StudentRow({
  student,
  quizIds,
  total,
}: {
  student: StudentReportRow;
  quizIds: string[];
  total: number;
}) {
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50">
      <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{student.roll}</td>
      <td className="px-3 py-2.5 font-medium text-slate-900">
        {student.name}
        {student.nameVariants.length > 1 && (
          <span
            className="ml-1 text-amber-600"
            title={`Also submitted as: ${student.nameVariants.slice(1).join(", ")}`}
          >
            *
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">{student.semester}</td>
      {quizIds.map((id) => {
        const r = student.byQuiz[id];
        return (
          <td key={id} className="px-2 py-2.5 text-center whitespace-nowrap">
            {r ? (
              <span title={r.viaGroup ? `Group: ${r.viaGroup}` : undefined}>
                {Math.round(r.percent)}%{r.viaGroup && <span className="text-violet-500">ᵍ</span>}
                {r.late && <span className="text-amber-500">ˡ</span>}
              </span>
            ) : (
              <span className="text-slate-300">—</span>
            )}
          </td>
        );
      })}
      <td className="px-3 py-2.5 text-center text-slate-600">
        {student.attempted}/{total}
      </td>
      <td className="px-3 py-2.5 text-right font-semibold">{student.percent}%</td>
      <td className="px-3 py-2.5">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${CHIP[student.band.color]}`}>
          {student.band.label}
        </span>
      </td>
    </tr>
  );
}
