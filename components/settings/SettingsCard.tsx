/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import type { ReactNode } from "react";

/**
 * The container the quiz settings live in.
 *
 * Both screens offer the same settings and only one of them reads well. The
 * edit screen keeps everything in a single panel divided by hairlines; the new
 * screen gave every setting a bordered white card of its own, so seven-odd
 * panels stacked down a very long column, each shouting as loudly as the next
 * and none of them grouped with anything. Identical information, twice the
 * scroll, and no hierarchy to read.
 *
 * This is the edit screen's shape, extracted so that both pages wear it.
 */
export default function SettingsCard({
  title,
  id,
  children,
}: {
  /** Optional heading. A card holding one obvious group can do without. */
  title?: string;
  /** Anchor id, for the "Jump to" row. */
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      {title && <h2 className="text-sm font-bold text-slate-900">{title}</h2>}
      {children}
    </section>
  );
}
