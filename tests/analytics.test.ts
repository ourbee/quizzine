/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_ANALYTICS,
  buildAnalytics,
  groupByDimension,
  type AnalyticsAttempt,
  type AnalyticsOptions,
  type AnalyticsQuestion,
  type AnalyticsQuiz,
} from "../lib/analytics.ts";
import type { PerQuestionResult } from "../lib/types.ts";

function question(id: string, tags: string[], difficulty?: number): AnalyticsQuestion {
  return { id, text: `Question ${id}`, tags, difficulty, points: 1, graded: true, autoMarked: true };
}

/** A quiz of `n` questions all carrying the same tags. */
function quiz(id: string, createdAt: string, tags: string[], n: number, difficulty?: number): AnalyticsQuiz {
  return {
    id,
    title: id,
    created_at: createdAt,
    questions: Array.from({ length: n }, (_, i) => question(`q${i + 1}`, tags, difficulty)),
  };
}

/** An attempt where the first `right` questions are correct and the rest wrong. */
function attempt(
  quizId: string,
  roll: string,
  n: number,
  right: number,
  extra: Partial<AnalyticsAttempt> = {}
): AnalyticsAttempt {
  const per: PerQuestionResult[] = Array.from({ length: n }, (_, i) => ({
    qid: `q${i + 1}`,
    answer: "A",
    correct: i < right,
    awarded: i < right ? 1 : 0,
    pending: false,
  }));
  return {
    id: `${quizId}-${roll}`,
    quiz_id: quizId,
    student: { name: `Student ${roll}`, roll, semester: 3, nameNorm: `student ${roll}`, rollNorm: roll },
    group_info: null,
    per_question: per,
    score: right,
    max_score: n,
    submitted_at: `2026-07-0${quizId.slice(-1)}T10:00:00Z`,
    ...extra,
  };
}

const opts = (over: Partial<AnalyticsOptions> = {}): AnalyticsOptions => ({ ...DEFAULT_ANALYTICS, ...over });

test("marks are attributed to every tag a question carries", () => {
  const quizzes = [quiz("z1", "2026-07-01T10:00:00Z", ["Period: Victorian", "Genre: Poetry"], 10)];
  const result = buildAnalytics(quizzes, [attempt("z1", "101", 10, 7)], opts());
  const student = result.students[0];
  const victorian = student.rows.find((r) => r.tag === "Period: Victorian")!;
  const poetry = student.rows.find((r) => r.tag === "Genre: Poetry")!;
  assert.equal(victorian.percent, 70);
  assert.equal(poetry.percent, 70, "one question counts fully into both of its buckets");
  assert.equal(student.percent, 70);
});

test("a thin bucket is reported as insufficient rather than as a weakness", () => {
  const quizzes: AnalyticsQuiz[] = [
    {
      id: "z1",
      title: "z1",
      created_at: "2026-07-01T10:00:00Z",
      questions: [
        // Three Chaucer questions, all wrong; ten others, all right.
        ...Array.from({ length: 3 }, (_, i) => question(`q${i + 1}`, ["Author: Chaucer"])),
        ...Array.from({ length: 10 }, (_, i) => question(`q${i + 4}`, ["Author: Tennyson"])),
      ],
    },
  ];
  const per: PerQuestionResult[] = [
    ...Array.from({ length: 3 }, (_, i) => ({ qid: `q${i + 1}`, correct: false, awarded: 0, pending: false })),
    ...Array.from({ length: 10 }, (_, i) => ({ qid: `q${i + 4}`, correct: true, awarded: 1, pending: false })),
  ];
  const a: AnalyticsAttempt = {
    ...attempt("z1", "101", 0, 0),
    per_question: per,
    score: 10,
    max_score: 13,
  };
  const result = buildAnalytics(quizzes, [a], opts({ minEvidence: 5 }));
  const student = result.students[0];
  const chaucer = student.rows.find((r) => r.tag === "Author: Chaucer")!;

  assert.equal(chaucer.percent, 0);
  assert.equal(chaucer.verdict, "insufficient", "3 questions cannot make a weakness");
  assert.equal(chaucer.belowPass, false, "and cannot be called not-exam-ready either");
  assert.ok(
    !student.weaknesses.some((r) => r.tag === "Author: Chaucer"),
    "a thin bucket never reaches the weakness list"
  );
  assert.ok(student.insufficient.some((r) => r.tag === "Author: Chaucer"));
});

test("the same thin bucket becomes a real weakness once enough is asked", () => {
  const quizzes: AnalyticsQuiz[] = [
    {
      id: "z1",
      title: "z1",
      created_at: "2026-07-01T10:00:00Z",
      questions: [
        ...Array.from({ length: 6 }, (_, i) => question(`q${i + 1}`, ["Author: Chaucer"])),
        ...Array.from({ length: 10 }, (_, i) => question(`q${i + 7}`, ["Author: Tennyson"])),
      ],
    },
  ];
  const per: PerQuestionResult[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ qid: `q${i + 1}`, correct: false, awarded: 0, pending: false })),
    ...Array.from({ length: 10 }, (_, i) => ({ qid: `q${i + 7}`, correct: true, awarded: 1, pending: false })),
  ];
  const result = buildAnalytics(
    quizzes,
    [{ ...attempt("z1", "101", 0, 0), per_question: per, score: 10, max_score: 16 }],
    opts({ minEvidence: 5 })
  );
  const chaucer = result.students[0].rows.find((r) => r.tag === "Author: Chaucer")!;
  assert.equal(chaucer.verdict, "weakness");
  assert.equal(chaucer.belowPass, true);
});

test("a gap is measured against the student's own average, not a fixed line", () => {
  // A strong student at 90% overall who scores 70% on one tag is weak on it,
  // even though 70% would be a fine mark for someone else.
  const quizzes: AnalyticsQuiz[] = [
    {
      id: "z1",
      title: "z1",
      created_at: "2026-07-01T10:00:00Z",
      questions: [
        ...Array.from({ length: 10 }, (_, i) => question(`q${i + 1}`, ["Genre: Criticism"])),
        ...Array.from({ length: 10 }, (_, i) => question(`q${i + 11}`, ["Genre: Poetry"])),
      ],
    },
  ];
  const per: PerQuestionResult[] = [
    ...Array.from({ length: 10 }, (_, i) => ({ qid: `q${i + 1}`, correct: i < 7, awarded: i < 7 ? 1 : 0, pending: false })),
    ...Array.from({ length: 10 }, (_, i) => ({ qid: `q${i + 11}`, correct: true, awarded: 1, pending: false })),
  ];
  const result = buildAnalytics(
    quizzes,
    [{ ...attempt("z1", "101", 0, 0), per_question: per, score: 17, max_score: 20 }],
    opts()
  );
  const student = result.students[0];
  const criticism = student.rows.find((r) => r.tag === "Genre: Criticism")!;
  assert.equal(student.percent, 85);
  assert.equal(criticism.percent, 70);
  assert.equal(criticism.vsSelf, -15);
  assert.equal(criticism.verdict, "weakness");
  assert.equal(criticism.belowPass, false, "70% is still well above the pass mark");
});

test("the class comparison leaves the student's own marks out of it", () => {
  const quizzes = [quiz("z1", "2026-07-01T10:00:00Z", ["Genre: Criticism"], 10)];
  const attempts = [attempt("z1", "101", 10, 2), attempt("z1", "102", 10, 8), attempt("z1", "103", 10, 8)];
  const result = buildAnalytics(quizzes, attempts, opts());
  const weak = result.students.find((s) => s.roll === "101")!;
  const row = weak.rows.find((r) => r.tag === "Genre: Criticism")!;
  assert.equal(row.percent, 20);
  assert.equal(row.classPercent, 80, "the other two scored 16/20 between them");
  assert.equal(row.vsClass, -60);
});

test("a whole class failing one tag shows up as a teaching problem", () => {
  const quizzes = [quiz("z1", "2026-07-01T10:00:00Z", ["Genre: Criticism"], 10)];
  const attempts = [attempt("z1", "101", 10, 2), attempt("z1", "102", 10, 3), attempt("z1", "103", 10, 2)];
  const result = buildAnalytics(quizzes, attempts, opts());
  const row = result.classRows.find((r) => r.tag === "Genre: Criticism")!;
  assert.equal(row.students, 3);
  assert.equal(row.reliableStudents, 3);
  assert.equal(row.belowPass, true);
  assert.equal(row.strugglingStudents, 3);
});

test("a tag's trend runs in quiz date order and reports the movement", () => {
  const quizzes = [
    quiz("z1", "2026-07-01T10:00:00Z", ["Genre: Criticism"], 10),
    quiz("z2", "2026-07-08T10:00:00Z", ["Genre: Criticism"], 10),
    quiz("z3", "2026-07-15T10:00:00Z", ["Genre: Criticism"], 10),
    quiz("z4", "2026-07-22T10:00:00Z", ["Genre: Criticism"], 10),
  ];
  const attempts = [
    attempt("z1", "101", 10, 4),
    attempt("z2", "101", 10, 5),
    attempt("z3", "101", 10, 8),
    attempt("z4", "101", 10, 9),
  ];
  const row = buildAnalytics(quizzes, attempts, opts()).students[0].rows[0];
  assert.deepEqual(
    row.trend.map((t) => t.percent),
    [40, 50, 80, 90]
  );
  assert.equal(row.delta, 40, "the later half averages 85 against the earlier half's 45");
});

test("quizzes given out of order still trend by date, not by arrival", () => {
  const quizzes = [
    quiz("z2", "2026-07-08T10:00:00Z", ["Genre: Criticism"], 10),
    quiz("z1", "2026-07-01T10:00:00Z", ["Genre: Criticism"], 10),
  ];
  const attempts = [attempt("z2", "101", 10, 9), attempt("z1", "101", 10, 4)];
  const row = buildAnalytics(quizzes, attempts, opts()).students[0].rows[0];
  assert.deepEqual(
    row.trend.map((t) => t.percent),
    [40, 90]
  );
});

test("unmarked essays are counted as unanalysable, never as wrong", () => {
  const quizzes: AnalyticsQuiz[] = [
    {
      id: "z1",
      title: "z1",
      created_at: "2026-07-01T10:00:00Z",
      questions: [
        question("q1", ["Genre: Poetry"]),
        question("q2", ["Genre: Poetry"]),
        { id: "q3", text: "Discuss", tags: ["Genre: Poetry"], points: 10, graded: true, autoMarked: false },
      ],
    },
  ];
  const per: PerQuestionResult[] = [
    { qid: "q1", correct: true, awarded: 1, pending: false },
    { qid: "q2", correct: true, awarded: 1, pending: false },
    { qid: "q3", answer: "an essay", awarded: 0, pending: true },
  ];
  const result = buildAnalytics(
    quizzes,
    [{ ...attempt("z1", "101", 0, 0), per_question: per, score: 2, max_score: 12 }],
    opts()
  );
  const row = result.students[0].rows[0];
  assert.equal(row.attempted, 2, "the essay contributes nothing to the tag");
  assert.equal(row.percent, 100, "and does not drag the topic down to 2/12");
  assert.equal(result.unanalysableQuestions, 1);
});

test("polls and surveys are left out entirely", () => {
  const quizzes: AnalyticsQuiz[] = [
    {
      id: "z1",
      title: "z1",
      created_at: "2026-07-01T10:00:00Z",
      questions: [
        question("q1", ["Genre: Poetry"]),
        { id: "q2", text: "Your view?", tags: ["Genre: Poetry"], points: 0, graded: false, autoMarked: true },
      ],
    },
  ];
  const per: PerQuestionResult[] = [
    { qid: "q1", correct: true, awarded: 1, pending: false },
    { qid: "q2", answer: "B", awarded: 0, pending: false, ungraded: true },
  ];
  const result = buildAnalytics(
    quizzes,
    [{ ...attempt("z1", "101", 0, 0), per_question: per, score: 1, max_score: 1 }],
    opts()
  );
  assert.equal(result.students[0].rows[0].attempted, 1);
  assert.equal(result.untaggedQuestions, 0);
});

test("only one attempt per student per quiz counts", () => {
  const quizzes = [quiz("z1", "2026-07-01T10:00:00Z", ["Genre: Poetry"], 10)];
  const first = { ...attempt("z1", "101", 10, 3), id: "a1", submitted_at: "2026-07-01T10:00:00Z" };
  const second = { ...attempt("z1", "101", 10, 9), id: "a2", submitted_at: "2026-07-02T10:00:00Z" };

  const best = buildAnalytics(quizzes, [first, second], opts({ repeats: "best" }));
  assert.equal(best.students[0].rows[0].percent, 90);
  assert.equal(best.students[0].rows[0].attempted, 10, "not 20 — the discarded try is not pooled in");

  const latest = buildAnalytics(quizzes, [second, first], opts({ repeats: "latest" }));
  assert.equal(latest.students[0].rows[0].percent, 90);
});

test("a group submission credits every member", () => {
  const quizzes = [quiz("z1", "2026-07-01T10:00:00Z", ["Genre: Poetry"], 10)];
  const group = attempt("z1", "101", 10, 6, {
    group_info: {
      name: "Team A",
      nameNorm: "team a",
      semester: 3,
      members: [
        { name: "Asha", roll: "101" },
        { name: "Bilal", roll: "102" },
      ],
    },
  });
  const result = buildAnalytics(quizzes, [group], opts());
  assert.equal(result.students.length, 2);
  for (const s of result.students) {
    assert.equal(s.rows[0].percent, 60);
    assert.equal(s.quizLines[0].viaGroup, "Team A");
  }
});

test("merged roll numbers are one student", () => {
  const quizzes = [
    quiz("z1", "2026-07-01T10:00:00Z", ["Genre: Poetry"], 10),
    quiz("z2", "2026-07-08T10:00:00Z", ["Genre: Poetry"], 10),
  ];
  const attempts = [attempt("z1", "101", 10, 4), attempt("z2", "22101", 10, 8)];
  const result = buildAnalytics(quizzes, attempts, opts({ aliases: { "22101": "101" } }));
  assert.equal(result.students.length, 1);
  assert.equal(result.students[0].rows[0].attempted, 20);
  assert.equal(result.students[0].rows[0].percent, 60);
});

test("the group view reports on the chosen students only", () => {
  const quizzes = [quiz("z1", "2026-07-01T10:00:00Z", ["Genre: Poetry"], 10)];
  const attempts = [attempt("z1", "101", 10, 2), attempt("z1", "102", 10, 8), attempt("z1", "103", 10, 9)];
  const result = buildAnalytics(quizzes, attempts, opts({ rolls: ["101", "102"] }));
  assert.deepEqual(
    result.students.map((s) => s.roll).sort(),
    ["101", "102"]
  );
  assert.equal(result.classRows[0].students, 2, "the third student is not pooled into the comparison");
});

test("difficulty is reported as its own dimension", () => {
  const quizzes: AnalyticsQuiz[] = [
    {
      id: "z1",
      title: "z1",
      created_at: "2026-07-01T10:00:00Z",
      questions: [
        ...Array.from({ length: 6 }, (_, i) => question(`q${i + 1}`, ["Genre: Poetry"], 2)),
        ...Array.from({ length: 6 }, (_, i) => question(`q${i + 7}`, ["Genre: Poetry"], 5)),
      ],
    },
  ];
  const per: PerQuestionResult[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ qid: `q${i + 1}`, correct: true, awarded: 1, pending: false })),
    ...Array.from({ length: 6 }, (_, i) => ({ qid: `q${i + 7}`, correct: false, awarded: 0, pending: false })),
  ];
  const result = buildAnalytics(
    quizzes,
    [{ ...attempt("z1", "101", 0, 0), per_question: per, score: 6, max_score: 12 }],
    opts()
  );
  const rows = result.students[0].difficultyRows;
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.value.startsWith("2"))!.percent, 100);
  assert.equal(rows.find((r) => r.value.startsWith("5"))!.percent, 0);
  assert.ok(
    result.students[0].rows.every((r) => r.dimension !== "Difficulty"),
    "difficulty stays out of the topic rows so it cannot be double-counted"
  );
});

test("wrong answers are listed only where the topic is actually weak", () => {
  const quizzes: AnalyticsQuiz[] = [
    {
      id: "z1",
      title: "Unit 1",
      created_at: "2026-07-01T10:00:00Z",
      questions: [
        ...Array.from({ length: 6 }, (_, i) => question(`q${i + 1}`, ["Genre: Criticism"])),
        ...Array.from({ length: 10 }, (_, i) => question(`q${i + 7}`, ["Genre: Poetry"])),
      ],
    },
  ];
  const per: PerQuestionResult[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ qid: `q${i + 1}`, correct: false, awarded: 0, pending: false })),
    // One slip on a topic that is otherwise strong.
    ...Array.from({ length: 10 }, (_, i) => ({ qid: `q${i + 7}`, correct: i > 0, awarded: i > 0 ? 1 : 0, pending: false })),
  ];
  const result = buildAnalytics(
    quizzes,
    [{ ...attempt("z1", "101", 0, 0), per_question: per, score: 9, max_score: 16 }],
    opts()
  );
  const misses = result.students[0].misses;
  assert.equal(misses.length, 6, "the six criticism questions, not the single poetry slip");
  assert.ok(misses.every((m) => m.tags.includes("Genre: Criticism")));
  assert.equal(misses[0].quizTitle, "Unit 1");
});

test("untagged questions are counted so the teacher knows what is missing", () => {
  const quizzes: AnalyticsQuiz[] = [
    {
      id: "z1",
      title: "z1",
      created_at: "2026-07-01T10:00:00Z",
      questions: [question("q1", ["Genre: Poetry"]), question("q2", [])],
    },
  ];
  const result = buildAnalytics(quizzes, [], opts());
  assert.equal(result.untaggedQuestions, 1);
});

test("rows group into dimensions for display", () => {
  const quizzes = [quiz("z1", "2026-07-01T10:00:00Z", ["Period: Victorian", "Genre: Poetry"], 10)];
  const result = buildAnalytics(quizzes, [attempt("z1", "101", 10, 7)], opts());
  const groups = groupByDimension(result.students[0].rows);
  assert.deepEqual(
    groups.map((g) => g.dimension),
    ["Genre", "Period"]
  );
});

test("a marked written answer joins the report instead of being unanalysable", () => {
  const quizzes: AnalyticsQuiz[] = [
    {
      id: "z1",
      title: "z1",
      created_at: "2026-07-01T10:00:00Z",
      questions: [
        question("q1", ["Genre: Poetry"]),
        { id: "q2", text: "Discuss", tags: ["Genre: Poetry"], points: 10, graded: true, autoMarked: false },
      ],
      rubric: {
        bands: [
          {
            id: "a",
            label: "Content",
            params: [
              { id: "a1", label: "Correctness", weight: 60 },
              { id: "a2", label: "Evidence", weight: 40 },
            ],
          },
        ],
      },
    },
  ];
  // The essay has been marked at 70%, so it carries a real per-question result.
  const per: PerQuestionResult[] = [
    { qid: "q1", correct: true, awarded: 1, pending: false },
    { qid: "q2", answer: "an essay", correct: false, awarded: 7, pending: false },
  ];
  const result = buildAnalytics(
    quizzes,
    [
      {
        ...attempt("z1", "101", 0, 0),
        per_question: per,
        score: 8,
        max_score: 11,
        marking: {
          q2: {
            teacher: { params: { a1: 48, a2: 22 }, percent: 70, at: "2026-08-28T00:00:00.000Z" },
          },
        },
      },
    ],
    opts()
  );

  const row = result.students[0].rows[0];
  assert.equal(row.attempted, 2, "the marked essay now counts towards the topic");
  assert.equal(row.awarded, 8);
  assert.equal(row.possible, 11);
  assert.equal(result.unanalysableQuestions, 0, "nothing is waiting to be marked any more");

  // And the rubric itself becomes a dimension of its own.
  const byId = Object.fromEntries(result.rubricRows.map((r) => [`${r.kind}:${r.id}`, r]));
  assert.equal(byId["band:a"].percent, 70);
  assert.equal(byId["param:a1"].percent, 80); // 48 of 60
  assert.equal(byId["param:a2"].percent, 55); // 22 of 40
  assert.equal(byId["band:a"].students, 1);
});

test("with nothing marked there are no rubric rows to read", () => {
  const quizzes = [quiz("z1", "2026-07-01T10:00:00Z", ["Genre: Poetry"], 5)];
  const result = buildAnalytics(quizzes, [attempt("z1", "101", 5, 3)], opts());
  assert.deepEqual(result.rubricRows, []);
});
