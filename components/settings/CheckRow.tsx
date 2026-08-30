/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import Hint from "@/components/Hint";
import type { HelpEntry } from "@/lib/help";

/**
 * One tickable setting, for the two-column grid the edit screen puts them in.
 *
 * The explanation goes in the balloon rather than under the label. Spelled out
 * in full beneath every checkbox — as the new-quiz screen did — four settings
 * ran to most of a screen, which is how that page came to be so much longer
 * than the edit page for the same set of choices. Folded up, the grid is a grid
 * again, and nothing has been lost: the words are one hover, tap or Tab away,
 * and they are the same words.
 *
 * The balloon's trigger sits outside the `<label>` deliberately. Inside it, a
 * click asking for the explanation would also toggle the setting.
 */
export default function CheckRow({
  label,
  checked,
  onChange,
  help,
  align,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  help?: HelpEntry;
  align?: "left" | "right";
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label className={`flex items-center gap-2 text-sm text-slate-700 ${disabled ? "opacity-40" : ""}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4"
        />
        {label}
      </label>
      {help && <Hint entry={help} align={align} />}
    </div>
  );
}
