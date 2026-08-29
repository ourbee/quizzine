/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import Link from "next/link";

/**
 * The strip every teacher page wears: where you came from on the left, who you
 * are signed in as and the way out on the right.
 *
 * Sign out used to be an underlined fragment inside a sentence on the dashboard
 * and nowhere else at all, so leaving from any other screen meant navigating
 * back to find it. It is a button here, and it is on every page.
 */
export default function TeacherBar({
  back = { href: "/teacher", label: "← Dashboard" },
  owner,
  children,
}: {
  /** Where "back" goes. Pass null on the dashboard itself, which is the root. */
  back?: { href: string; label: string } | null;
  /** The signed-in email, when the page has already fetched it. */
  owner?: string;
  /** Page-specific controls, shown between the two. */
  children?: React.ReactNode;
}) {
  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    // A full navigation rather than a client push: every teacher page holds
    // somebody's quizzes in state, and signing out must leave none of it behind.
    window.location.href = "/teacher";
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <div className="flex items-center gap-3">
        {back && (
          <Link href={back.href} className="text-slate-500 hover:text-slate-800">
            {back.label}
          </Link>
        )}
        {children}
      </div>
      <div className="flex items-center gap-2">
        {owner && <span className="text-xs text-slate-400">{owner}</span>}
        <button
          onClick={signOut}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
