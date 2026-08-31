/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import Link from "next/link";
import Logo, { LogoMark } from "@/components/Logo";
import { PhoneQuestion, ShareCard, FileCheck, ExamPalette, ReportTable } from "@/components/home/Mocks";

/**
 * The home page.
 *
 * It is arranged as seven sections that alternate ground — white, slate,
 * white, dark, slate, white, blue — so they separate by field rather than by
 * yet another bordered card. Only things that are genuinely cards get a
 * border; the feature list is hairlines and the steps are a rule.
 */

const STEPS: [string, string][] = [
  ["Write the questions", "Type them, or let a chatbot draft the file."],
  ["Upload the file", "Excel, CSV, JSON or Apps Script — every row checked."],
  ["Share one link", "A link and a QR code. Students open it and start."],
  ["Read the marks", "Scored on submission, reported before the class leaves."],
];

const MODES: [string, string][] = [
  ["Marked quiz", "MCQs, several-correct questions, and written answers with rubrics."],
  ["Survey or poll", "Nothing scored. Students see a confirmation, you see the spread."],
  ["Group work", "One submission per group, every member named and credited."],
  ["Peer review", "Classmates mark each other, double-blind. The average stands."],
];

const LISTS: { title: string; items: string[] }[] = [
  {
    title: "Setting the paper",
    items: [
      "Excel, CSV, JSON, plain text or Apps Script",
      "Several quizzes out of one file",
      "Passages shared by a run of questions",
      "Images, audio and YouTube on any question",
    ],
  },
  {
    title: "Running it",
    items: [
      "Timers for the paper or for each question",
      "A deadline that closes the link",
      "A different question order for every student",
      "One attempt per student, held on the roll number",
      "Adaptive papers, drawn harder or easier as they go",
    ],
  },
  {
    title: "Marking",
    items: [
      "Scored on the server — the key never reaches the browser",
      "Feedback on every option, right or wrong",
      "Written answers marked beside your rubric",
      "A mark you set by hand overrides the rest",
    ],
  },
  {
    title: "Reporting",
    items: [
      "A term of quizzes in one table",
      "Bands, cut-offs and colours you define",
      "Item analysis with distractor bars",
      "Excel export of responses and reports",
    ],
  },
];

const SMALL_PRINT: [string, string][] = [
  ["Apps Script, safely", "Your Forms builder script is read in a sandbox. Nothing is sent to Google."],
  ["Two roll numbers, one student", "College roll one term, university roll the next — the report spots the pair and you confirm it."],
  ["Allotted tests", "Hand a quiz to a named set of students and see who still owes you an attempt."],
  ["Marking packages", "Copy one question, one student or a whole quiz out for an AI reviewer, and paste the marks back."],
  ["Tagged questions", "Tag by topic and see how the class does per topic, across quizzes."],
  ["Your quizzes are yours", "Sign in with Google or a passcode. Nobody else sees what you have set."],
];

const FAQS: [string, string][] = [
  [
    "How is this different from Google Forms?",
    "Forms collects answers; everything after that is yours to build. Quizzine marks on submission, folds a term into one report, runs group work and peer review, and gives students a real exam interface — with no Google account needed to sit the paper.",
  ],
  [
    "Do students need an account?",
    "No. They open the link, give their name and roll number, and answer. Nothing to install on a lab machine or a phone.",
  ],
  [
    "What does it cost?",
    "Nothing. Quizzine is a personal project, built for a department that needed it, with no plan or billing attached.",
  ],
  [
    "Where do the answers sit?",
    "In the app's own database. Answer keys stay on the server, so the page cannot be read for the answers before a student submits.",
  ],
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3 text-xs font-bold tracking-[0.18em] text-blue-700 uppercase">
      <span className="h-px w-8 bg-blue-300" />
      {children}
    </p>
  );
}

export default function Home() {
  return (
    <main className="w-full">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Logo size={28} />
          <Link
            href="/teacher"
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
          >
            Teacher dashboard
          </Link>
        </div>
      </header>

      {/* 1 · Hero */}
      <section className="overflow-hidden border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-12 lg:grid-cols-[1.15fr_0.85fr] lg:py-16">
          <div>
            <h1 className="text-[1.875rem] leading-[1.05] font-bold tracking-tight text-slate-900 sm:text-5xl">
              Set the paper, or let AI.
              <br />
              One link for the class.
              <br />
              <span className="bg-gradient-to-r from-blue-700 to-indigo-600 bg-clip-text text-transparent">
                A report per student.
              </span>
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-600">
              MCQs, several-correct and essay answers. Timers, shuffled papers, an exam-hall interface, group work,
              peer review, and papers that adapt as each student goes. Marks land on submission — with an AI reviewer
              for the writing, and a report and item analysis for every name on the roll.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/teacher"
                className="rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-blue-800"
              >
                Open the teacher dashboard
              </Link>
              <a
                href="#how"
                className="rounded-lg border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                See how it works
              </a>
            </div>
            <p className="mt-4 border-l-2 border-slate-200 pl-3 text-sm text-slate-500">
              Students need the link and nothing else — no account, no app, nothing to install.
            </p>
          </div>

          <div className="relative flex justify-center lg:justify-end">
            <div className="absolute -inset-8 rounded-[3rem] bg-gradient-to-br from-blue-50 via-indigo-50 to-transparent" />
            <div className="relative">
              <PhoneQuestion />
              <ShareCard className="absolute -bottom-6 -left-16 hidden sm:block" />
            </div>
          </div>
        </div>
      </section>

      {/* 2 · Four steps */}
      <section id="how" className="scroll-mt-16 border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-6 py-7">
          <ol className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 font-mono text-xs font-bold text-blue-700">0{i + 1}</span>
                <span>
                  <span className="block text-sm font-bold text-slate-900">{title}</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 3 · Three spotlights */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl space-y-10 px-6 py-12">
          <div className="grid items-center gap-8 md:grid-cols-2">
            <div>
              <Eyebrow>Setting it</Eyebrow>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Let the AI write it. You still hold the pen.
              </h2>
              <p className="mt-3 max-w-md leading-relaxed text-slate-600">
                Copy Quizzine&apos;s prompt into any chatbot, or hand it the Excel template that briefs the model for
                you. What comes back is a file you read and correct before a single student sees it — and every row is
                checked on upload, with mistakes named line by line.
              </p>
            </div>
            <FileCheck />
          </div>

          <div className="grid items-center gap-8 md:grid-cols-2">
            <div className="md:order-2">
              <Eyebrow>Running it</Eyebrow>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Any phone in the room becomes the answer sheet.
              </h2>
              <p className="mt-4 max-w-md leading-relaxed text-slate-600">
                Answers are saved on the device as they are typed, so a closed tab or a flat battery costs nobody their
                attempt. Shuffle the order per student, set a timer — or switch on the exam interface, with the palette
                and the marked-for-review flags they will meet in a real competitive exam.
              </p>
            </div>
            <div className="md:order-1">
              <ExamPalette />
            </div>
          </div>

          <div className="grid items-center gap-8 md:grid-cols-2">
            <div>
              <Eyebrow>Marking it</Eyebrow>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                The marking ends when the quiz does.
              </h2>
              <p className="mt-4 max-w-md leading-relaxed text-slate-600">
                Objective questions score themselves the moment a student submits. Written answers arrive on a marking
                screen with your rubric beside them, and peer review can hand the first pass to the class. A term of
                quizzes then folds into one table, under bands you set yourself.
              </p>
            </div>
            <ReportTable />
          </div>
        </div>
      </section>

      {/* 4 · Four kinds of paper */}
      <section className="bg-slate-900">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="flex items-center gap-3">
            <LogoMark size={26} />
            <p className="text-xs font-bold tracking-[0.18em] text-blue-300 uppercase">Four kinds of paper</p>
          </div>
          <h2 className="mt-4 max-w-2xl text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Not every task is a test — Quizzine handles the rest of them too.
          </h2>
          <dl className="mt-7 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {MODES.map(([title, body]) => (
              <div key={title} className="border-t border-slate-700 pt-4">
                <dt className="font-semibold text-white">{title}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-slate-400">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* 5 · Everything else */}
      <section className="border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Everything else it does</h2>
          <div className="mt-7 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
            {LISTS.map((list) => (
              <div key={list.title}>
                <h3 className="text-sm font-bold tracking-wide text-blue-700 uppercase">{list.title}</h3>
                <ul className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                  {list.items.map((item) => (
                    <li key={item} className="text-[13px] leading-snug text-slate-600">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <details className="group mt-7 rounded-xl border border-slate-200 bg-white">
            <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
              <span className="text-blue-700 group-open:hidden">+ </span>
              <span className="hidden text-blue-700 group-open:inline">− </span>
              And the small print that turns out to matter
            </summary>
            <dl className="grid gap-x-8 gap-y-5 border-t border-slate-200 px-5 py-5 sm:grid-cols-2">
              {SMALL_PRINT.map(([title, body]) => (
                <div key={title}>
                  <dt className="text-sm font-semibold text-slate-900">{title}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-slate-600">{body}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      </section>

      {/* 6 · Questions teachers ask */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 lg:grid-cols-[0.72fr_1.28fr]">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Questions teachers ask</h2>
          <dl className="grid gap-x-8 gap-y-6 border-t border-slate-200 pt-6 sm:grid-cols-2">
            {FAQS.map(([q, a]) => (
              <div key={q}>
                <dt className="font-semibold text-slate-900">{q}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-slate-600">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* 7 · Close */}
      <section className="bg-gradient-to-br from-blue-700 to-indigo-700">
        <div className="mx-auto max-w-6xl px-6 py-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Your next quiz is a file away.</h2>
          <p className="mx-auto mt-3 max-w-md text-blue-100">
            Sign in with Google — or the passcode — and set your first paper in a few minutes.
          </p>
          <Link
            href="/teacher"
            className="mt-7 inline-block rounded-lg bg-white px-7 py-3 font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
          >
            Open the teacher dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
