/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_BANDS, buildReport, type ReportAttempt, type ReportQuiz } from "../lib/report.ts";
import {
  matchStudent,
  pickQuizzes,
  quizzesForSemester,
  quizzesSatBy,
  quizzesSatBySemester,
  semesterQuizLines,
  semestersPresent,
  semestersSatBy,
  sortSemesterQuizLines,
  sortStudentQuizLines,
  sortStudents,
  studentQuizLines,
} from "../lib/reportviews.ts";

const quizzes: ReportQuiz[] = [
  { id: "q1", title: "Prosody", created_at: "2026-07-01T10:00:00Z", group_mode: false },
  { id: "q2", title: "Sonnets", created_at: "2026-08-01T10:00:00Z", group_mode: false },
  { id: "q3", title: "Group project", created_at: "2026-09-01T10:00:00Z", group_mode: true },
];

function sat(
  quizId: string,
  name: string,
  roll: string,
  semester: number,
  score: number,
  at = "2026-07-02T10:00:00Z"
): ReportAttempt {
  return {
    id: `${quizId}-${roll}`,
    quiz_id: quizId,
    student: { name, roll, semester, nameNorm: name.toLowerCase(), rollNorm: roll },
    group_info: null,
    score,
    max_score: 100,
    flags: {},
    submitted_at: at,
  };
}

// Mary sits both written papers in semester 3 and the group project in semester 4.
// Percy sits only the sonnets paper. Bram sits nothing but the group project.
const attempts: ReportAttempt[] = [
  sat("q1", "Mary Shelley", "R1", 3, 80, "2026-07-02T10:00:00Z"),
  sat("q2", "Mary Shelley", "R1", 3, 60, "2026-08-02T10:00:00Z"),
  sat("q2", "Percy Shelley", "R2", 3, 40, "2026-08-02T10:00:00Z"),
  {
    ...sat("q3", "Mary Shelley", "R1", 4, 90, "2026-09-02T10:00:00Z"),
    group_info: {
      name: "Team A",
      nameNorm: "team a",
      semester: 4,
      members: [
        { name: "Mary Shelley", roll: "R1" },
        { name: "Bram Stoker", roll: "R3" },
      ],
    },
  },
];

const options = {
  weighting: "equal" as const,
  missing: "exclude" as const,
  repeats: "best" as const,
  bands: DEFAULT_BANDS,
  semester: "all" as const,
};

test("the quizzes a student sat include ones credited through a group", () => {
  assert.deepEqual([...quizzesSatBy("R1", attempts)].sort(), ["q1", "q2", "q3"]);
  assert.deepEqual([...quizzesSatBy("R2", attempts)], ["q2"]);
  assert.deepEqual([...quizzesSatBy("R3", attempts)], ["q3"]);
  assert.deepEqual([...quizzesSatBy("nobody", attempts)], []);
});

test("a merged roll number carries its variant's quizzes with it", () => {
  const merged = quizzesSatBy("R1", attempts, { R2: "R1" });
  assert.deepEqual([...merged].sort(), ["q1", "q2", "q3"]);
});

test("a student's quizzes split by the semester they sat them in", () => {
  assert.deepEqual([...quizzesSatBySemester("R1", 3, attempts)].sort(), ["q1", "q2"]);
  assert.deepEqual([...quizzesSatBySemester("R1", 4, attempts)], ["q3"]);
  assert.deepEqual(semestersSatBy("R1", attempts), [3, 4]);
  assert.deepEqual(semestersSatBy("R2", attempts), [3]);
});

test("a semester's quizzes are the ones its students actually sat", () => {
  assert.deepEqual([...quizzesForSemester(3, attempts)].sort(), ["q1", "q2"]);
  assert.deepEqual([...quizzesForSemester(4, attempts)], ["q3"]);
  assert.deepEqual([...quizzesForSemester(7, attempts)], []);
  assert.deepEqual(semestersPresent(attempts), [3, 4]);
});

test("picking quizzes keeps the original order", () => {
  assert.deepEqual(
    pickQuizzes(quizzes, new Set(["q3", "q1"])).map((z) => z.id),
    ["q1", "q3"]
  );
});

test("a student is found by name, by roll, or by another spelling of their name", () => {
  const row = { name: "Mary Shelley", roll: "R1", nameVariants: ["Mary Shelley", "mary shelly"] };
  assert.equal(matchStudent(row, "shel"), true);
  assert.equal(matchStudent(row, "R1"), true);
  assert.equal(matchStudent(row, "shelly"), true);
  assert.equal(matchStudent(row, ""), true);
  assert.equal(matchStudent(row, "byron"), false);
});

test("each quiz on a student's record carries the class average beside it", () => {
  const report = buildReport(quizzes, attempts, options);
  const lines = studentQuizLines(report, "R1");
  assert.equal(lines.length, 3);

  const sonnets = lines.find((l) => l.quiz.id === "q2")!;
  assert.equal(sonnets.result!.percent, 60);
  assert.equal(sonnets.classSat, 2);
  assert.equal(sonnets.classAverage, 50); // Mary 60, Percy 40
  assert.equal(sonnets.vsClass, 10);
});

test("a quiz the student never sat has a result of null, not a zero", () => {
  const report = buildReport(quizzes, attempts, options);
  const lines = studentQuizLines(report, "R2");
  const prosody = lines.find((l) => l.quiz.id === "q1")!;
  assert.equal(prosody.result, null);
  assert.equal(prosody.vsClass, null);
  assert.equal(prosody.classAverage, 80); // Mary sat it alone
});

test("quizzes never sat sink to the bottom of a best-or-worst sort", () => {
  const report = buildReport(quizzes, attempts, options);
  const lines = studentQuizLines(report, "R2");
  assert.deepEqual(
    sortStudentQuizLines(lines, "worst").map((l) => l.quiz.id),
    ["q2", "q3", "q1"]
  );
  assert.deepEqual(
    sortStudentQuizLines(lines, "best").map((l) => l.quiz.id),
    ["q2", "q3", "q1"]
  );
});

test("a student's quizzes sort by date and by title", () => {
  const report = buildReport(quizzes, attempts, options);
  const lines = studentQuizLines(report, "R1");
  assert.deepEqual(sortStudentQuizLines(lines, "recent").map((l) => l.quiz.id), ["q3", "q2", "q1"]);
  assert.deepEqual(sortStudentQuizLines(lines, "oldest").map((l) => l.quiz.id), ["q1", "q2", "q3"]);
  assert.deepEqual(sortStudentQuizLines(lines, "title").map((l) => l.quiz.id), ["q3", "q1", "q2"]);
  assert.deepEqual(sortStudentQuizLines(lines, "best").map((l) => l.quiz.id), ["q3", "q1", "q2"]);
});

test("a semester's quiz lines carry the spread, not just the average", () => {
  const report = buildReport(quizzes, attempts, { ...options, semester: 3 });
  const lines = semesterQuizLines(report.quizzes, report.students);
  const sonnets = lines.find((l) => l.quiz.id === "q2")!;
  assert.equal(sonnets.sat, 2);
  assert.equal(sonnets.average, 50);
  assert.equal(sonnets.best, 60);
  assert.equal(sonnets.worst, 40);
  assert.equal(sonnets.median, 50);
  assert.equal(sonnets.missed, 0);

  const prosody = lines.find((l) => l.quiz.id === "q1")!;
  assert.equal(prosody.sat, 1);
  assert.equal(prosody.missed, 1); // Percy never sat it
});

test("a semester's quizzes sort every way the table offers", () => {
  // Semester 3 is Mary (80 / 60 / 90) and Percy (— / 40 / —).
  const report = buildReport(quizzes, attempts, { ...options, semester: 3 });
  const lines = semesterQuizLines(report.quizzes, report.students);
  const first = (s: Parameters<typeof sortSemesterQuizLines>[1]) =>
    sortSemesterQuizLines(lines, s)[0].quiz.id;
  assert.equal(first("hardest"), "q2"); // 50%
  assert.equal(first("easiest"), "q3"); // 90%
  assert.equal(first("sat"), "q2"); // both of them sat it
  assert.equal(first("recent"), "q3");
  assert.equal(first("oldest"), "q1");
  assert.equal(first("title"), "q3"); // "Group project"
});

test("a quiz nobody in the semester sat does not head the hardest-first list", () => {
  // Semester 4 is Bram alone, and he sat only the group project.
  const report = buildReport(quizzes, attempts, { ...options, semester: 4 });
  const lines = semesterQuizLines(report.quizzes, report.students);
  assert.deepEqual(
    lines.map((l) => [l.quiz.id, l.sat]),
    [["q1", 0], ["q2", 0], ["q3", 1]]
  );
  // An average of zero over no marks at all is not the hardest paper of the term.
  assert.equal(sortSemesterQuizLines(lines, "hardest")[0].quiz.id, "q3");
  assert.equal(sortSemesterQuizLines(lines, "easiest")[0].quiz.id, "q3");
});

test("students sort every way the tables offer", () => {
  const report = buildReport(quizzes, attempts, options);
  const rolls = (s: Parameters<typeof sortStudents>[1]) => sortStudents(report.students, s).map((r) => r.roll);
  assert.deepEqual(rolls("rank"), ["R3", "R1", "R2"]); // 90, 76.7, 40
  assert.deepEqual(rolls("lowest"), ["R2", "R1", "R3"]);
  assert.deepEqual(rolls("name"), ["R3", "R1", "R2"]); // Bram, Mary, Percy
  assert.deepEqual(rolls("roll"), ["R1", "R2", "R3"]);
  assert.deepEqual(rolls("sat"), ["R1", "R3", "R2"]);
  assert.deepEqual(rolls("semester")[0], "R1"); // semester 3 before 4
});

test("sorting students leaves the report's own order alone", () => {
  const report = buildReport(quizzes, attempts, options);
  const before = report.students.map((s) => s.roll).join(",");
  sortStudents(report.students, "roll");
  assert.equal(report.students.map((s) => s.roll).join(","), before);
});
