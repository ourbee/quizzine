/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

// Narrowing a term's worth of quizzes down to the handful a report is about.
// Both report pages hold every quiz the teacher owns in memory already, so the
// search and the sort happen here rather than in another database round trip —
// asking the server to re-narrow a list that is already loaded would only make
// typing feel slower.

export interface QuizPickRow {
  id: string;
  title: string;
  created_at: string;
  responses: string | number;
  /** Whether the quiz is still taking submissions. Absent on lists that omit it. */
  accepting?: boolean;
  slug?: string;
}

export type QuizSort =
  | "newest"
  | "oldest"
  | "title"
  | "title-desc"
  | "responses"
  | "responses-asc";

export type QuizShown = "all" | "answered" | "unanswered" | "open" | "closed";

export const QUIZ_SORTS: [QuizSort, string][] = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["title", "Title A–Z"],
  ["title-desc", "Title Z–A"],
  ["responses", "Most responses"],
  ["responses-asc", "Fewest responses"],
];

export const QUIZ_SHOWN: [QuizShown, string][] = [
  ["all", "All quizzes"],
  ["answered", "With responses"],
  ["unanswered", "No responses yet"],
  ["open", "Open"],
  ["closed", "Closed"],
];

export const DEFAULT_QUIZ_SORT: QuizSort = "newest";

export function isQuizSort(v: unknown): v is QuizSort {
  return QUIZ_SORTS.some(([s]) => s === v);
}

export function isQuizShown(v: unknown): v is QuizShown {
  return QUIZ_SHOWN.some(([s]) => s === v);
}

const count = (r: QuizPickRow) => Number(r.responses) || 0;
const time = (r: QuizPickRow) => new Date(r.created_at).getTime() || 0;

export interface QuizViewOptions {
  search?: string;
  sort?: QuizSort;
  shown?: QuizShown;
  /** Roll the picker down to what is already ticked. */
  selectedOnly?: boolean;
  selected?: Iterable<string>;
}

/**
 * The quiz list as the picker actually shows it: searched, filtered, sorted.
 *
 * A quiz that is already ticked is never hidden by the filters, only by the
 * search. Hiding a ticked quiz would let a teacher build a report on a quiz
 * they can no longer see, which is how a report ends up with a column nobody
 * can account for.
 */
export function viewQuizzes(rows: QuizPickRow[], options: QuizViewOptions = {}): QuizPickRow[] {
  const { search = "", sort = DEFAULT_QUIZ_SORT, shown = "all", selectedOnly = false } = options;
  const selected = new Set(options.selected ?? []);
  const needle = search.trim().toLowerCase();

  const kept = rows.filter((r) => {
    if (needle && !`${r.title} ${r.slug ?? ""}`.toLowerCase().includes(needle)) return false;
    if (selectedOnly) return selected.has(r.id);
    if (selected.has(r.id)) return true;
    if (shown === "answered") return count(r) > 0;
    if (shown === "unanswered") return count(r) === 0;
    if (shown === "open") return r.accepting !== false;
    if (shown === "closed") return r.accepting === false;
    return true;
  });

  return kept.sort((a, b) => {
    switch (sort) {
      case "title":
        return a.title.localeCompare(b.title) || time(b) - time(a);
      case "title-desc":
        return b.title.localeCompare(a.title) || time(b) - time(a);
      case "responses":
        return count(b) - count(a) || time(b) - time(a);
      case "responses-asc":
        return count(a) - count(b) || time(b) - time(a);
      case "oldest":
        return time(a) - time(b) || a.title.localeCompare(b.title);
      default:
        return time(b) - time(a) || a.title.localeCompare(b.title);
    }
  });
}

/**
 * The filters worth offering for a given list. Open and closed are dropped when
 * the list was loaded without that column, rather than shown as choices that
 * quietly match everything.
 */
export function quizShownOptions(rows: QuizPickRow[]): [QuizShown, string][] {
  const hasState = rows.some((r) => typeof r.accepting === "boolean");
  return QUIZ_SHOWN.filter(([v]) => hasState || (v !== "open" && v !== "closed"));
}
