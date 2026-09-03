/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { quizShownOptions, viewQuizzes, type QuizPickRow } from "../lib/quizfilter.ts";

const rows: QuizPickRow[] = [
  { id: "a", title: "Prosody drill", created_at: "2026-07-01T10:00:00Z", responses: 12, accepting: true },
  { id: "b", title: "Ambedkar essay", created_at: "2026-08-01T10:00:00Z", responses: 0, accepting: false },
  { id: "c", title: "Sonnet 18", created_at: "2026-09-01T10:00:00Z", responses: 31, accepting: true },
];

const ids = (rs: QuizPickRow[]) => rs.map((r) => r.id).join(",");

test("newest first by default", () => {
  assert.equal(ids(viewQuizzes(rows)), "c,b,a");
});

test("every sort order", () => {
  assert.equal(ids(viewQuizzes(rows, { sort: "oldest" })), "a,b,c");
  assert.equal(ids(viewQuizzes(rows, { sort: "title" })), "b,a,c");
  assert.equal(ids(viewQuizzes(rows, { sort: "title-desc" })), "c,a,b");
  assert.equal(ids(viewQuizzes(rows, { sort: "responses" })), "c,a,b");
  assert.equal(ids(viewQuizzes(rows, { sort: "responses-asc" })), "b,a,c");
});

test("search matches the title, case-insensitively", () => {
  assert.equal(ids(viewQuizzes(rows, { search: "sonnet" })), "c");
  assert.equal(ids(viewQuizzes(rows, { search: "  ESSAY " })), "b");
  assert.equal(ids(viewQuizzes(rows, { search: "nothing here" })), "");
});

test("search also matches the link slug when the list carries one", () => {
  const withSlug: QuizPickRow[] = [{ ...rows[0], slug: "prosody-x7q2" }];
  assert.equal(ids(viewQuizzes(withSlug, { search: "x7q2" })), "a");
});

test("filters by responses and by whether the quiz is still open", () => {
  assert.equal(ids(viewQuizzes(rows, { shown: "answered" })), "c,a");
  assert.equal(ids(viewQuizzes(rows, { shown: "unanswered" })), "b");
  assert.equal(ids(viewQuizzes(rows, { shown: "open" })), "c,a");
  assert.equal(ids(viewQuizzes(rows, { shown: "closed" })), "b");
});

test("a ticked quiz survives a filter that would otherwise hide it", () => {
  // Otherwise a report can be built on a quiz the teacher can no longer see.
  assert.equal(ids(viewQuizzes(rows, { shown: "answered", selected: ["b"] })), "c,b,a");
});

test("but the search still hides a ticked quiz", () => {
  assert.equal(ids(viewQuizzes(rows, { search: "sonnet", selected: ["b"] })), "c");
});

test("ticked only shows just the selection", () => {
  assert.equal(ids(viewQuizzes(rows, { selectedOnly: true, selected: ["a", "c"] })), "c,a");
  assert.equal(ids(viewQuizzes(rows, { selectedOnly: true, selected: [] })), "");
});

test("open and closed are not offered for a list without that column", () => {
  const bare = rows.map(({ accepting, ...rest }) => rest);
  assert.deepEqual(
    quizShownOptions(bare).map(([v]) => v),
    ["all", "answered", "unanswered"]
  );
  assert.equal(quizShownOptions(rows).length, 5);
});

test("the input list is never reordered in place", () => {
  const before = ids(rows);
  viewQuizzes(rows, { sort: "title" });
  assert.equal(ids(rows), before);
});
