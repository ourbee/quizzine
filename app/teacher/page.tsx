/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import TeacherBar from "@/components/TeacherBar";

interface QuizRow {
  id: string;
  slug: string;
  title: string;
  theme: string;
  accepting: boolean;
  created_at: string;
  responses: string | number;
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

/** Which quizzes the list is showing, and in what order. */
type Shown = "all" | "open" | "closed";
type Sort = "newest" | "oldest" | "title" | "responses";
const VIEW_KEY = "quizzine-dashboard-view";

const SORTS: [Sort, string][] = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["title", "Title A–Z"],
  ["responses", "Most responses"],
];

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export default function TeacherPage() {
  const [state, setState] = useState<"loading" | "login" | "ready">("loading");
  const [quizzes, setQuizzes] = useState<QuizRow[]>([]);
  const [owner, setOwner] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const googleBtn = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState<Shown>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [busy, setBusy] = useState("");
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [copied, setCopied] = useState("");

  // The list is filtered the way it was left. A teacher who works in one term's
  // quizzes should not have to re-narrow the dashboard every morning.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (!saved) return;
      const view = JSON.parse(saved) as { only?: Shown; sort?: Sort };
      if (view.only === "all" || view.only === "open" || view.only === "closed") setOnly(view.only);
      if (view.sort === "newest" || view.sort === "oldest" || view.sort === "title" || view.sort === "responses") {
        setSort(view.sort);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ only, sort }));
    } catch {}
  }, [only, sort]);

  const load = useCallback(async () => {
    const res = await fetch("/api/quizzes");
    if (res.status === 401) {
      setState("login");
      return;
    }
    const data = await res.json();
    setQuizzes(data.quizzes ?? []);
    setOwner(data.owner ?? "");
    setState("ready");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Render the Google sign-in button once the login form is visible.
  useEffect(() => {
    if (state !== "login" || !GOOGLE_CLIENT_ID) return;

    const render = () => {
      if (!window.google || !googleBtn.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          setError("");
          const res = await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ credential }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setError(data.error ?? "Google sign-in failed.");
            return;
          }
          setState("loading");
          load();
        },
      });
      window.google.accounts.id.renderButton(googleBtn.current, {
        theme: "outline",
        size: "large",
        text: "signin_with",
        width: 320,
      });
    };

    if (window.google) {
      render();
      return;
    }
    const existing = document.getElementById("gsi-script");
    if (existing) {
      existing.addEventListener("load", render);
      return () => existing.removeEventListener("load", render);
    }
    const script = document.createElement("script");
    script.id = "gsi-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [state, load]);

  async function loginWithPasscode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: pass }),
    });
    if (!res.ok) {
      setError("Wrong passcode.");
      return;
    }
    setState("loading");
    load();
  }


  /**
   * The list as it is actually shown: searched, filtered, sorted.
   *
   * All of it happens here rather than on the server because the dashboard
   * already holds every row a teacher owns — asking the database again to
   * narrow a list that is in memory would only make typing feel slower.
   */
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = quizzes.filter((quiz) => {
      if (only === "open" && !quiz.accepting) return false;
      if (only === "closed" && quiz.accepting) return false;
      if (!needle) return true;
      return `${quiz.title} ${quiz.slug}`.toLowerCase().includes(needle);
    });
    const ordered = [...rows];
    ordered.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "responses") return Number(b.responses) - Number(a.responses);
      const at = new Date(a.created_at).getTime();
      const bt = new Date(b.created_at).getTime();
      return sort === "oldest" ? at - bt : bt - at;
    });
    return ordered;
  }, [quizzes, search, only, sort]);

  const openCount = quizzes.filter((z) => z.accepting).length;
  const totalResponses = quizzes.reduce((sum, z) => sum + Number(z.responses), 0);
  const filtering = search.trim() !== "" || only !== "all";

  /**
   * Open or close a quiz without leaving the dashboard.
   *
   * The server can refuse — an allotted test may not open until every roll on
   * the roster has a question — so its reason is shown against the row rather
   * than swallowed, and the row is put back the way it was.
   */
  async function toggleAccepting(quiz: QuizRow) {
    setBusy(quiz.id);
    setRowError(null);
    const res = await fetch(`/api/quizzes/${quiz.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accepting: !quiz.accepting }),
    });
    setBusy("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setRowError({ id: quiz.id, message: data.error ?? "Could not change that." });
      return;
    }
    setQuizzes((rows) => rows.map((r) => (r.id === quiz.id ? { ...r, accepting: !quiz.accepting } : r)));
  }

  /**
   * The student link, without opening the quiz.
   *
   * The clipboard is not always ours to write to — a browser may refuse it
   * outright — and a copy button that quietly does nothing is worse than no
   * button at all, because the teacher goes away and pastes whatever was there
   * before. So a refusal puts the address on screen instead, to be copied by
   * hand.
   */
  async function copyLink(quiz: QuizRow) {
    const url = `${window.location.origin}/q/${quiz.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setRowError(null);
      setCopied(quiz.id);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      setRowError({ id: quiz.id, message: `Your browser would not let the page copy that. The link is: ${url}` });
    }
  }

  if (state === "loading") {
    return <main className="max-w-3xl mx-auto px-6 py-20 text-center text-slate-500">Loading…</main>;
  }

  if (state === "login") {
    return (
      <main className="max-w-sm mx-auto px-6 py-24">
        <Link href="/" className="inline-block mb-6">
          <Logo size={30} />
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Teacher sign-in</h1>
        {GOOGLE_CLIENT_ID ? (
          <>
            <p className="mt-1 text-sm text-slate-500">
              Sign in with your Google account. Your quizzes are private to your account.
            </p>
            <div ref={googleBtn} className="mt-6 flex justify-center" />
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-500">Enter the teacher passcode to open the dashboard.</p>
            <form onSubmit={loginWithPasscode} className="mt-6 space-y-3">
              <input
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="Passcode"
                autoFocus
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
              <button type="submit" className="w-full rounded-lg bg-blue-700 py-2.5 text-white font-semibold hover:bg-blue-800 transition">
                Open dashboard
              </button>
            </form>
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </main>
    );
  }

  return (
    <main className="max-w-4xl mx-auto px-6 py-12 w-full">
      <TeacherBar back={null} owner={owner} />

      <div id="quizzes" className="mt-3 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Your quizzes</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {quizzes.length === 0
              ? "Nothing here yet — create your first quiz."
              : `${quizzes.length} quiz${quizzes.length === 1 ? "" : "zes"} · ${openCount} open · ${totalResponses} response${totalResponses === 1 ? "" : "s"} in total`}
          </p>
        </div>
        <Link href="/teacher/new" className="rounded-lg bg-blue-700 px-5 py-2.5 text-white font-semibold hover:bg-blue-800 transition">
          + New quiz
        </Link>
      </div>

      {/* Everything else a teacher comes to the dashboard to reach, in one row. */}
      <nav className="mt-4 flex flex-wrap gap-2 text-sm">
        {(
          [
            ["/teacher/reports", "Reports", "Marks for one quiz, or across several"],
            ["/teacher/analytics", "Strengths", "What the class is good and weak at"],
            ["/teacher/tags", "Tags", "Keep one topic from becoming two"],
          ] as [string, string, string][]
        ).map(([href, label, title]) => (
          <Link
            key={href}
            href={href}
            title={title}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-semibold text-slate-700 hover:bg-slate-100 transition"
          >
            {label}
          </Link>
        ))}
        <a
          href="#backup"
          title="Download your quizzes and results"
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-semibold text-slate-700 hover:bg-slate-100 transition"
        >
          Back up
        </a>
        <a
          href="/"
          title="The public front page"
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-semibold text-slate-700 hover:bg-slate-100 transition"
        >
          Home
        </a>
      </nav>

      {/* Finding one quiz among a term of them. Hidden while there is nothing to search. */}
      {quizzes.length > 1 && (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your quizzes…"
            aria-label="Search your quizzes by title or link"
            className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Clear
            </button>
          )}
          <div className="flex gap-1">
            {(
              [
                ["all", "All"],
                ["open", "Open"],
                ["closed", "Closed"],
              ] as [Shown, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setOnly(value)}
                aria-pressed={only === value}
                className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                  only === value ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort your quizzes"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
          >
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      )}

      {filtering && quizzes.length > 1 && (
        <p className="mt-2 text-xs text-slate-500">
          Showing {visible.length} of {quizzes.length}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {visible.map((quiz) => (
          <div
            key={quiz.id}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow"
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Link href={`/teacher/quiz/${quiz.id}`} className="min-w-0 flex-1 group">
                <p className="font-semibold text-slate-900 group-hover:text-blue-800">{quiz.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  /q/{quiz.slug} · created {new Date(quiz.created_at).toLocaleDateString()}
                </p>
              </Link>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-slate-600">{Number(quiz.responses)} response{Number(quiz.responses) === 1 ? "" : "s"}</span>
                <button
                  onClick={() => toggleAccepting(quiz)}
                  disabled={busy === quiz.id}
                  title={quiz.accepting ? "Stop accepting responses" : "Start accepting responses"}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium disabled:opacity-50 ${
                    quiz.accepting ? "bg-green-100 text-green-800 hover:bg-green-200" : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                  }`}
                >
                  {busy === quiz.id ? "…" : quiz.accepting ? "Open" : "Closed"}
                </button>
              </div>
            </div>

            {/* The two things worth doing to a quiz without opening it. */}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
              <button
                onClick={() => copyLink(quiz)}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-slate-600 hover:bg-slate-100"
              >
                {copied === quiz.id ? "Link copied ✓" : "Copy student link"}
              </button>
              {Number(quiz.responses) > 0 && (
                <Link
                  href={`/teacher/quiz/${quiz.id}/mark`}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-slate-600 hover:bg-slate-100"
                >
                  Mark
                </Link>
              )}
            </div>

            {rowError?.id === quiz.id && <p className="mt-2 text-xs text-red-600">{rowError.message}</p>}
          </div>
        ))}

        {quizzes.length > 0 && visible.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
            <p className="font-medium">Nothing matched</p>
            <p className="text-sm mt-1">
              No quiz here matches that search or filter.{" "}
              <button
                onClick={() => {
                  setSearch("");
                  setOnly("all");
                }}
                className="font-semibold text-blue-800 underline underline-offset-2"
              >
                Show them all
              </button>
            </p>
          </div>
        )}

        {quizzes.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
            <p className="font-medium">No quizzes yet</p>
            <p className="text-sm mt-1">
              Click <span className="font-semibold">New quiz</span>. You can write the questions yourself, have
              ChatGPT/Claude/Gemini build them, or upload a file you already have.
            </p>
          </div>
        )}
      </div>

      <AccountPanel />
    </main>
  );
}

/**
 * Backing up, and — for the owner of this deployment — who else may sign in.
 *
 * Both live here rather than in a settings page because both are things a
 * teacher should trip over rather than go looking for: a term of students'
 * results sitting in one free-tier database is worth a copy on your own disk,
 * and an app anyone with a Google account can fill is worth knowing about.
 */
function AccountPanel() {
  const [invites, setInvites] = useState<
    { email: string; note: string | null; created_at: string; last_seen_at: string | null; quizzes: string }[]
  >([]);
  const [isOwner, setIsOwner] = useState(false);
  const [quota, setQuota] = useState(0);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/invites");
    if (!res.ok) {
      setIsOwner(false);
      return;
    }
    const data = await res.json();
    setIsOwner(true);
    setInvites(data.invites ?? []);
    setQuota(data.quota ?? 0);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, note }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not send that invitation.");
      return;
    }
    setEmail("");
    setNote("");
    load();
  }

  async function withdraw(target: string) {
    await fetch(`/api/invites?email=${encodeURIComponent(target)}`, { method: "DELETE" });
    load();
  }

  return (
    <section className="mt-10 space-y-4">
      <div id="backup" className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold text-slate-900">Back up your work</h2>
        <p className="mt-1 text-sm text-slate-500">
          Your quizzes and every student result in one JSON file. Free database plans suspend projects that go
          quiet over a holiday, and a question bank plus a term of marks is not something to keep in one place and
          hope.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href="/api/backup"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Download everything
          </a>
          <a
            href="/api/backup?results=0"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Questions only
          </a>
        </div>
      </div>

      {isOwner && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-bold text-slate-900">Who may sign in</h2>
          <p className="mt-1 text-sm text-slate-500">
            A Google account is not by itself permission to be here: quizzes and students&apos; marks all live in
            your one database. Invited teachers may publish up to {quota} questions a day; you are not rationed.
          </p>

          <form onSubmit={invite} className="mt-3 flex flex-wrap gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teacher@example.com"
              className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="min-w-[10rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              disabled={busy}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Inviting…" : "Invite"}
            </button>
          </form>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <div className="mt-3 divide-y divide-slate-100">
            {invites.map((i) => (
              <div key={i.email} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="flex-1 truncate">
                  <span className="font-medium text-slate-800">{i.email}</span>
                  {i.note && <span className="ml-2 text-slate-400">{i.note}</span>}
                </span>
                <span className="text-xs text-slate-400">
                  {Number(i.quizzes)} quiz{Number(i.quizzes) === 1 ? "" : "zes"} ·{" "}
                  {i.last_seen_at ? `last in ${new Date(i.last_seen_at).toLocaleDateString()}` : "not signed in yet"}
                </span>
                <button
                  onClick={() => withdraw(i.email)}
                  title="Stops them signing in. Their quizzes and results are not deleted."
                  className="rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                >
                  Withdraw
                </button>
              </div>
            ))}
            {!invites.length && (
              <p className="py-2 text-sm text-slate-400">
                Nobody else has been invited, so only you can sign in.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
