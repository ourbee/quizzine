/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_QUIZ_SORT,
  QUIZ_SORTS,
  isQuizShown,
  isQuizSort,
  quizShownOptions,
  viewQuizzes,
  type QuizPickRow,
  type QuizShown,
  type QuizSort,
} from "@/lib/quizfilter";

/**
 * The quiz chooser shared by the marks report and the strengths report.
 *
 * A teacher with three terms behind them has more quizzes than fit on a screen,
 * and both reports begin by asking which of them to pool. Searching and sorting
 * belong to that question, not to either page, so they live here once.
 */
export default function QuizPicker({
  quizzes,
  selected,
  onChange,
  storageKey,
  columns = 2,
  maxHeight = "22rem",
  emptyNote = "No quizzes yet.",
  children,
}: {
  quizzes: QuizPickRow[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Remembers the search's sort and filter between visits. */
  storageKey?: string;
  columns?: 1 | 2;
  maxHeight?: string;
  emptyNote?: string;
  children?: React.ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<QuizSort>(DEFAULT_QUIZ_SORT);
  const [shown, setShown] = useState<QuizShown>("all");
  const [selectedOnly, setSelectedOnly] = useState(false);

  // The view is restored, never the search text: a teacher returning to the page
  // wants their ordering back, not a list mysteriously narrowed to one word.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (isQuizSort(saved?.sort)) setSort(saved.sort);
      if (isQuizShown(saved?.shown)) setShown(saved.shown);
    } catch {
      /* ignore a corrupt view */
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ sort, shown }));
    } catch {
      /* private browsing, or a full quota — the view is not worth an error */
    }
  }, [storageKey, sort, shown]);

  const picked = useMemo(() => new Set(selected), [selected]);
  const visible = useMemo(
    () => viewQuizzes(quizzes, { search, sort, shown, selectedOnly, selected: picked }),
    [quizzes, search, sort, shown, selectedOnly, picked]
  );
  const shownOptions = useMemo(() => quizShownOptions(quizzes), [quizzes]);
  const narrowed = visible.length !== quizzes.length;

  function toggle(id: string) {
    onChange(picked.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  /** Adds what is on screen rather than everything, so a search can be a shortcut. */
  function selectVisible() {
    const next = [...selected];
    for (const z of visible) if (!picked.has(z.id)) next.push(z.id);
    onChange(next);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[11rem] flex-1">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search quizzes by title…"
            aria-label="Search quizzes by title"
            className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear the search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              Clear
            </button>
          )}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as QuizSort)}
          aria-label="Sort the quizzes"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
        >
          {QUIZ_SORTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={shown}
          onChange={(e) => setShown(e.target.value as QuizShown)}
          aria-label="Filter the quizzes"
          disabled={selectedOnly}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"
        >
          {shownOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          onClick={() => setSelectedOnly((v) => !v)}
          aria-pressed={selectedOnly}
          disabled={!selected.length}
          className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40 ${
            selectedOnly
              ? "bg-slate-900 text-white"
              : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
          }`}
        >
          Ticked only
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-slate-500">
          {selected.length} selected
          {narrowed && ` · showing ${visible.length} of ${quizzes.length}`}
        </span>
        <button
          onClick={selectVisible}
          disabled={!visible.length}
          className="font-semibold text-blue-700 hover:underline disabled:opacity-40"
        >
          {narrowed ? `Select these ${visible.length}` : "Select all"}
        </button>
        <button
          onClick={() => onChange([])}
          disabled={!selected.length}
          className="font-semibold text-slate-500 hover:underline disabled:opacity-40"
        >
          Clear selection
        </button>
        {children}
      </div>

      {quizzes.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{emptyNote}</p>
      ) : visible.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No quiz matches that search or filter.{" "}
          <button
            onClick={() => {
              setSearch("");
              setShown("all");
              setSelectedOnly(false);
            }}
            className="font-semibold text-blue-700 hover:underline"
          >
            Show them all
          </button>
        </p>
      ) : (
        <div
          className={`mt-3 grid gap-2 overflow-y-auto ${columns === 2 ? "sm:grid-cols-2" : ""}`}
          style={{ maxHeight }}
        >
          {visible.map((z) => (
            <label
              key={z.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                picked.has(z.id) ? "border-blue-300 bg-blue-50/60" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                checked={picked.has(z.id)}
                onChange={() => toggle(z.id)}
                className="h-4 w-4"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{z.title}</span>
                <span className="block text-xs text-slate-500">
                  {Number(z.responses) || 0} response{Number(z.responses) === 1 ? "" : "s"} ·{" "}
                  {new Date(z.created_at).toLocaleDateString()}
                  {z.accepting === false && " · closed"}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
