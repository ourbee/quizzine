/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * Closing times, in the shape a teacher actually thinks in.
 *
 * The field behind all of this is one ISO instant, `settings.closesAt`, after
 * which no student may start. What the teacher wants to say, though, is "by
 * tonight" or "a week" — and the bare datetime-local box made them work that
 * out on a calendar, in a format they had to satisfy, before they could say it.
 *
 * Two rules make the presets safe:
 *
 * 1. Every preset lands at 11:59 pm local. "7 days" clicked at 3:07 pm must not
 *    close the paper at 3:07 pm next Monday; a deadline that falls in the middle
 *    of an afternoon costs somebody a submission, and the teacher never
 *    intended a time of day at all. Days are the unit; the time is always the
 *    last minute of the day.
 * 2. A preset resolves to an absolute instant the moment it is clicked, so the
 *    picker always shows the resolved date back in words. A teacher who opens
 *    the settings step, is called away, and publishes an hour later can see
 *    exactly what "tonight" was fixed to mean.
 *
 * Arithmetic is done on a local Date and only then pinned to 23:59, which keeps
 * it honest across a daylight-saving change: seven days later is the same clock
 * time seven dates on, not 168 hours.
 */

export type DeadlinePreset = "none" | "today" | "week" | "month" | "year" | "custom";

/** The chips, in the order they are offered. */
export const DEADLINE_PRESETS: { id: DeadlinePreset; label: string }[] = [
  { id: "none", label: "No deadline" },
  { id: "today", label: "Tonight" },
  { id: "week", label: "7 days" },
  { id: "month", label: "30 days" },
  { id: "year", label: "1 year" },
  { id: "custom", label: "Pick a date…" },
];

/** How many days on each dated preset means. `custom` and `none` have none. */
const DAYS: Partial<Record<DeadlinePreset, number>> = { today: 0, week: 7, month: 30 };

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO instant → the local "YYYY-MM-DDTHH:mm" a datetime-local input wants. */
export function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local value → the ISO instant we store. Empty stays empty. */
export function fromLocalInput(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * The last minute of the day `addDays` from `base`, as a datetime-local value.
 * Rolling the date first and the clock second is what makes this safe over a
 * month end and a daylight-saving boundary alike.
 */
export function endOfDayAfter(addDays: number, base: Date = new Date()): string {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + addDays);
  d.setHours(23, 59, 0, 0);
  return toLocalInput(d.toISOString());
}

/** What a chip fills the field with. `none` clears it; `custom` leaves it be. */
export function presetValue(preset: DeadlinePreset, base: Date = new Date()): string {
  if (preset === "none") return "";
  if (preset === "year") {
    const d = new Date(base.getTime());
    d.setFullYear(d.getFullYear() + 1);
    d.setHours(23, 59, 0, 0);
    return toLocalInput(d.toISOString());
  }
  const days = DAYS[preset];
  return days === undefined ? "" : endOfDayAfter(days, base);
}

/**
 * Which chip should look chosen for the value now in the field.
 *
 * Deliberately re-derived from the value rather than remembered: a deadline set
 * to "tonight" yesterday is simply a date today, and the chip row should say so
 * instead of claiming a preset that no longer describes it.
 */
export function matchPreset(local: string, base: Date = new Date()): DeadlinePreset {
  if (!local) return "none";
  for (const preset of ["today", "week", "month", "year"] as const) {
    if (presetValue(preset, base) === local) return preset;
  }
  return "custom";
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 23:59 → "11:59 pm", 00:00 → "12:00 am". */
function clockLabel(d: Date): string {
  const h = d.getHours();
  const suffix = h < 12 ? "am" : "pm";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:${pad(d.getMinutes())} ${suffix}`;
}

/**
 * The line printed under the chips: the instant a preset resolved to, spelled
 * out. Written by hand rather than by `toLocaleString` so that it reads the
 * same in British English wherever the teacher's browser thinks it is, and so
 * that it is worth writing a test about.
 */
export function describeDeadline(local: string, base: Date = new Date()): string {
  if (!local) return "Open until you close it by hand.";
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === base.getFullYear();
  const date = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}${sameYear ? "" : ` ${d.getFullYear()}`}`;
  return `Closes ${date}, ${clockLabel(d)}.`;
}

/** A deadline already gone — worth saying plainly, since it publishes shut. */
export function isPast(local: string, base: Date = new Date()): boolean {
  if (!local) return false;
  const d = new Date(local);
  return !Number.isNaN(d.getTime()) && d.getTime() <= base.getTime();
}
