/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import Link from "next/link";
import Logo, { LogoMark } from "@/components/Logo";

const STEPS: [string, string][] = [
  [
    "Draft the questions",
    "Copy the built-in prompt into ChatGPT, Claude or Gemini and let it write the paper — or type it yourself. Either way you get a file you can read and edit before anyone sees it.",
  ],
  [
    "Upload the file",
    "Excel, CSV, JSON, plain text, or the Google Apps Script you already use for Forms. Every row is checked and shown back to you, mistakes named line by line.",
  ],
  [
    "Share one link",
    "Publishing gives you a link and a QR code. Students open it on a phone or a lab computer — no account, no app, nothing to install.",
  ],
  [
    "Read the results",
    "Marks are ready the moment a student submits. You get responses, item analysis and an Excel export while the class is still in the room.",
  ],
];

const MODES: [string, string, string][] = [
  [
    "Marked quiz",
    "MCQs, several-correct questions and typed answers, each with its own marks and feedback.",
    "Graded",
  ],
  [
    "Survey or poll",
    "Collect opinions with nothing scored. Students see a confirmation, you see the distribution.",
    "Unscored",
  ],
  [
    "Group work",
    "One submission per group, with every member named. The mark reaches all of them in reports.",
    "Per group",
  ],
  [
    "Peer review",
    "Classmates mark each other's writing against your rubric, double-blind, and the average becomes the score.",
    "Peer marked",
  ],
];

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Setting the paper",
    items: [
      [
        "Any file you already have",
        "Excel, CSV, JSON, plain-text blocks or a Google Apps Script Forms builder — read directly, in a sandbox, without sending anything to Google.",
      ],
      [
        "Several quizzes from one file",
        "A sheet per quiz, or a script that builds several Forms, becomes several quizzes at once — each with its own link and QR code.",
      ],
      [
        "Passages and material",
        "Put an extract, a sample response or a paragraph of theory above the questions that share it. Shuffling keeps a passage and its questions together.",
      ],
      [
        "Pictures, audio and video",
        "Attach an image, an audio clip or a YouTube video to any question, or set an intro video the class watches before starting.",
      ],
    ],
  },
  {
    title: "Running it with a class",
    items: [
      [
        "Timers and closing times",
        "A countdown for the whole paper or for each question, and a time after which the link stops accepting new attempts.",
      ],
      [
        "A different order for everyone",
        "Questions and options are shuffled per student, so neighbours are never on the same screen at the same moment.",
      ],
      [
        "Nothing lost to a flat battery",
        "Answers are saved on the device as they are typed, so a closed tab or a dead phone does not cost the attempt.",
      ],
      [
        "One attempt per student",
        "Repeat submissions are blocked on the roll number — or on any member's roll for group work — unless you allow them.",
      ],
    ],
  },
  {
    title: "Marking",
    items: [
      [
        "Marking happens on the server",
        "Answer keys never reach the browser, so the page cannot be read for the answers before the quiz is submitted.",
      ],
      [
        "Feedback that teaches",
        "Every option can carry its own line of feedback, so a wrong answer explains itself. Students can print or save their copy.",
      ],
      [
        "Peer review, double-blind",
        "Everyone reviews a fixed number of responses and nobody reviews their own. Reviewers see the writing, never the name.",
      ],
      [
        "Your mark is final",
        "Item analysis with distractor bars shows which question misfired; a mark you set by hand overrides whatever the panel gave.",
      ],
    ],
  },
  {
    title: "Reporting",
    items: [
      [
        "A term in one table",
        "Combine any set of quizzes into one report — a column per quiz per student, and a summary per semester.",
      ],
      [
        "Bands you define",
        "Your own cut-offs, labels and colours, saved as a scheme you can reuse and set as your default.",
      ],
      [
        "Two roll numbers, one student",
        "When a student writes their college roll one term and their university roll the next, the report spots the pair and you confirm the merge.",
      ],
      [
        "Excel, ready to file",
        "Responses export in one click, and reports export with the settings and bands they were built with, so the numbers can be reproduced.",
      ],
    ],
  },
];

export default function Home() {
  return (
    <main className="w-full">
      <header className="max-w-5xl mx-auto px-6 pt-8 flex items-center justify-between">
        <Logo size={30} />
        <Link
          href="/teacher"
          className="text-sm font-semibold text-blue-700 hover:text-blue-900 hover:underline underline-offset-4"
        >
          Teacher dashboard →
        </Link>
      </header>

      <section className="max-w-5xl mx-auto px-6 pt-14 pb-4 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-tight max-w-3xl mx-auto">
          Set the paper once.
          <br className="hidden sm:block" /> Share one link.
          <br className="hidden sm:block" /> The marking looks after itself.
        </h1>
        <p className="mt-5 text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Quizzine turns a file of questions into a quiz your class can take from any device — marked as they submit,
          with feedback on every option, and a term&apos;s worth of results waiting in one report.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/teacher"
            className="rounded-lg bg-blue-700 px-6 py-3 text-white font-semibold shadow hover:bg-blue-800 transition"
          >
            Teacher dashboard
          </Link>
          <a
            href="#how"
            className="rounded-lg border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            See how it works
          </a>
        </div>
        <p className="mt-4 text-sm text-slate-500">
          Students need the link and nothing else — no account, no installation.
        </p>
      </section>

      <section id="how" className="max-w-5xl mx-auto px-6 py-16 scroll-mt-8">
        <h2 className="text-sm font-semibold tracking-widest text-blue-700 uppercase text-center">How it works</h2>
        <ol className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-700">
                {i + 1}
              </span>
              <h3 className="mt-3 font-semibold text-slate-900">{title}</h3>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-slate-900 py-16">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center gap-3">
            <LogoMark size={28} />
            <h2 className="text-sm font-semibold tracking-widest text-blue-300 uppercase">Four kinds of paper</h2>
          </div>
          <p className="mt-4 text-2xl sm:text-3xl font-bold tracking-tight text-white max-w-2xl">
            Not every task is a test — Quizzine handles the rest of them too.
          </p>
          <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {MODES.map(([title, body, tag]) => (
              <div key={title} className="rounded-xl border border-slate-700 bg-slate-800/60 p-5">
                <span className="inline-block rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-semibold text-blue-300">
                  {tag}
                </span>
                <h3 className="mt-3 font-semibold text-white">{title}</h3>
                <p className="mt-1.5 text-sm text-slate-300 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-sm font-semibold tracking-widest text-blue-700 uppercase text-center">
          What you get, in full
        </h2>
        <div className="mt-10 space-y-12">
          {GROUPS.map((group) => (
            <div key={group.title} className="grid lg:grid-cols-4 gap-6">
              <h3 className="text-lg font-bold text-slate-900 lg:pt-1">{group.title}</h3>
              <div className="lg:col-span-3 grid sm:grid-cols-2 gap-5">
                {group.items.map(([title, body]) => (
                  <div key={title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h4 className="font-semibold text-slate-900">{title}</h4>
                    <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-8 sm:p-10 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Your next quiz is a file away.
          </h2>
          <p className="mt-3 text-slate-600 max-w-xl mx-auto">
            Sign in with Google — or the passcode — and only your own quizzes are yours to see.
          </p>
          <Link
            href="/teacher"
            className="mt-6 inline-block rounded-lg bg-blue-700 px-6 py-3 text-white font-semibold shadow hover:bg-blue-800 transition"
          >
            Open the teacher dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
