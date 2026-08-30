/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import type { ReactNode } from "react";
import Hint from "@/components/Hint";
import type { HelpEntry } from "@/lib/help";

/**
 * One setting inside a `SettingsCard`: its name, its explanation folded into a
 * balloon beside it, and its controls.
 *
 * The divider is a hairline above rather than a border all round — the rule
 * that makes the edit screen's settings read as one grouped panel instead of a
 * stack of competing cards. The first row in a card has none, so a card never
 * opens with a line under its own heading.
 *
 * `note` is for what the current choice means and changes as it changes;
 * `help` is for what the setting is at all, and does not.
 */
export default function SettingRow({
  label,
  help,
  note,
  align,
  children,
}: {
  label: string;
  /** The entry from `lib/help.ts`; omit for a setting that explains itself. */
  help?: HelpEntry;
  /** A line under the controls, describing the choice as it stands. */
  note?: ReactNode;
  /** Passed through to the balloon for rows sitting near the page edge. */
  align?: "left" | "right";
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        {help && <Hint entry={help} align={align} />}
      </div>
      {children}
      {note && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
}
