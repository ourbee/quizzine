/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useState } from "react";

/**
 * The row of pill buttons Quizzine picks one of anything with: timer mode,
 * who attempts the paper, how multiple answers are marked, how an adaptive
 * paper is scored.
 *
 * The part worth having written down is what happens to an option that cannot
 * be chosen. A per-question countdown is unavailable under Exam Interface mode
 * for a real reason, and the old markup said so in a `title` on a `disabled`
 * button — which is to say it said so to almost nobody. A dimmed control with
 * no stated reason reads as a bug, and a genuinely `disabled` button fires no
 * pointer events, so the tooltip meant to explain it never even opened.
 *
 * So an unavailable chip is `aria-disabled` rather than `disabled`: it stays
 * focusable, it stays hoverable, it does nothing when pressed, and asking it
 * anything at all prints the reason underneath in plain sight.
 */

export interface Chip<T> {
  value: T;
  label: string;
  /** Present when the option cannot be chosen — and why, in a short sentence. */
  unavailable?: string;
}

export default function ChipGroup<T extends string | number | boolean>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Chip<T>[];
  onChange: (next: T) => void;
  /** Names the group for a screen reader, since the chips have no <fieldset>. */
  label: string;
}) {
  const [reason, setReason] = useState<string | null>(null);

  return (
    <div>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2 text-sm">
        {options.map((chip) => {
          const chosen = chip.value === value;
          const off = !!chip.unavailable;
          return (
            <button
              key={String(chip.value)}
              type="button"
              aria-pressed={chosen}
              aria-disabled={off || undefined}
              onClick={() => (off ? setReason(chip.unavailable!) : onChange(chip.value))}
              onMouseEnter={() => off && setReason(chip.unavailable!)}
              onMouseLeave={() => off && setReason(null)}
              onFocus={() => off && setReason(chip.unavailable!)}
              onBlur={() => off && setReason(null)}
              className={`rounded-lg px-4 py-2 font-medium transition ${
                chosen ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              } ${off ? "cursor-not-allowed opacity-40" : ""}`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
      {reason && <p className="mt-2 text-xs text-amber-700">{reason}</p>}
    </div>
  );
}
