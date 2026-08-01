/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useState } from "react";

/** Longer than this and the block is collapsed, so the questions stay in view. */
const COLLAPSE_OVER = 600;

interface MaterialColours {
  border: string;
  muted: string;
  accentSoft?: string;
}

const SLATE: MaterialColours = { border: "#e2e8f0", muted: "#64748b", accentSoft: "#f8fafc" };

/**
 * Material a student reads before answering — a poem, a passage, a worked
 * sample response. Rendered once above the run of questions it belongs to
 * (see `groupByPassage`), at reading size rather than as a footnote.
 *
 * `collapsible` is off on the pages a student prints, where a hidden half of
 * the material would simply be missing from the paper.
 */
export default function Material({
  text,
  title,
  colours = SLATE,
  compact,
  collapsible = true,
}: {
  text?: string;
  title?: string;
  colours?: MaterialColours;
  compact?: boolean;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!text) return null;

  const collapses = collapsible && text.length > COLLAPSE_OVER;
  const clamped = collapses && !open;

  return (
    <div
      className={`rounded-xl border ${compact ? "p-3" : "p-4"} ${compact ? "mt-2" : "mt-3"}`}
      style={{ borderColor: colours.border, background: colours.accentSoft }}
    >
      {title && (
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: colours.muted }}>
          {title}
        </p>
      )}
      <div
        className={`whitespace-pre-wrap ${compact ? "text-sm" : "text-[15px] leading-relaxed"} ${title ? "mt-1.5" : ""}`}
        style={clamped ? { display: "-webkit-box", WebkitLineClamp: 8, WebkitBoxOrient: "vertical", overflow: "hidden" } : undefined}
      >
        {text}
      </div>
      {collapses && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="no-print mt-2 text-xs font-semibold underline underline-offset-2"
          style={{ color: colours.muted }}
        >
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}
