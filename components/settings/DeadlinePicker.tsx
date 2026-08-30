/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useEffect, useRef, useState } from "react";
import ChipGroup from "@/components/settings/ChipGroup";
import SettingRow from "@/components/settings/SettingRow";
import { DEADLINE_PRESETS, describeDeadline, isPast, matchPreset, presetValue, type DeadlinePreset } from "@/lib/deadline";
import { HELP } from "@/lib/help";

/**
 * When the quiz stops accepting new starts.
 *
 * This was a bare datetime-local box on both screens: a teacher who wanted to
 * say "by the end of the week" had to work out which date that was, then say it
 * in the format the box would accept. The chips let them say the thing they
 * meant, and `lib/deadline.ts` does the counting — always landing at 11:59 pm,
 * so a deadline never falls in the middle of an afternoon and costs somebody a
 * submission they thought they had a day for.
 *
 * The resolved date is always printed underneath, because a preset is a claim
 * about a moment that has to be checkable: a teacher who clicks "7 days", is
 * called away, and publishes an hour later can see exactly what was fixed.
 *
 * "No deadline" is a chip rather than an empty field. Left blank, the old
 * control could not tell a teacher who had decided to leave the quiz open from
 * one who had not reached the question yet.
 */
export default function DeadlinePicker({
  value,
  onChange,
}: {
  /** The local "YYYY-MM-DDTHH:mm" the input holds; "" for no deadline. */
  value: string;
  onChange: (next: string) => void;
}) {
  const preset = matchPreset(value);
  // A date the teacher typed stays visible; the box only appears on request,
  // so the common case is four chips rather than a calendar widget.
  const [custom, setCustom] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const showInput = custom || preset === "custom";

  useEffect(() => {
    if (custom) input.current?.focus();
  }, [custom]);

  const choose = (next: DeadlinePreset) => {
    if (next === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    onChange(presetValue(next));
  };

  const past = isPast(value);

  return (
    <SettingRow label="Stop accepting responses" help={HELP.deadline}>
      <ChipGroup
        label="Deadline"
        value={showInput ? "custom" : preset}
        onChange={choose}
        options={DEADLINE_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
      />
      {showInput && (
        <input
          ref={input}
          type="datetime-local"
          aria-label="Closing date and time"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
        />
      )}
      <p className={`text-xs ${past ? "font-semibold text-amber-700" : "text-slate-500"}`}>
        {describeDeadline(value)}
        {past && " That moment has passed, so nobody new can begin."}
      </p>
    </SettingRow>
  );
}
