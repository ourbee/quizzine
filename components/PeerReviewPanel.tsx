/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import type { PeerCriterion, QuizPhase } from "@/lib/peer";

interface Outcome {
  attemptId: string;
  name: string;
  peerScore: number | null;
  reviewsIn: number;
  reviewsAssigned: number;
  reviewsOwed: number;
  reviewsDone: number;
  reviewCredit: number;
  finalScore: number;
  teacherScore: number | null;
}

interface ReviewLine {
  id: string;
  attemptId: string;
  of: string;
  by: string;
  status: string;
  total: number | null;
  comments: Record<string, string>;
  outlier: boolean;
}

interface PeerData {
  phase: QuizPhase;
  max: number;
  rubricMax: number;
  criteria: PeerCriterion[];
  questions: { id: string; text: string }[];
  outcomes: Outcome[];
  reviews: ReviewLine[];
}

/**
 * The teacher's view of a peer-reviewed quiz: move it through its phases, watch
 * who has done their reviewing, and override any mark the panel got wrong.
 */
export default function PeerReviewPanel({
  quizId,
  slug,
  onPhaseChange,
}: {
  quizId: string;
  slug: string;
  onPhaseChange?: () => void;
}) {
  const [data, setData] = useState<PeerData | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showReviews, setShowReviews] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/quizzes/${quizId}/peer`);
    if (!res.ok) {
      setError("Could not load the peer review status.");
      return;
    }
    setData(await res.json());
  }, [quizId]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(action: string, extra: Record<string, unknown> = {}, label = "") {
    setBusy(label || action);
    setError("");
    setNote("");
    const res = await fetch(`/api/quizzes/${quizId}/peer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    setBusy("");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "That did not work.");
      return;
    }
    if (action === "open") setNote(`Peer review opened — ${body.assigned} assignments handed out.`);
    if (action === "assign") setNote(body.assigned ? `${body.assigned} new assignments handed out.` : "Everyone already has their full quota.");
    if (action === "close") setNote(`Results released — ${body.scored} responses scored.`);
    await load();
    onPhaseChange?.();
  }

  if (error && !data) return <p className="mt-3 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="mt-3 text-sm text-slate-500">Loading peer review…</p>;

  const reviewUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/q/${slug}/review`;

  const reviewsDone = data.reviews.filter((r) => r.status === "submitted").length;
  const outstanding = data.outcomes.filter((o) => o.reviewsOwed > o.reviewsDone);

  return (
    <section className="mt-10">
      <h2 className="font-bold text-slate-900">Peer review</h2>

      <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(["responding", "reviewing", "closed"] as QuizPhase[]).map((p, i) => (
            <span
              key={p}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                data.phase === p ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-500"
              }`}
            >
              {i + 1}. {p === "responding" ? "Students answering" : p === "reviewing" ? "Marking each other" : "Results released"}
            </span>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {data.phase === "responding" && (
            <button
              onClick={() => act("open")}
              disabled={!!busy}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {busy === "open" ? "Opening…" : "Open peer review"}
            </button>
          )}
          {data.phase === "reviewing" && (
            <>
              <button
                onClick={() => act("assign")}
                disabled={!!busy}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                {busy === "assign" ? "Assigning…" : "Assign late submissions"}
              </button>
              <button
                onClick={() => act("close")}
                disabled={!!busy}
                className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
              >
                {busy === "close" ? "Releasing…" : "Release results"}
              </button>
              <button
                onClick={() => act("respond")}
                disabled={!!busy}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Back to answering
              </button>
            </>
          )}
          {data.phase === "closed" && (
            <button
              onClick={() => act("reopen")}
              disabled={!!busy}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Reopen for more reviewing
            </button>
          )}
        </div>

        <p className="mt-3 text-xs text-slate-500">
          {data.phase === "responding"
            ? "Opening peer review stops new responses and hands each one to classmates to mark."
            : data.phase === "reviewing"
              ? `${reviewsDone} of ${data.reviews.length} reviews are in${outstanding.length ? ` · ${outstanding.length} student${outstanding.length === 1 ? " has" : "s have"} not finished` : ""}. Releasing results writes the marks onto the responses.`
              : "Marks are written and students can see their result. Any override you make from here updates it at once."}
        </p>
        {note && <p className="mt-2 text-sm font-medium text-green-700">{note}</p>}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        {/*
          Students who have already responded land on their own result page for the
          rest of the quiz's life, so they reach reviewing through the button there.
          This is the link to send if you would rather push it to them directly.
        */}
        {data.phase !== "responding" && (
          <div className="mt-4 border-t border-slate-200 pt-3">
            <p className="text-xs font-semibold text-slate-500">Direct link to the review round</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
                {reviewUrl || `/q/${slug}/review`}
              </code>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(reviewUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                {copied ? "Copied ✓" : "Copy link"}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Students who already responded also see a button on their own result page — the original quiz link still
              gets them there.
            </p>
          </div>
        )}
      </div>

      {data.outcomes.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Response</th>
                <th className="px-4 py-2.5">Reviews in</th>
                <th className="px-4 py-2.5">Peer mark</th>
                <th className="px-4 py-2.5">Own reviewing</th>
                <th className="px-4 py-2.5">Final</th>
                <th className="px-4 py-2.5">Override</th>
              </tr>
            </thead>
            <tbody>
              {data.outcomes.map((o) => (
                <tr key={o.attemptId} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-medium text-slate-900">{o.name}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {o.reviewsIn} / {o.reviewsAssigned}
                  </td>
                  <td className="px-4 py-2.5">
                    {o.peerScore === null ? <span className="text-slate-400">—</span> : `${o.peerScore} / ${data.rubricMax}`}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={o.reviewsOwed && o.reviewsDone < o.reviewsOwed ? "text-amber-700" : "text-slate-600"}>
                      {o.reviewsDone} / {o.reviewsOwed}
                    </span>
                    {o.reviewCredit > 0 && <span className="ml-1 text-xs text-green-700">+{o.reviewCredit}</span>}
                  </td>
                  <td className="px-4 py-2.5 font-semibold">
                    {o.finalScore} / {data.max}
                    {o.teacherScore !== null && <span className="ml-1 text-xs font-medium text-blue-700">yours</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={data.max}
                        placeholder="—"
                        value={drafts[o.attemptId] ?? (o.teacherScore !== null ? String(o.teacherScore) : "")}
                        onChange={(e) => setDrafts((d) => ({ ...d, [o.attemptId]: e.target.value }))}
                        className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                      <button
                        onClick={() => act("override", { attemptId: o.attemptId, score: drafts[o.attemptId] ?? "" }, `ov-${o.attemptId}`)}
                        disabled={!!busy}
                        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                      >
                        Set
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.reviews.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowReviews((v) => !v)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            {showReviews ? "Hide individual reviews" : `Show all ${data.reviews.length} individual reviews`}
          </button>
          {showReviews && (
            <div className="mt-3 space-y-2">
              {data.reviews.map((r) => (
                <div
                  key={r.id}
                  className={`rounded-xl border p-3 text-sm ${r.outlier ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}
                >
                  <p className="text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">{r.by}</span> reviewing{" "}
                    <span className="font-semibold text-slate-700">{r.of}</span>
                    {r.status === "submitted" ? (
                      <>
                        {" "}· {r.total} / {data.rubricMax}
                        {r.outlier && <span className="ml-1 font-semibold text-amber-800">— well away from the other reviewers</span>}
                      </>
                    ) : (
                      <span className="ml-1 font-semibold text-slate-500">— not done yet</span>
                    )}
                  </p>
                  {data.questions.map((qn) =>
                    r.comments[qn.id] ? (
                      <p key={qn.id} className="mt-1.5 whitespace-pre-wrap text-slate-700">
                        <span className="font-semibold">{qn.text.slice(0, 50)}{qn.text.length > 50 ? "…" : ""}:</span>{" "}
                        {r.comments[qn.id]}
                      </p>
                    ) : null
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
