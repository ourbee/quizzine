"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

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

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    setQuizzes([]);
    setOwner("");
    setState("login");
  }

  if (state === "loading") {
    return <main className="max-w-3xl mx-auto px-6 py-20 text-center text-slate-500">Loading…</main>;
  }

  if (state === "login") {
    return (
      <main className="max-w-sm mx-auto px-6 py-24">
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Your quizzes</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {owner && <span className="mr-2">{owner} ·</span>}
            {quizzes.length === 0 ? "Nothing here yet — create your first quiz." : `${quizzes.length} quiz${quizzes.length === 1 ? "" : "zes"}`}
            <button onClick={signOut} className="ml-2 underline underline-offset-2 hover:text-slate-800">
              Sign out
            </button>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/teacher/reports"
            className="rounded-lg border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-100 transition"
          >
            Reports
          </Link>
          <Link href="/teacher/new" className="rounded-lg bg-blue-700 px-5 py-2.5 text-white font-semibold hover:bg-blue-800 transition">
            + New quiz
          </Link>
        </div>
      </div>

      <div className="mt-8 space-y-3">
        {quizzes.map((quiz) => (
          <Link
            key={quiz.id}
            href={`/teacher/quiz/${quiz.id}`}
            className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300 hover:shadow transition"
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-semibold text-slate-900">{quiz.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  /q/{quiz.slug} · created {new Date(quiz.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-slate-600">{Number(quiz.responses)} response{Number(quiz.responses) === 1 ? "" : "s"}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    quiz.accepting ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {quiz.accepting ? "Open" : "Closed"}
                </span>
              </div>
            </div>
          </Link>
        ))}
        {quizzes.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
            <p className="font-medium">No quizzes yet</p>
            <p className="text-sm mt-1">
              Click <span className="font-semibold">New quiz</span>, copy the AI prompt, generate questions with
              ChatGPT/Claude/Gemini, and upload the result.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
