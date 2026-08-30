/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { HelpEntry } from "@/lib/help";

/**
 * The explanation a setting keeps folded up beside it — a comic-book thought
 * balloon that emerges when you ask for it.
 *
 * Three deliberate decisions:
 *
 * 1. **Not hover-only.** A hover tooltip does not exist on a phone and does not
 *    exist for anybody driving the page from the keyboard, and the teachers most
 *    in need of the explanation are the likeliest to be on a tablet. So it opens
 *    on hover, on focus, and on tap, closes on Escape, and is wired to its
 *    trigger with `aria-describedby` so a screen reader reads it as description
 *    rather than as stray text. Escape is caught on the document rather than on
 *    the trigger, because in the commonest case — the balloon summoned by a
 *    hovering mouse — the trigger has no focus and would never see the key.
 * 2. **It does not pop twice.** Sweeping a mouse across a grid of settings would
 *    otherwise fire the animation four times in a second, and by the fourth the
 *    balloon has stopped being charming and become noise. A balloon opened
 *    within a moment of the last one appears without the pop. `prefers-reduced-
 *    motion` skips it always.
 * 3. **Slow in, instant out.** A short delay before opening means a mouse merely
 *    passing over the icon never summons anything; closing waits for nothing,
 *    because a balloon that lingers is in the way of the thing you moved to.
 */

/** How long the pointer must rest before the balloon comes. */
const OPEN_DELAY = 120;

/** Inside this window of the last balloon, a new one skips the animation. */
const CALM_AFTER = 1500;

/** Module-level on purpose: the whole page shares one sense of "just now". */
let lastShownAt = 0;

/**
 * The rising trail, largest first — `top` is how far each circle sits above the
 * balloon and `side` how far it has drifted back towards the trigger, both in
 * pixels. Written as numbers rather than utility classes because what matters
 * is the ladder: even gaps, a steady taper, and the last one landing just under
 * the icon that was hovered.
 */
const TRAIL = [
  { top: 6, side: 20, size: 9 },
  { top: 15, side: 14, size: 7 },
  { top: 22, side: 8, size: 5 },
  { top: 27, side: 4, size: 4 },
];

export default function Hint({
  entry,
  align = "left",
  className = "",
}: {
  /** The setting being explained — title, body and its one example. */
  entry: HelpEntry;
  /** Which edge the balloon hangs from; use "right" near the page edge. */
  align?: "left" | "right";
  className?: string;
}) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // A tap has no hover to leave, so touch pins the balloon open until the next
  // tap — on the icon, or anywhere else on the page.
  const [pinned, setPinned] = useState(false);
  // Escape has to beat a pointer that is still resting on the trigger, which
  // would otherwise re-open the balloon the instant it was dismissed. So it is
  // shut deliberately until the pointer leaves or the trigger is focused afresh.
  const [dismissed, setDismissed] = useState(false);
  const [animate, setAnimate] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);

  const open = !dismissed && (hovered || focused || pinned);

  useEffect(() => {
    if (!open) return;
    const calm = Date.now() - lastShownAt > CALM_AFTER;
    const still =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setAnimate(calm && !still);
    lastShownAt = Date.now();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDismissed(true);
      setPinned(false);
      setFocused(false);
      if (wrap.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!pinned) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [pinned]);

  // Cleared on unmount so a balloon cannot open after its section has gone —
  // these sit inside settings that hide one another.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const enter = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovered(true), OPEN_DELAY);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    setHovered(false);
    setDismissed(false);
  };

  return (
    <span ref={wrap} className={`relative inline-flex align-middle ${className}`}>
      {/* Hoisted and de-duplicated by React however many hints a page carries. */}
      <style href="quizzine-hint" precedence="default">{
        "@keyframes quizzine-hint-pop{from{opacity:0;transform:scale(.86) translateY(-4px)}to{opacity:1;transform:none}}"
      }</style>

      <button
        type="button"
        aria-label={`What is “${entry.title}”?`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={() => { setDismissed(false); setFocused(true); }}
        onBlur={() => { setDismissed(false); setFocused(false); }}
        onClick={() => setPinned((p) => !p)}
        className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold leading-none transition ${
          open ? "border-slate-700 bg-slate-700 text-white" : "border-slate-300 text-slate-400 hover:border-slate-500 hover:text-slate-700"
        }`}
      >
        i
      </button>

      {open && (
        <span
          id={id}
          role="tooltip"
          onMouseEnter={enter}
          onMouseLeave={leave}
          style={animate ? { animation: "quizzine-hint-pop 120ms ease-out" } : undefined}
          className={`absolute top-11 z-30 block w-72 max-w-[min(18rem,calc(100vw-2.5rem))] rounded-2xl bg-slate-900 p-3 text-left text-xs font-normal leading-relaxed text-slate-100 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {/* The trail of rising circles that makes it a thought rather than a
              label: smallest at the trigger, each one larger than the last, so
              the eye is carried from the question to the answer. They arrive in
              that order too, bottom of the ladder first — but only when the
              balloon is popping at all, so a sweep across a row of settings
              still does not put on a performance. */}
          {TRAIL.map((dot, i) => (
            <span
              key={dot.top}
              aria-hidden
              style={{
                top: -dot.top,
                [align === "right" ? "right" : "left"]: dot.side,
                width: dot.size,
                height: dot.size,
                animation: animate ? `quizzine-hint-pop 120ms ease-out both` : undefined,
                animationDelay: animate ? `${(TRAIL.length - 1 - i) * 35}ms` : undefined,
              }}
              className="absolute rounded-full bg-slate-900"
            />
          ))}
          <span className="block font-semibold text-white">{entry.title}</span>
          <span className="mt-1 block">{entry.body}</span>
          <span className="mt-2 block border-t border-slate-700 pt-2 text-slate-300">{entry.example}</span>
        </span>
      )}
    </span>
  );
}
