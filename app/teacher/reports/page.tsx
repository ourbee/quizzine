/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TeacherBar from "@/components/TeacherBar";
import QuizPicker from "@/components/QuizPicker";
import * as XLSX from "xlsx";
import { NO_SEMESTER } from "@/lib/normalize";
import {
  BAND_COLORS,
  DEFAULT_BANDS,
  DEFAULT_OPTIONS,
  bandFor,
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
import {
  QUIZ_LINE_SORTS,
  SEMESTER_QUIZ_SORTS,
  STUDENT_SORTS,
  matchStudent,
  pickQuizzes,
  quizzesForSemester,
  quizzesSatBy,
  quizzesSatBySemester,
  semesterQuizLines,
  semestersPresent,
  semestersSatBy,
  sortSemesterQuizLines,
  sortStudentQuizLines,
  sortStudents,
  studentQuizLines,
  type QuizLineSort,
  type SemesterQuizSort,
  type StudentSort,
} from "@/lib/reportviews";

interface QuizListRow {
  id: string;
  title: string;
  created_at: string;
  responses: string | number;
  accepting?: boolean;
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

/** Matches the cap the reports endpoint applies to a single request. */
const ALL_QUIZ_LIMIT = 100;

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

  // The student and semester views read across every quiz the teacher owns, not
  // just the ones ticked above — "all the quizzes Mary has ever sat" is a
  // different question from "the quizzes in this report".
  const [everything, setEverything] = useState<{ quizzes: ReportQuiz[]; attempts: ReportAttempt[] } | null>(null);
  const [everythingState, setEverythingState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const viewsRef = useRef<HTMLDivElement>(null);
  // The state above only flips once the fetch has started, which is a tick too
  // late to stop a second observer firing in the same frame.
  const everythingAsked = useRef(false);

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

  /**
   * Every quiz's totals, fetched once, for the two views at the foot of the page.
   *
   * It holds off until those views come within a screen of the viewport. On a
   * short page that is immediately; on a term's worth of marks the teacher has
   * to scroll first, and one who only came to print the table above never pays
   * for a term of attempts they will not look at.
   */
  useEffect(() => {
    if (everythingState !== "idle" || !quizzes.length) return;

    const load = async () => {
      if (everythingAsked.current) return;
      everythingAsked.current = true;
      setEverythingState("loading");
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizIds: quizzes.map((z) => z.id).slice(0, ALL_QUIZ_LIMIT) }),
      });
      if (!res.ok) {
        setEverythingState("error");
        return;
      }
      setEverything(await res.json());
      setEverythingState("ready");
    };

    const node = viewsRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      load();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "500px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [everythingState, quizzes]);

  /** The settings the views share with the table above, in one stable object. */
  const viewOptions = useMemo(
    () => ({ weighting, missing, repeats, bands, aliases }),
    [weighting, missing, repeats, bands, aliases]
  );

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
        <h2 className="font-bold text-slate-900">Quizzes in this report</h2>
        <div className="mt-3">
          <QuizPicker
            quizzes={quizzes}
            selected={selected}
            onChange={setSelected}
            storageKey="quizzine.report.quizview"
          />
        </div>
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

      {/* ---------- one student, one semester ---------- */}
      <div ref={viewsRef} className="mt-10 border-t border-slate-200 pt-8">
        {everythingState === "error" ? (
          <p className="text-sm text-red-600">Could not load your other quizzes.</p>
        ) : !everything ? (
          <p className="text-sm text-slate-500">
            {quizzes.length ? "Loading every quiz…" : "Publish a quiz and these views fill in."}
          </p>
        ) : (
          <>
            {quizzes.length > ALL_QUIZ_LIMIT && (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                You have {quizzes.length} quizzes and these two views read your {ALL_QUIZ_LIMIT} most recent.{" "}
                Older ones still appear in the report above when you tick them.
              </p>
            )}
            <StudentView source={everything} quizzes={quizzes} selected={selected} options={viewOptions} />
            <SemesterView source={everything} quizzes={quizzes} selected={selected} options={viewOptions} />
          </>
        )}
      </div>
    </main>
  );
}

interface ViewProps {
  source: { quizzes: ReportQuiz[]; attempts: ReportAttempt[] };
  quizzes: QuizListRow[];
  selected: string[];
  options: {
    weighting: Weighting;
    missing: Missing;
    repeats: Repeats;
    bands: Band[];
    aliases: AliasMap;
  };
}

/** Which quizzes a student's or a semester's figures are drawn from. */
type Scope =
  | { kind: "sat" }
  | { kind: "report" }
  | { kind: "semester"; semester: number }
  | { kind: "custom"; ids: string[] };

function ScopeButton({
  on,
  onClick,
  disabled,
  children,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
        on ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-lg font-bold text-slate-900 tabular-nums">{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/**
 * One student down the page: every quiz they have sat, against the class and
 * against themselves.
 *
 * The scope is the point of it. The same student reads differently over a term,
 * over a semester, or over the three papers of one unit, and a teacher writing
 * a reference needs all three without re-ticking the picker at the top.
 */
function StudentView({ source, quizzes, selected, options }: ViewProps) {
  const [search, setSearch] = useState("");
  const [semFilter, setSemFilter] = useState<number | "all">("all");
  const [sort, setSort] = useState<StudentSort>("name");
  const [openRoll, setOpenRoll] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>({ kind: "sat" });
  const [lineSort, setLineSort] = useState<QuizLineSort>("recent");
  const [picking, setPicking] = useState(false);

  // The roster leaves out quizzes a student never sat whatever the page's own
  // setting says: a list of everyone the teacher has taught is not the place to
  // score a first-year zero on a third-year paper.
  const roster = useMemo(
    () => buildReport(source.quizzes, source.attempts, { ...options, missing: "exclude", semester: "all" }),
    [source, options]
  );

  const semesters = useMemo(
    () => semestersPresent(source.attempts, options.aliases),
    [source, options.aliases]
  );

  const list = useMemo(() => {
    const rows = roster.students.filter(
      (s) =>
        matchStudent(s, search) &&
        // A student who moved up mid-year is listed under both semesters, since
        // either is a fair way to go looking for them.
        (semFilter === "all" || s.semesters.includes(semFilter))
    );
    return sortStudents(rows, sort);
  }, [roster, search, semFilter, sort]);

  const openStudent = openRoll ? roster.students.find((s) => s.roll === openRoll) ?? null : null;
  const satSemesters = useMemo(
    () => (openRoll ? semestersSatBy(openRoll, source.attempts, options.aliases) : []),
    [openRoll, source, options.aliases]
  );

  const scopedIds = useMemo(() => {
    if (!openRoll) return new Set<string>();
    if (scope.kind === "report") return new Set(selected);
    if (scope.kind === "custom") return new Set(scope.ids);
    if (scope.kind === "semester") {
      return quizzesSatBySemester(openRoll, scope.semester, source.attempts, options.aliases);
    }
    return quizzesSatBy(openRoll, source.attempts, options.aliases);
  }, [openRoll, scope, selected, source, options.aliases]);

  const report = useMemo(() => {
    const scoped = pickQuizzes(source.quizzes, scopedIds);
    if (!scoped.length) return null;
    return buildReport(scoped, source.attempts, { ...options, semester: "all" });
  }, [source, scopedIds, options]);

  const row = report && openRoll ? report.students.find((s) => s.roll === openRoll) ?? null : null;
  const lines = useMemo(
    () => (report && openRoll ? sortStudentQuizLines(studentQuizLines(report, openRoll), lineSort) : []),
    [report, openRoll, lineSort]
  );
  const rank = report && row ? report.students.findIndex((s) => s.roll === row.roll) + 1 : 0;
  const classAverage = report?.overall?.average ?? null;
  const marks = lines.map((l) => l.result).filter((r): r is NonNullable<typeof r> => !!r);

  function choose(roll: string) {
    const next = openRoll === roll ? null : roll;
    setOpenRoll(next);
    // A scope that meant something for the last student — semester 5, say — can
    // be empty for this one, so every student starts from their own record.
    setScope({ kind: "sat" });
    setPicking(false);
  }

  return (
    <section>
      <h2 className="text-xl font-bold text-slate-900">One student</h2>
      <p className="mt-1 text-sm text-slate-500">
        Everything one student has done, across as much or as little of the year as you like. Find them by name or
        by roll number; a student who has submitted under two spellings is found under either.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or roll number…"
          aria-label="Search students by name or roll number"
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={semFilter}
          onChange={(e) => setSemFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
          aria-label="Filter students by semester"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
        >
          <option value="all">Every semester</option>
          {semesters.map((n) => (
            <option key={n} value={n}>
              {semLabel(n)}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as StudentSort)}
          aria-label="Sort the students"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
        >
          {STUDENT_SORTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <p className="mt-2 text-xs text-slate-500 print:hidden">
        {list.length} of {roster.students.length} students.{" "}
        Percentages here are each student&apos;s average over everything they have sat.
      </p>

      {list.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Nobody matches that.</p>
      ) : (
        <div className="mt-3 flex max-h-64 flex-wrap gap-1.5 overflow-y-auto print:hidden">
          {list.map((s) => (
            <button
              key={s.roll}
              onClick={() => choose(s.roll)}
              aria-pressed={openRoll === s.roll}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                openRoll === s.roll ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s.name}
              <span className={openRoll === s.roll ? "ml-1.5 text-slate-300" : "ml-1.5 text-slate-400"}>
                {s.roll} · {semLabel(s.semester, false)} · {s.percent}%
              </span>
            </button>
          ))}
        </div>
      )}

      {openStudent && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-lg font-bold text-slate-900">{openStudent.name}</p>
              <p className="text-xs text-slate-500">
                <span className="font-mono">{openStudent.roll}</span> ·{" "}
                {openStudent.semesters.map((n) => semLabel(n, false)).join(", ")}
                {openStudent.nameVariants.length > 1 &&
                  ` · also submitted as ${openStudent.nameVariants.slice(1).join(", ")}`}
              </p>
            </div>
            <button
              onClick={() => setOpenRoll(null)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 print:hidden"
            >
              Close
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 print:hidden">
            <span className="mr-1 text-xs font-medium text-slate-500">Count:</span>
            <ScopeButton on={scope.kind === "sat"} onClick={() => setScope({ kind: "sat" })}>
              Every quiz they sat
            </ScopeButton>
            <ScopeButton
              on={scope.kind === "report"}
              disabled={!selected.length}
              onClick={() => setScope({ kind: "report" })}
            >
              {selected.length ? `The ${selected.length} in this report` : "The report above"}
            </ScopeButton>
            {satSemesters.map((n) => (
              <ScopeButton
                key={n}
                on={scope.kind === "semester" && scope.semester === n}
                onClick={() => setScope({ kind: "semester", semester: n })}
              >
                What they sat in {semLabel(n, false)}
              </ScopeButton>
            ))}
            <ScopeButton
              on={scope.kind === "custom"}
              onClick={() => {
                setScope({ kind: "custom", ids: scope.kind === "custom" ? scope.ids : [...scopedIds] });
                setPicking(true);
              }}
            >
              Chosen quizzes
            </ScopeButton>
            {scope.kind === "custom" && (
              <button
                onClick={() => setPicking((v) => !v)}
                className="text-xs font-semibold text-blue-700 hover:underline"
              >
                {picking ? "Hide the list" : "Change which"}
              </button>
            )}
          </div>

          {scope.kind === "custom" && picking && (
            <div className="mt-3 rounded-lg border border-slate-200 p-3 print:hidden">
              <QuizPicker
                quizzes={quizzes}
                selected={scope.ids}
                onChange={(ids) => setScope({ kind: "custom", ids })}
                storageKey="quizzine.report.studentview"
                columns={1}
                maxHeight="14rem"
              />
            </div>
          )}

          {!row || !report ? (
            <p className="mt-4 text-sm text-slate-500">
              {scopedIds.size
                ? "They have not submitted to any of those quizzes."
                : "No quizzes in that set yet — pick some above."}
            </p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-6">
                <Stat label="Overall" value={`${row.percent}%`} hint={row.band.label} />
                <Stat
                  label="Quizzes sat"
                  value={`${row.attempted}/${report.quizzes.length}`}
                  hint={row.missed ? `${row.missed} missed` : "all of them"}
                />
                <Stat
                  label="Best"
                  value={marks.length ? `${Math.round(Math.max(...marks.map((m) => m.percent)))}%` : "—"}
                />
                <Stat
                  label="Worst"
                  value={marks.length ? `${Math.round(Math.min(...marks.map((m) => m.percent)))}%` : "—"}
                />
                <Stat
                  label="vs the class"
                  value={
                    classAverage === null
                      ? "—"
                      : `${row.percent - classAverage >= 0 ? "+" : ""}${Math.round((row.percent - classAverage) * 10) / 10}`
                  }
                  hint={classAverage === null ? undefined : `class ${classAverage}%`}
                />
                <Stat
                  label="Placed"
                  value={rank ? `${rank} of ${report.students.length}` : "—"}
                  hint={row.groupCount ? `${row.groupCount} via group work` : row.lateCount ? `${row.lateCount} late` : undefined}
                />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-slate-900">Quiz by quiz</h3>
                <select
                  value={lineSort}
                  onChange={(e) => setLineSort(e.target.value as QuizLineSort)}
                  aria-label="Sort this student's quizzes"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 print:hidden"
                >
                  {QUIZ_LINE_SORTS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-2 divide-y divide-slate-100">
                {lines.map((line) => (
                  <div key={line.quiz.id} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                        {line.quiz.title}
                        {line.result?.viaGroup && (
                          <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800">
                            {line.result.viaGroup}
                          </span>
                        )}
                        {line.result?.late && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                            late
                          </span>
                        )}
                      </p>
                      <p className="shrink-0 text-sm font-bold tabular-nums text-slate-900">
                        {line.result ? `${Math.round(line.result.percent)}%` : <span className="text-slate-300">not sat</span>}
                      </p>
                    </div>
                    <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-slate-100">
                      {line.result && (
                        <div
                          className={BAR[bandFor(line.result.percent, normalizeBands(options.bands)).color]}
                          style={{ width: `${Math.max(1, Math.min(100, line.result.percent))}%` }}
                        />
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>{new Date(line.quiz.created_at).toLocaleDateString()}</span>
                      {line.result && (
                        <span className="tabular-nums">
                          {line.result.score} of {line.result.max}
                        </span>
                      )}
                      {line.classAverage !== null && (
                        <span className="tabular-nums">
                          class {line.classAverage}% over {line.classSat} student{line.classSat === 1 ? "" : "s"}
                        </span>
                      )}
                      {line.vsClass !== null && (
                        <span className={line.vsClass >= 0 ? "text-emerald-700" : "text-rose-700"}>
                          {line.vsClass >= 0 ? "+" : ""}
                          {line.vsClass} vs the class
                        </span>
                      )}
                      {line.result && line.result.discarded > 0 && (
                        <span>
                          {line.result.discarded} other attempt{line.result.discarded === 1 ? "" : "s"} set aside
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One semester across the page: how a cohort did, on the papers that cohort sat.
 *
 * A quiz is never labelled with a semester — students declare theirs when they
 * submit — so "the quizzes assigned to semester 3" can only mean the quizzes
 * semester 3 actually sat. That is what the default scope here builds from.
 */
function SemesterView({ source, quizzes, selected, options }: ViewProps) {
  const semesters = useMemo(
    () => semestersPresent(source.attempts, options.aliases),
    [source, options.aliases]
  );
  const [semester, setSemester] = useState<number | null>(null);
  const [scope, setScope] = useState<Scope>({ kind: "sat" });
  const [picking, setPicking] = useState(false);
  const [quizSort, setQuizSort] = useState<SemesterQuizSort>("recent");
  const [studentSort, setStudentSort] = useState<StudentSort>("rank");
  const [search, setSearch] = useState("");

  // The first semester that has any work in it, so the section is never an
  // empty frame waiting to be clicked.
  useEffect(() => {
    setSemester((current) => (current === null ? semesters[0] ?? null : current));
  }, [semesters]);

  const scopedIds = useMemo(() => {
    if (semester === null) return new Set<string>();
    if (scope.kind === "report") return new Set(selected);
    if (scope.kind === "custom") return new Set(scope.ids);
    return quizzesForSemester(semester, source.attempts, options.aliases);
  }, [semester, scope, selected, source, options.aliases]);

  const report = useMemo(() => {
    if (semester === null) return null;
    const scoped = pickQuizzes(source.quizzes, scopedIds);
    if (!scoped.length) return null;
    return buildReport(scoped, source.attempts, { ...options, semester });
  }, [source, scopedIds, semester, options]);

  const summary = report?.overall ?? null;
  const quizLines = useMemo(
    () => (report ? sortSemesterQuizLines(semesterQuizLines(report.quizzes, report.students), quizSort) : []),
    [report, quizSort]
  );
  const students = useMemo(
    () => (report ? sortStudents(report.students.filter((s) => matchStudent(s, search)), studentSort) : []),
    [report, search, studentSort]
  );

  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold text-slate-900">One semester</h2>
      <p className="mt-1 text-sm text-slate-500">
        A cohort and the papers it sat. Nothing here labels a quiz with a semester — students say which semester
        they are in when they submit — so a semester&apos;s quizzes are the ones its students actually took.
      </p>

      {semesters.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No submitted responses yet.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-1.5 print:hidden">
            {semesters.map((n) => (
              <ScopeButton
                key={n}
                on={semester === n}
                onClick={() => {
                  setSemester(n);
                  setScope({ kind: "sat" });
                  setPicking(false);
                }}
              >
                {semLabel(n)}
              </ScopeButton>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 print:hidden">
            <span className="mr-1 text-xs font-medium text-slate-500">Count:</span>
            <ScopeButton on={scope.kind === "sat"} onClick={() => setScope({ kind: "sat" })}>
              Every quiz they sat
            </ScopeButton>
            <ScopeButton
              on={scope.kind === "report"}
              disabled={!selected.length}
              onClick={() => setScope({ kind: "report" })}
            >
              {selected.length ? `The ${selected.length} in this report` : "The report above"}
            </ScopeButton>
            <ScopeButton
              on={scope.kind === "custom"}
              onClick={() => {
                setScope({ kind: "custom", ids: scope.kind === "custom" ? scope.ids : [...scopedIds] });
                setPicking(true);
              }}
            >
              Chosen quizzes
            </ScopeButton>
            {scope.kind === "custom" && (
              <button
                onClick={() => setPicking((v) => !v)}
                className="text-xs font-semibold text-blue-700 hover:underline"
              >
                {picking ? "Hide the list" : "Change which"}
              </button>
            )}
          </div>

          {scope.kind === "custom" && picking && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 print:hidden">
              <QuizPicker
                quizzes={quizzes}
                selected={scope.ids}
                onChange={(ids) => setScope({ kind: "custom", ids })}
                storageKey="quizzine.report.semesterview"
                columns={1}
                maxHeight="14rem"
              />
            </div>
          )}

          {!summary || !report ? (
            <p className="mt-4 text-sm text-slate-500">
              Nobody in {semester === null ? "that semester" : semLabel(semester)} has submitted to those
              quizzes.
            </p>
          ) : (
            <>
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-slate-900">{semLabel(semester!)}</p>
                  <p className="text-sm text-slate-500">
                    {summary.students} student{summary.students === 1 ? "" : "s"} · {report.quizzes.length} quiz
                    {report.quizzes.length === 1 ? "" : "zes"}
                  </p>
                </div>
                {/* The same four figures as the semester cards at the top of the page. */}
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Average" value={`${summary.average}%`} />
                  <Stat label="Median" value={`${summary.median}%`} />
                  <Stat label="Range" value={`${summary.worst}–${summary.best}%`} />
                  <Stat label="Took part" value={`${summary.participation}%`} hint="of all sittings" />
                </div>
                <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100">
                  {summary.bandCounts.map(({ band, count }) => (
                    <div
                      key={band.label}
                      className={BAR[band.color]}
                      style={{ width: `${summary.students ? (count / summary.students) * 100 : 0}%` }}
                      title={`${band.label}: ${count}`}
                    />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                  {summary.bandCounts.map(({ band, count }) => (
                    <span key={band.label}>
                      <span className={`inline-block h-2 w-2 rounded-full align-middle ${BAR[band.color]}`} />{" "}
                      {band.label} {count}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-slate-900">The papers they sat</h3>
                <select
                  value={quizSort}
                  onChange={(e) => setQuizSort(e.target.value as SemesterQuizSort)}
                  aria-label="Sort the papers this semester sat"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 print:hidden"
                >
                  {SEMESTER_QUIZ_SORTS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Quiz</th>
                      <th className="px-3 py-2.5 text-right">Average</th>
                      <th className="px-3 py-2.5 text-right">Median</th>
                      <th className="px-3 py-2.5 text-right">Range</th>
                      <th className="px-3 py-2.5 text-right">Sat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quizLines.map((line) => (
                      <tr key={line.quiz.id} className="border-t border-slate-100">
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-slate-900">{line.quiz.title}</span>
                          <span className="ml-2 text-xs text-slate-400">
                            {new Date(line.quiz.created_at).toLocaleDateString()}
                          </span>
                        </td>
                        {line.sat ? (
                          <>
                            <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{line.average}%</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{line.median}%</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                              {line.worst}–{line.best}%
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                              {line.sat}
                              {line.missed > 0 && <span className="text-slate-400"> (+{line.missed} missed)</span>}
                            </td>
                          </>
                        ) : (
                          <td colSpan={4} className="px-3 py-2.5 text-right text-xs text-slate-400">
                            nobody in this semester sat it
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  The students
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {students.length} of {report.students.length}
                  </span>
                </h3>
                <div className="flex flex-wrap gap-2 print:hidden">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find a student…"
                    aria-label="Find a student in this semester"
                    className="w-44 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={studentSort}
                    onChange={(e) => setStudentSort(e.target.value as StudentSort)}
                    aria-label="Sort the students in this semester"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    {STUDENT_SORTS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5">Roll</th>
                      <th className="px-3 py-2.5">Name</th>
                      <th className="px-3 py-2.5 text-center">Sat</th>
                      <th className="px-3 py-2.5 text-right">Overall</th>
                      <th className="px-3 py-2.5">Band</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.roll} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{s.roll}</td>
                        <td className="px-3 py-2.5 font-medium text-slate-900">{s.name}</td>
                        <td className="px-3 py-2.5 text-center text-slate-600">
                          {s.attempted}/{report.quizzes.length}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{s.percent}%</td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${CHIP[s.band.color]}`}>
                            {s.band.label}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {students.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-sm text-slate-500">
                          Nobody matches that.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
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
