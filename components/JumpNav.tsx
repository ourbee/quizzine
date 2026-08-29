/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Jump to the top or the bottom of a long page.
 *
 * Quizzine's longest screens are lists that have to be read in full — forty
 * responses to one question, a class of students down one side, a term of
 * results — and the way out of them was the scroll wheel. This is the lift.
 *
 * It only appears where it is needed. A page that fits on the screen, or has
 * barely more than a screen in it, shows nothing: a floating control on a short
 * page is clutter offering to solve a problem the reader does not have. The
 * arrows also dim individually, so at the top of a page the up arrow is plainly
 * spent rather than silently doing nothing.
 *
 * Never printed, and it steps aside for `prefers-reduced-motion` by jumping
 * instead of gliding.
 */

/** Below this much scrollable overflow, a page does not need a lift. */
const WORTH_IT = 900;

export default function JumpNav() {
  const [show, setShow] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(false);

  const measure = useCallback(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollHeight - window.innerHeight;
    setShow(overflow > WORTH_IT);
    setAtTop(window.scrollY < 120);
    setAtBottom(window.scrollY > overflow - 120);
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    // The pages this matters on grow after they load — answers arrive, a
    // question is switched, a list expands — so the page is watched rather
    // than measured once.
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [measure]);

  if (!show) return null;

  const go = (to: "top" | "bottom") => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: to === "top" ? 0 : document.documentElement.scrollHeight,
      behavior: reduced ? "auto" : "smooth",
    });
  };

  const arrow = "flex h-9 w-9 items-center justify-center text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-default disabled:text-slate-300 disabled:hover:bg-transparent";

  return (
    <div className="no-print fixed bottom-5 right-5 z-40 flex flex-col overflow-hidden rounded-full border border-slate-300 bg-white/95 shadow-lg backdrop-blur">
      <button onClick={() => go("top")} disabled={atTop} className={`${arrow} border-b border-slate-200`} aria-label="Jump to the top of the page" title="Top">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
        </svg>
      </button>
      <button onClick={() => go("bottom")} disabled={atBottom} className={arrow} aria-label="Jump to the bottom of the page" title="Bottom">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3v10M3.5 8.5L8 13l4.5-4.5" />
        </svg>
      </button>
    </div>
  );
}
