/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useMemo } from "react";
import { countWords, truncateToWords, wordState } from "@/lib/words";
import type { TelemetryCollector } from "@/lib/telemetry";

/**
 * The box a student types a written answer into, wherever it appears — the
 * scrolling paper and the exam interface both use this one, so the word
 * counter, the paste guard and the typing telemetry cannot drift apart between
 * them.
 *
 * The word limit is advisory by default: the counter turns amber near it and
 * red past it, and the marking penalises the overrun under Craft & Discipline.
 * Only `hardLimit` actually stops the typing, because a student who has written
 * 210 words of a good answer should be told, not silenced.
 */
export default function WrittenAnswer({
  qid,
  value,
  onChange,
  rows,
  wordLimit,
  hardLimit,
  pasteGuard,
  telemetry,
  colours,
  className,
  placeholder = "Type your answer…",
}: {
  qid: string;
  value: string;
  onChange: (next: string) => void;
  rows: number;
  wordLimit?: number;
  hardLimit?: boolean;
  pasteGuard?: boolean;
  telemetry?: TelemetryCollector;
  colours?: { border: string; muted: string };
  className?: string;
  placeholder?: string;
}) {
  const words = useMemo(() => countWords(value), [value]);
  const state = wordState(words, wordLimit);

  return (
    <div>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => {
          const next =
            hardLimit && wordLimit && wordLimit > 0 ? truncateToWords(e.target.value, wordLimit) : e.target.value;
          telemetry?.typed(qid, next.length);
          onChange(next);
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text") ?? "";
          if (pasteGuard) {
            e.preventDefault();
            return;
          }
          // The length only — never a character of what was pasted.
          telemetry?.paste(qid, pasted.length);
        }}
        onBlur={() => telemetry?.blur(qid)}
        className={className ?? "mt-3 w-full rounded-xl border-2 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none"}
        style={colours ? { borderColor: colours.border } : undefined}
      />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span
          style={state === "none" || state === "under" ? { color: colours?.muted ?? "#64748b" } : undefined}
          className={
            state === "over" ? "font-semibold text-red-600" : state === "near" ? "font-semibold text-amber-600" : ""
          }
        >
          {words} word{words === 1 ? "" : "s"}
          {wordLimit ? ` · limit ${wordLimit}` : ""}
          {state === "over" ? ` · ${words - (wordLimit ?? 0)} over` : ""}
        </span>
        {pasteGuard && (
          <span style={{ color: colours?.muted ?? "#64748b" }}>Pasting is turned off for this answer.</span>
        )}
      </div>
      {state === "over" && !hardLimit && (
        <p className="mt-1 text-xs text-red-600">
          Over the word limit. You can still submit — overrunning is marked down rather than blocked.
        </p>
      )}
    </div>
  );
}
