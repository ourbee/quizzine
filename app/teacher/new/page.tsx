"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import { parseJsonText, parsePastedText, parseSheetRows } from "@/lib/parsers";
import { validateQuestions } from "@/lib/validate";
import { AI_PROMPT } from "@/lib/aiprompt";
import { THEMES } from "@/lib/themes";
import type { ParsedQuiz, Question, TimerMode } from "@/lib/types";
import Media from "@/components/Media";

type Step = "intake" | "review" | "settings" | "done";

const TEMPLATE_HEADERS = [
  "Question", "Type", "OptionA", "OptionB", "OptionC", "OptionD",
  "CorrectAnswer", "FeedbackA", "FeedbackB", "FeedbackC", "FeedbackD",
  "Points", "MediaURL", "Passage",
];

const TEMPLATE_ROWS = [
  {
    Question: "Which word is a synonym of 'ubiquitous'?",
    Type: "mcq", OptionA: "Rare", OptionB: "Omnipresent", OptionC: "Fragile", OptionD: "Ancient",
    CorrectAnswer: "B",
    FeedbackA: "'Rare' is close to an antonym — ubiquitous things are found everywhere, not seldom.",
    FeedbackB: "Correct: 'ubiquitous' means present everywhere at once, i.e. omnipresent.",
    FeedbackC: "'Fragile' describes physical delicacy, not how widespread something is.",
    FeedbackD: "'Ancient' refers to age, not distribution.",
    Points: 1, MediaURL: "", Passage: "",
  },
  {
    Question: "In two or three sentences, explain the difference between a metaphor and a simile.",
    Type: "short", OptionA: "", OptionB: "", OptionC: "", OptionD: "",
    CorrectAnswer: "", FeedbackA: "", FeedbackB: "", FeedbackC: "", FeedbackD: "",
    Points: 2, MediaURL: "", Passage: "",
  },
];

export default function NewQuizPage() {
  const [step, setStep] = useState<Step>("intake");
  const [tab, setTab] = useState<"upload" | "paste">("upload");
  const [pasted, setPasted] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [theme, setTheme] = useState("slate");
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [timerMode, setTimerMode] = useState<TimerMode>("none");
  const [maxMinutes, setMaxMinutes] = useState("15");
  const [perQuestionSeconds, setPerQuestionSeconds] = useState("45");
  const [closesAt, setClosesAt] = useState("");
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [introMedia, setIntroMedia] = useState("");

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [published, setPublished] = useState<{ slug: string } | null>(null);
  const [qr, setQr] = useState("");

  const totalPoints = useMemo(() => questions.reduce((s, q) => s + q.points, 0), [questions]);

  function applyParsed(parsed: ParsedQuiz, fallbackTitle?: string) {
    const result = validateQuestions(parsed);
    setErrors(result.errors);
    setWarnings(result.warnings);
    setQuestions(result.questions);
    if (parsed.title) setTitle(parsed.title);
    else if (fallbackTitle && !title) setTitle(fallbackTitle);
    if (parsed.description) setDescription(parsed.description);
    setStep("review");
  }

  async function handleFile(file: File) {
    setParseError("");
    try {
      const name = file.name.replace(/\.[^.]+$/, "");
      if (/\.(xlsx|xls|csv)$/i.test(file.name)) {
        const wb = XLSX.read(await file.arrayBuffer());
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        applyParsed(parseSheetRows(rows), name);
      } else if (/\.json$/i.test(file.name)) {
        applyParsed(parseJsonText(await file.text()), name);
      } else {
        applyParsed(parsePastedText(await file.text()), name);
      }
    } catch (err) {
      setParseError(`Could not read the file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handlePaste() {
    setParseError("");
    if (!pasted.trim()) {
      setParseError("Paste your quiz content first.");
      return;
    }
    try {
      applyParsed(parsePastedText(pasted));
    } catch (err) {
      setParseError(`Could not parse the pasted text: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet(TEMPLATE_ROWS, { header: TEMPLATE_HEADERS });
    ws["!cols"] = TEMPLATE_HEADERS.map((h) => ({ wch: h === "Question" || h.startsWith("Feedback") ? 40 : 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Questions");
    XLSX.writeFile(wb, "quizdeck-template.xlsx");
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(AI_PROMPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function publish() {
    setPublishing(true);
    setPublishError("");
    const res = await fetch("/api/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        introMedia,
        questions,
        theme,
        settings: {
          shuffleQuestions,
          shuffleOptions,
          timerMode,
          maxMinutes: timerMode === "quiz" ? Number(maxMinutes) : undefined,
          perQuestionSeconds: timerMode === "question" ? Number(perQuestionSeconds) : undefined,
          closesAt: closesAt ? new Date(closesAt).toISOString() : undefined,
          allowMultiple,
        },
      }),
    });
    setPublishing(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setPublishError(data.error ?? `Publish failed (${res.status}). Are you still signed in?`);
      return;
    }
    const data = await res.json();
    setPublished({ slug: data.slug });
    const url = `${window.location.origin}/q/${data.slug}`;
    setQr(await QRCode.toDataURL(url, { width: 480, margin: 1 }));
    setStep("done");
  }

  const quizUrl = published ? `${typeof window !== "undefined" ? window.location.origin : ""}/q/${published.slug}` : "";

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">New quiz</h1>
        <Link href="/teacher" className="text-sm text-slate-500 hover:text-slate-800">← Dashboard</Link>
      </div>
      <ol className="mt-3 flex gap-2 text-xs font-medium text-slate-400">
        {(["intake", "review", "settings", "done"] as Step[]).map((s, i) => (
          <li key={s} className={`rounded-full px-3 py-1 ${step === s ? "bg-blue-700 text-white" : "bg-slate-100"}`}>
            {i + 1}. {s === "intake" ? "Add questions" : s === "review" ? "Check & preview" : s === "settings" ? "Settings" : "Share"}
          </li>
        ))}
      </ol>

      {step === "intake" && (
        <section className="mt-8 space-y-6">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm text-blue-900 font-medium">Workflow</p>
            <p className="text-sm text-blue-800 mt-1">
              1. Copy the AI prompt below into ChatGPT, Claude or Gemini (attach your source material if any). 2. Upload
              or paste the file it returns. 3. Review everything in the preview here — ask the AI for a corrected file if
              something is off.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={copyPrompt} className="rounded-lg bg-blue-700 px-4 py-2 text-sm text-white font-semibold hover:bg-blue-800">
                {copied ? "Copied ✓" : "Copy AI prompt"}
              </button>
              <button onClick={() => setShowPrompt((v) => !v)} className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-100">
                {showPrompt ? "Hide prompt" : "View prompt"}
              </button>
              <button onClick={downloadTemplate} className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-100">
                Download Excel template
              </button>
            </div>
            {showPrompt && (
              <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-white border border-blue-200 p-3 text-xs whitespace-pre-wrap text-slate-700">{AI_PROMPT}</pre>
            )}
          </div>

          <div className="flex gap-2 text-sm font-semibold">
            <button onClick={() => setTab("upload")} className={`rounded-lg px-4 py-2 ${tab === "upload" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
              Upload a file
            </button>
            <button onClick={() => setTab("paste")} className={`rounded-lg px-4 py-2 ${tab === "paste" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
              Paste text / JSON
            </button>
          </div>

          {tab === "upload" ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
              onClick={() => fileInput.current?.click()}
              className={`cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition ${
                dragOver ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-white hover:border-slate-400"
              }`}
            >
              <p className="font-semibold text-slate-700">Drop your quiz file here, or click to browse</p>
              <p className="text-sm text-slate-500 mt-1">.xlsx, .csv, .json, .txt or .md — following the template</p>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.xls,.csv,.json,.txt,.md"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = "";
                }}
              />
            </div>
          ) : (
            <div>
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={12}
                placeholder={'Paste the AI\'s final output here — JSON, or the plain-text block format:\n\nQ: What is ...?\nType: mcq\nA: ...\nB: ...\nFA: feedback for A\nCorrect: B\nPoints: 1'}
                className="w-full rounded-xl border border-slate-300 bg-white p-4 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={handlePaste} className="mt-3 rounded-lg bg-blue-700 px-5 py-2.5 text-white font-semibold hover:bg-blue-800">
                Parse questions
              </button>
            </div>
          )}
          {parseError && <p className="text-sm text-red-600">{parseError}</p>}
        </section>
      )}

      {step === "review" && (
        <section className="mt-8 space-y-5">
          {errors.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="font-semibold text-red-800 text-sm">Fix these before publishing ({errors.length})</p>
              <ul className="mt-2 space-y-1 text-sm text-red-700 list-disc list-inside">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="font-semibold text-amber-800 text-sm">Worth checking ({warnings.length})</p>
              <ul className="mt-2 space-y-1 text-sm text-amber-700 list-disc list-inside">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {questions.length > 0 && (
            <>
              <div className="grid gap-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Quiz title (shown to students)"
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Instructions / description (optional)"
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <p className="text-sm text-slate-500">
                {questions.length} questions · {totalPoints} points. This is how they will read (correct answers marked here only — students never receive them before submitting).
              </p>
              <div className="space-y-4">
                {questions.map((qn, i) => (
                  <div key={qn.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold text-slate-400">Q{i + 1} · {qn.type.toUpperCase()} · {qn.points} pt</p>
                    {qn.passage && <p className="mt-2 text-sm bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-700">{qn.passage}</p>}
                    <p className="mt-1.5 font-medium text-slate-900">{qn.text}</p>
                    <Media url={qn.media} compact />
                    {qn.type === "mcq" ? (
                      <ul className="mt-2 space-y-1.5">
                        {qn.options.map((o) => (
                          <li key={o.key} className={`text-sm rounded-lg px-3 py-1.5 border ${o.key === qn.correct ? "border-green-300 bg-green-50 text-green-900" : "border-slate-200 text-slate-700"}`}>
                            <span className="font-semibold">{o.key}.</span> {o.text}
                            {o.key === qn.correct && <span className="ml-1 text-xs font-semibold">✓ correct</span>}
                            {o.feedback && <p className="text-xs text-slate-500 mt-0.5">↳ {o.feedback}</p>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm italic text-slate-500">Typed answer — graded by you later.</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStep("intake")} className="rounded-lg border border-slate-300 px-5 py-2.5 font-semibold text-slate-700 hover:bg-slate-100">
              ← Back
            </button>
            <button
              onClick={() => setStep("settings")}
              disabled={errors.length > 0 || questions.length === 0 || !title.trim()}
              className="rounded-lg bg-blue-700 px-5 py-2.5 text-white font-semibold hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue to settings →
            </button>
          </div>
          {!title.trim() && questions.length > 0 && errors.length === 0 && (
            <p className="text-xs text-slate-500">Add a title to continue.</p>
          )}
        </section>
      )}

      {step === "settings" && (
        <section className="mt-8 space-y-6">
          <div>
            <p className="font-semibold text-slate-900 text-sm">Theme</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition ${theme === t.id ? "border-blue-600" : "border-transparent"}`}
                  style={{ background: t.bg, color: t.text }}
                >
                  <span className="inline-block w-3 h-3 rounded-full mr-1.5 align-middle" style={{ background: t.accent }} />
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <input type="checkbox" checked={shuffleQuestions} onChange={(e) => setShuffleQuestions(e.target.checked)} className="w-4 h-4" />
              Shuffle question order per student
            </label>
            <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <input type="checkbox" checked={shuffleOptions} onChange={(e) => setShuffleOptions(e.target.checked)} className="w-4 h-4" />
              Shuffle options per student
            </label>
            <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <input type="checkbox" checked={allowMultiple} onChange={(e) => setAllowMultiple(e.target.checked)} className="w-4 h-4" />
              Allow multiple attempts per roll number
            </label>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <p className="font-semibold text-slate-900 text-sm">Timer</p>
            <div className="flex flex-wrap gap-2 text-sm">
              {([["none", "No timer"], ["quiz", "Whole-quiz limit"], ["question", "Per-question countdown"]] as [TimerMode, string][]).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setTimerMode(mode)}
                  className={`rounded-lg px-4 py-2 font-medium ${timerMode === mode ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {timerMode === "quiz" && (
              <label className="block text-sm text-slate-700">
                Maximum minutes once a student starts:{" "}
                <input type="number" min={1} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} className="ml-2 w-24 rounded-lg border border-slate-300 px-3 py-1.5" />
              </label>
            )}
            {timerMode === "question" && (
              <div className="text-sm text-slate-700 space-y-2">
                <label className="block">
                  Seconds per question:{" "}
                  <input type="number" min={5} value={perQuestionSeconds} onChange={(e) => setPerQuestionSeconds(e.target.value)} className="ml-2 w-24 rounded-lg border border-slate-300 px-3 py-1.5" />
                </label>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  Per-question mode shows one question at a time and students cannot go back — like a rapid-fire round.
                </p>
              </div>
            )}
            <label className="block text-sm text-slate-700">
              Stop accepting responses at (optional):{" "}
              <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className="ml-2 rounded-lg border border-slate-300 px-3 py-1.5" />
            </label>
          </div>

          <label className="block text-sm text-slate-700">
            <span className="font-semibold text-slate-900">Intro media (optional)</span> — an image or YouTube video students see before starting (e.g. “watch this, then begin”):
            <input
              value={introMedia}
              onChange={(e) => setIntroMedia(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          {publishError && <p className="text-sm text-red-600">{publishError}</p>}
          <div className="flex gap-3">
            <button onClick={() => setStep("review")} className="rounded-lg border border-slate-300 px-5 py-2.5 font-semibold text-slate-700 hover:bg-slate-100">
              ← Back
            </button>
            <button onClick={publish} disabled={publishing} className="rounded-lg bg-green-700 px-6 py-2.5 text-white font-semibold hover:bg-green-800 disabled:opacity-50">
              {publishing ? "Publishing…" : "Publish quiz"}
            </button>
          </div>
        </section>
      )}

      {step === "done" && published && (
        <section className="mt-8 text-center space-y-5">
          <div className="rounded-xl border border-green-200 bg-green-50 p-6">
            <p className="text-2xl">🎉</p>
            <h2 className="mt-1 text-xl font-bold text-green-900">“{title}” is live</h2>
            <p className="mt-2 text-sm text-green-800">Share this link (or the QR code) with your students:</p>
            <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
              <code className="rounded-lg bg-white border border-green-300 px-3 py-2 text-sm">{quizUrl}</code>
              <button
                onClick={() => navigator.clipboard.writeText(quizUrl)}
                className="rounded-lg bg-green-700 px-4 py-2 text-sm text-white font-semibold hover:bg-green-800"
              >
                Copy link
              </button>
            </div>
          </div>
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code for the quiz link" className="mx-auto w-56 h-56 rounded-xl border border-slate-200 bg-white p-2" />
          )}
          <div className="flex justify-center gap-3">
            <a href={quizUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-300 px-5 py-2.5 font-semibold text-slate-700 hover:bg-slate-100">
              Open as student
            </a>
            <Link href="/teacher" className="rounded-lg bg-blue-700 px-5 py-2.5 text-white font-semibold hover:bg-blue-800">
              Back to dashboard
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
