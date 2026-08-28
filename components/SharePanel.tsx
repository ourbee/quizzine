/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useEffect, useState } from "react";

interface ShareRow {
  shared_with: string;
  created_at: string;
  copy_quiz_id: string;
  responses: string;
  still_there: boolean;
}

/**
 * Giving a quiz to a colleague.
 *
 * What they get is a copy: their own link, their own QR code, their own
 * dashboard. Their students never appear on yours and yours never appear on
 * theirs, which is the only arrangement that makes sense when two teachers
 * share a paper but not a class. It also means the copy is theirs to change —
 * editing yours afterwards leaves theirs exactly as it was, and this panel says
 * so rather than letting a teacher discover it later.
 */
export default function SharePanel({ quizId, questionCount }: { quizId: string; questionCount: number }) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/quizzes/${quizId}/share`);
    if (!res.ok) return;
    const data = await res.json();
    setShares(data.shares ?? []);
  }, [quizId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function share(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setDone("");
    const res = await fetch(`/api/quizzes/${quizId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not share that.");
      return;
    }
    setDone(
      `Copied to ${data.email}. It is on their dashboard now, with its own link — tell them it is there, as Quizzine does not send email.`
    );
    setEmail("");
    load();
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold text-slate-900">Share with a colleague</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            They get their own copy — their own link, and only their students on their dashboard.
          </p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          {open ? "Close" : shares.length ? `Shared with ${shares.length}` : "Share"}
        </button>
      </div>

      {open && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">
            The copy carries the {questionCount} question{questionCount === 1 ? "" : "s"}, the settings and the rubric,
            and nothing else — no responses, no marks, no student names. It is theirs from then on: editing your copy
            afterwards does not change theirs, which is what stops a paper changing under a class that has already sat
            it. They must already be able to sign in to Quizzine.
          </p>

          <form onSubmit={share} className="mt-3 flex flex-wrap gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              className="min-w-56 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
            <button
              disabled={busy}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Copying…" : "Send a copy"}
            </button>
          </form>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          {done && <p className="mt-2 text-sm text-green-700">{done}</p>}

          {shares.length > 0 && (
            <div className="mt-3 divide-y divide-slate-100">
              {shares.map((s) => (
                <div key={s.copy_quiz_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="flex-1 truncate font-medium text-slate-800">{s.shared_with}</span>
                  <span className="text-xs text-slate-400">
                    {new Date(s.created_at).toLocaleDateString()} ·{" "}
                    {!s.still_there
                      ? "copy deleted"
                      : `${Number(s.responses)} response${Number(s.responses) === 1 ? "" : "s"} on their copy`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
