/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import type { PeerConfig } from "@/lib/peer";

/**
 * How classmates mark each other's work: the criteria, how many of them see
 * each response, and how their marks are combined. Written once and used both
 * when a quiz is published and when it is edited afterwards, so the two screens
 * can never drift into offering different settings.
 *
 * The criteria list is hidden — not removed — when the peer round scores the
 * marking rubric's bands instead, so that turning that off brings back the
 * criteria the teacher had written rather than a default set.
 */
export default function PeerEditor({
  value,
  onChange,
  hideCriteria = false,
}: {
  value: PeerConfig;
  onChange: (next: PeerConfig) => void;
  hideCriteria?: boolean;
}) {
  const set = (change: Partial<PeerConfig>) => onChange({ ...value, ...change });

  return (
    <div className="space-y-3">
      <div className={`space-y-2 ${hideCriteria ? "hidden" : ""}`}>
        {value.criteria.map((c, i) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2">
            <input
              value={c.label}
              onChange={(e) => set({ criteria: value.criteria.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
              placeholder="Criterion, e.g. Evidence"
              className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
            <label className="text-xs text-slate-500">
              out of
              <input
                type="number"
                min={1}
                max={100}
                value={c.max}
                onChange={(e) =>
                  set({ criteria: value.criteria.map((x, j) => (j === i ? { ...x, max: Number(e.target.value) || 1 } : x)) })
                }
                className="ml-2 w-20 rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-900"
              />
            </label>
            <button
              onClick={() => set({ criteria: value.criteria.filter((_, j) => j !== i) })}
              disabled={value.criteria.length < 2}
              className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
              aria-label={`Remove ${c.label}`}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          onClick={() => set({ criteria: [...value.criteria, { id: `c${Date.now()}`, label: "", max: 5 }] })}
          disabled={value.criteria.length >= 10}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
        >
          Add criterion
        </button>
      </div>

      <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
        <label className="text-sm text-slate-700">
          Reviewers per response
          <input
            type="number"
            min={1}
            max={10}
            value={value.reviewsPerResponse}
            onChange={(e) => set({ reviewsPerResponse: Number(e.target.value) || 1 })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
          />
        </label>
        <label className="text-sm text-slate-700">
          Marks for completing your own reviews
          <input
            type="number"
            min={0}
            max={100}
            value={value.reviewPoints}
            onChange={(e) => set({ reviewPoints: Number(e.target.value) || 0 })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {([["mean", "Average of reviewers"], ["median", "Median of reviewers"]] as const).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => set({ aggregate: mode })}
            className={`rounded-lg px-4 py-2 font-medium ${value.aggregate === mode ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {value.aggregate === "mean"
          ? "Every reviewer counts equally towards the mark."
          : "The middle mark is taken, so one unusually harsh or generous reviewer cannot swing the result."}
      </p>
      <label className="flex items-center gap-2.5 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={value.commentRequired}
          onChange={(e) => set({ commentRequired: e.target.checked })}
          className="h-4 w-4"
        />
        A written comment is required on every part
      </label>
      <label className="flex items-center gap-2.5 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={value.releaseFeedback}
          onChange={(e) => set({ releaseFeedback: e.target.checked })}
          className="h-4 w-4"
        />
        Students may read their peers&apos; comments once you release the results
      </label>
    </div>
  );
}
