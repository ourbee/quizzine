import Link from "next/link";

const FEATURES: [string, string][] = [
  ["AI-friendly intake", "Generate questions with ChatGPT, Claude or Gemini using the built-in prompt, then upload the Excel/JSON/text file — the quiz builds itself."],
  ["Several quizzes at once", "One workbook with a sheet per quiz, or a Google Apps Script that builds several Forms, becomes several quizzes — each with its own link and QR code."],
  ["Server-side grading", "Answer keys never reach the browser. Students see their score and per-option feedback only after submitting."],
  ["Timers & shuffling", "Whole-quiz or per-question countdowns, closing times, and per-student question/option shuffling."],
  ["Media questions", "Attach images, audio clips or YouTube videos to any question — or set an intro video students watch before starting."],
  ["Feedback that teaches", "Every option carries feedback, so a wrong answer explains itself. Students can print or save their response copy."],
  ["Teacher dashboard", "Live responses, item analysis with distractor breakdowns, duplicate detection, and one-click Excel export."],
];

export default function Home() {
  return (
    <main className="max-w-4xl mx-auto px-6 py-16 w-full">
      <div className="text-center">
        <p className="text-sm font-semibold tracking-widest text-blue-700 uppercase">Quizzine</p>
        <h1 className="mt-3 text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
          From your questions
          <br className="hidden sm:block" /> to a live quiz in one upload.
        </h1>
        <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
          A Google Forms alternative built for teachers: draft questions with any AI tool, review and edit locally if
          needed, upload the file, share a link or QR code — students get an auto-graded quiz with real feedback.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/teacher"
            className="rounded-lg bg-blue-700 px-6 py-3 text-white font-semibold shadow hover:bg-blue-800 transition"
          >
            Teacher dashboard
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-500">Students only need the quiz link — no account, nothing to install.</p>
      </div>

      <div className="mt-16 grid sm:grid-cols-2 gap-5">
        {FEATURES.map(([title, body]) => (
          <div key={title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900">{title}</h2>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
