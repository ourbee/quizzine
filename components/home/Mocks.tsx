/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * Small pictures of the app, for the home page.
 *
 * These are drawn in CSS rather than screenshotted. A screenshot of a quiz
 * needs seeded data, goes stale the week after a feature round, and cannot
 * reflow on a phone. These are built from the same shapes the real screens
 * use — `rounded-2xl border p-5 shadow-sm` cards, `rounded-xl border-2`
 * options, the green/amber/red result pills, the exam palette's circles and
 * squares — so they stay honest as long as those do.
 *
 * Everything here is decoration: the surrounding prose carries the meaning,
 * and each mock is hidden from assistive tech.
 */

/** A phone holding one question, mid-attempt. */
export function PhoneQuestion() {
  return (
    <div aria-hidden="true" className="w-[264px] rounded-[2rem] border-[6px] border-slate-900 bg-white shadow-2xl">
      <div className="flex items-center justify-between rounded-t-[1.6rem] border-b border-slate-200 bg-white/90 px-4 py-2.5">
        <span className="text-[11px] font-bold text-slate-900">Paper II · Shakespeare</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">12:04</span>
      </div>
      <div className="space-y-3 bg-slate-50 p-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-bold text-blue-700">Q4</span>
            <span className="text-[10px] font-semibold text-slate-400">2 marks</span>
          </div>
          <p className="mt-1.5 text-[12px] font-semibold leading-snug text-slate-900">
            In which metre is Shakespeare&apos;s Sonnet 18 written?
          </p>
          <div className="mt-3 space-y-1.5">
            {[
              ["A", "Trochaic tetrameter", false],
              ["B", "Iambic pentameter", true],
              ["C", "Anapaestic trimeter", false],
            ].map(([letter, text, picked]) => (
              <div
                key={letter as string}
                className={`flex items-center gap-2.5 rounded-xl border-2 px-2.5 py-2 text-[11px] font-medium ${
                  picked ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200 text-slate-700"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 text-[8px] font-bold ${
                    picked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-400"
                  }`}
                >
                  {letter as string}
                </span>
                <span className="leading-tight">{text as string}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-[10px] font-semibold text-slate-400">Saved</span>
          <span className="rounded-lg bg-blue-700 px-3 py-1.5 text-[10px] font-bold text-white">Next</span>
        </div>
      </div>
    </div>
  );
}

/** The share card: one link, one QR. The QR pattern is fixed, not random. */
const QR_ROWS = [
  "1110111011101110",
  "1000101010001010",
  "1011100110111001",
  "1010010110100101",
  "1110110011101100",
  "0001011000010110",
  "1101001011010010",
  "1010111010101110",
];

export function ShareCard({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`w-[212px] rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xl ${className}`}
    >
      <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Share with the class</p>
      <div className="mt-2 flex items-center gap-3">
        <div className="grid shrink-0 grid-cols-16 gap-[1px] rounded-md bg-white p-1 ring-1 ring-slate-200">
          {QR_ROWS.flatMap((row, y) =>
            row.split("").map((bit, x) => (
              <span
                key={`${y}-${x}`}
                className={`h-[3px] w-[3px] ${bit === "1" ? "bg-slate-900" : "bg-transparent"}`}
              />
            )),
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate font-mono text-[10px] text-slate-500">quizzine.vercel.app/q/</p>
          <p className="truncate font-mono text-[11px] font-bold text-slate-900">sonnets-week-2</p>
        </div>
      </div>
    </div>
  );
}

/** An uploaded file, read back row by row, with one mistake named. */
export function FileCheck() {
  const rows: [string, string, "ok" | "bad"][] = [
    ["Row 2", "MCQ · 4 options · 1 mark", "ok"],
    ["Row 4", "Several correct · 2 marks", "ok"],
    ["Row 5", "No answer marked", "bad"],
    ["Row 6", "Written · rubric attached", "ok"],
  ];
  return (
    <div aria-hidden="true" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
        <span className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-[11px] font-semibold text-slate-700">
          sonnets-unit-2.xlsx
        </span>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
          Written by Claude
        </span>
        <span className="ml-auto text-[11px] font-semibold text-slate-400">18 questions</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map(([row, note, state]) => (
          <li key={row} className="flex items-center gap-3 py-2">
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${
                state === "ok" ? "bg-green-500" : "bg-red-500"
              }`}
            >
              {state === "ok" ? "✓" : "!"}
            </span>
            <span className="w-12 shrink-0 font-mono text-[11px] text-slate-400">{row}</span>
            <span className={`text-[12px] ${state === "ok" ? "text-slate-600" : "font-semibold text-red-700"}`}>
              {note}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The exam interface: a question palette in the shapes the real one uses. */
export function ExamPalette() {
  // answered · marked for review · seen, not answered · untouched
  const states = "aaamaassnnaasnnannsn".split("");
  return (
    <div aria-hidden="true" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <span className="text-[12px] font-bold text-slate-900">Question palette</span>
        <span className="rounded-lg bg-slate-900 px-2.5 py-1 font-mono text-[11px] font-bold text-white">58:12</span>
      </div>
      <div className="mt-3 grid grid-cols-10 gap-1.5">
        {states.map((s, i) => (
          <span
            key={i}
            className={`flex h-6 items-center justify-center text-[10px] font-bold text-white ${
              s === "a"
                ? "rounded-sm bg-green-600"
                : s === "m"
                  ? "rounded-full bg-violet-600"
                  : s === "s"
                    ? "rounded-sm bg-red-500"
                    : "rounded-sm bg-slate-200 text-slate-500"
            }`}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-[10px] font-semibold text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-green-600" /> Answered
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-600" /> Marked for review
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Seen, not answered
        </span>
      </div>
    </div>
  );
}

/** A term in one table, with the teacher's own bands colouring it. */
export function ReportTable() {
  const rows: [string, string, string, string, string, string][] = [
    ["Ananya Sen", "18/20", "16/20", "14/15", "88%", "green"],
    ["Farhan Qureshi", "15/20", "17/20", "12/15", "80%", "green"],
    ["Ishita Rao", "12/20", "11/20", "10/15", "60%", "amber"],
    ["Meera D'Souza", "7/20", "8/20", "6/15", "42%", "red"],
  ];
  const band: Record<string, string> = {
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-700",
  };
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <span className="text-[12px] font-bold text-slate-900">Semester IV · English Honours</span>
        <span className="rounded-lg bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-800">Excel</span>
      </div>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-slate-100 text-[10px] font-bold tracking-wide text-slate-400 uppercase">
            <th className="px-4 py-2">Student</th>
            <th className="px-2 py-2">Quiz 1</th>
            <th className="px-2 py-2">Quiz 2</th>
            <th className="px-2 py-2">Quiz 3</th>
            <th className="px-4 py-2 text-right">Term</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(([name, a, b, c, pct, tone]) => (
            <tr key={name} className="text-[11px]">
              <td className="px-4 py-2 font-semibold whitespace-nowrap text-slate-900">{name}</td>
              <td className="px-2 py-2 font-mono text-slate-500">{a}</td>
              <td className="px-2 py-2 font-mono text-slate-500">{b}</td>
              <td className="px-2 py-2 font-mono text-slate-500">{c}</td>
              <td className="px-4 py-2 text-right">
                <span className={`rounded-full px-2 py-0.5 font-bold ${band[tone]}`}>{pct}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
