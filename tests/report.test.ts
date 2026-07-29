import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_BANDS,
  bandFor,
  bandRange,
  buildReport,
  normalizeBands,
  type Band,
  type ReportAttempt,
  type ReportOptions,
  type ReportQuiz,
} from "../lib/report.ts";

const quizzes: ReportQuiz[] = [
  { id: "q1", title: "Unit 1", created_at: "2026-07-01T10:00:00Z", group_mode: false },
  { id: "q2", title: "Unit 2", created_at: "2026-07-08T10:00:00Z", group_mode: false },
  { id: "q3", title: "Project", created_at: "2026-07-15T10:00:00Z", group_mode: true },
];

function individual(
  quizId: string,
  name: string,
  roll: string,
  semester: number,
  score: number,
  max: number,
  extra: Partial<ReportAttempt> = {}
): ReportAttempt {
  return {
    id: `${quizId}-${roll}-${score}`,
    quiz_id: quizId,
    student: { name, roll, semester, nameNorm: name.toLowerCase(), rollNorm: roll },
    group_info: null,
    score,
    max_score: max,
    flags: {},
    submitted_at: "2026-07-02T10:00:00Z",
    ...extra,
  };
}

function group(
  quizId: string,
  groupName: string,
  members: { name: string; roll: string }[],
  semester: number,
  score: number,
  max: number,
  extra: Partial<ReportAttempt> = {}
): ReportAttempt {
  const leader = members[0];
  return {
    id: `${quizId}-${groupName}`,
    quiz_id: quizId,
    student: {
      name: leader.name,
      roll: leader.roll,
      semester,
      nameNorm: leader.name.toLowerCase(),
      rollNorm: leader.roll,
    },
    group_info: { name: groupName, nameNorm: groupName.toLowerCase(), semester, members },
    score,
    max_score: max,
    flags: {},
    submitted_at: "2026-07-16T10:00:00Z",
    ...extra,
  };
}

const opts = (over: Partial<ReportOptions> = {}): ReportOptions => ({
  weighting: "equal",
  missing: "exclude",
  repeats: "best",
  bands: DEFAULT_BANDS,
  semester: "all",
  ...over,
});

test("roll number anchors identity across spelling and spacing differences", () => {
  const attempts = [
    individual("q1", "Ananya  Sen", "101", 3, 8, 10),
    individual("q2", "ANANYA SEN", "101", 3, 6, 10),
  ];
  const report = buildReport(quizzes.slice(0, 2), attempts, opts());
  assert.equal(report.students.length, 1, "the two spellings must not split into two students");
  const s = report.students[0];
  assert.equal(s.roll, "101");
  assert.equal(s.attempted, 2);
  assert.equal(s.percent, 70);
  assert.equal(s.nameVariants.length, 2, "both spellings are kept for the teacher to see");
});

test("equal weighting averages percentages; marks weighting pools the marks", () => {
  // 9/10 on one quiz, 20/50 on another: 65% by quiz, 48.3% by marks.
  const attempts = [individual("q1", "Riya Das", "102", 3, 9, 10), individual("q2", "Riya Das", "102", 3, 20, 50)];
  const equal = buildReport(quizzes.slice(0, 2), attempts, opts({ weighting: "equal" }));
  assert.equal(equal.students[0].percent, 65);
  const marks = buildReport(quizzes.slice(0, 2), attempts, opts({ weighting: "marks" }));
  assert.equal(marks.students[0].percent, 48.3);
});

test("a quiz never sat is either left out or counted as zero", () => {
  const attempts = [individual("q1", "Meera Roy", "103", 3, 10, 10)];
  const excluded = buildReport(quizzes.slice(0, 2), attempts, opts({ missing: "exclude" }));
  assert.equal(excluded.students[0].percent, 100);
  assert.equal(excluded.students[0].missed, 1);
  const zeroed = buildReport(quizzes.slice(0, 2), attempts, opts({ missing: "zero" }));
  assert.equal(zeroed.students[0].percent, 50);
});

test("counting a missed quiz as zero uses the quiz's own maximum for marks weighting", () => {
  const attempts = [
    individual("q1", "Meera Roy", "103", 3, 10, 10),
    // Someone else establishes that q2 is out of 50.
    individual("q2", "Sara Ali", "104", 3, 25, 50),
  ];
  const report = buildReport(quizzes.slice(0, 2), attempts, opts({ missing: "zero", weighting: "marks" }));
  const meera = report.students.find((s) => s.roll === "103")!;
  assert.equal(meera.totalMax, 60, "the unsat quiz still contributes its 50 marks");
  assert.equal(meera.percent, 16.7);
});

test("group submissions credit every listed member", () => {
  const attempts = [
    group("q3", "Team Kavya", [
      { name: "Kavya Nair", roll: "105" },
      { name: "Ishita Bose", roll: "106" },
    ], 4, 18, 20),
  ];
  const report = buildReport([quizzes[2]], attempts, opts());
  assert.equal(report.students.length, 2);
  for (const s of report.students) {
    assert.equal(s.percent, 90);
    assert.equal(s.groupCount, 1);
    assert.equal(s.byQuiz.q3.viaGroup, "Team Kavya");
  }
});

test("individual and group work combine into one student record", () => {
  const attempts = [
    individual("q1", "Kavya Nair", "105", 4, 5, 10),
    group("q3", "Team Kavya", [
      { name: "Kavya Nair", roll: "105" },
      { name: "Ishita Bose", roll: "106" },
    ], 4, 18, 20),
  ];
  const report = buildReport([quizzes[0], quizzes[2]], attempts, opts());
  const kavya = report.students.find((s) => s.roll === "105")!;
  assert.equal(kavya.attempted, 2);
  assert.equal(kavya.percent, 70); // mean of 50% and 90%
  const ishita = report.students.find((s) => s.roll === "106")!;
  assert.equal(ishita.attempted, 1);
});

test("repeat attempts resolve to the best or the latest", () => {
  const attempts = [
    individual("q1", "Nita Rao", "107", 3, 4, 10, { id: "a", submitted_at: "2026-07-02T09:00:00Z" }),
    individual("q1", "Nita Rao", "107", 3, 9, 10, { id: "b", submitted_at: "2026-07-02T10:00:00Z" }),
    individual("q1", "Nita Rao", "107", 3, 6, 10, { id: "c", submitted_at: "2026-07-02T11:00:00Z" }),
  ];
  const best = buildReport([quizzes[0]], attempts, opts({ repeats: "best" }));
  assert.equal(best.students[0].percent, 90);
  assert.equal(best.students[0].byQuiz.q1.discarded, 2);
  const latest = buildReport([quizzes[0]], attempts, opts({ repeats: "latest" }));
  assert.equal(latest.students[0].percent, 60);
  assert.equal(latest.students[0].attempted, 1, "repeats never inflate the attempted count");
});

test("semester rows summarise their own students only", () => {
  const attempts = [
    individual("q1", "A One", "201", 3, 9, 10),
    individual("q1", "B Two", "202", 3, 7, 10),
    individual("q1", "C Three", "301", 5, 4, 10),
  ];
  const report = buildReport([quizzes[0]], attempts, opts());
  assert.deepEqual(report.semesters.map((s) => s.semester), [3, 5]);
  const sem3 = report.semesters[0];
  assert.equal(sem3.students, 2);
  assert.equal(sem3.average, 80);
  assert.equal(sem3.median, 80);
  assert.equal(sem3.best, 90);
  assert.equal(sem3.worst, 70);
  assert.equal(report.semesters[1].average, 40);
  assert.equal(report.overall!.average, 66.7);
});

test("participation counts attempts against students times quizzes", () => {
  const attempts = [
    individual("q1", "A One", "201", 3, 5, 10),
    individual("q2", "A One", "201", 3, 5, 10),
    individual("q1", "B Two", "202", 3, 5, 10),
  ];
  const report = buildReport(quizzes.slice(0, 2), attempts, opts());
  assert.equal(report.semesters[0].participation, 75); // 3 of 4 possible sittings
});

test("the semester filter narrows students and summaries", () => {
  const attempts = [
    individual("q1", "A One", "201", 3, 9, 10),
    individual("q1", "C Three", "301", 5, 4, 10),
  ];
  const report = buildReport([quizzes[0]], attempts, opts({ semester: 5 }));
  assert.equal(report.students.length, 1);
  assert.equal(report.students[0].roll, "301");
  assert.deepEqual(report.semesters.map((s) => s.semester), [5]);
});

test("bands are sorted, de-duplicated and always cover 0-100", () => {
  const messy: Band[] = [
    { label: "Mid", min: 50, color: "blue" },
    { label: "Top", min: 90, color: "emerald" },
    { label: "Low", min: 30, color: "rose" },
    { label: "Clash", min: 50, color: "slate" },
  ];
  const bands = normalizeBands(messy);
  assert.deepEqual(bands.map((b) => b.label), ["Top", "Mid", "Low"]);
  assert.equal(bands[bands.length - 1].min, 0, "the lowest band stretches to zero");
  assert.equal(bandFor(100, bands).label, "Top");
  assert.equal(bandFor(90, bands).label, "Top");
  assert.equal(bandFor(89.9, bands).label, "Mid");
  assert.equal(bandFor(0, bands).label, "Low");
  assert.deepEqual(bandRange(bands, 0), [90, 100]);
  assert.deepEqual(bandRange(bands, 1), [50, 89]);
  assert.deepEqual(bandRange(bands, 2), [0, 49]);
});

test("teacher-defined bands decide the label on a student row", () => {
  const bands: Band[] = [
    { label: "Distinction", min: 75, color: "emerald" },
    { label: "Pass", min: 40, color: "blue" },
    { label: "Reappear", min: 0, color: "rose" },
  ];
  const attempts = [
    individual("q1", "A One", "201", 3, 8, 10),
    individual("q1", "B Two", "202", 3, 5, 10),
    individual("q1", "C Three", "203", 3, 2, 10),
  ];
  const report = buildReport([quizzes[0]], attempts, opts({ bands }));
  assert.deepEqual(
    report.students.map((s) => s.band.label),
    ["Distinction", "Pass", "Reappear"]
  );
  assert.deepEqual(
    report.semesters[0].bandCounts.map((b) => b.count),
    [1, 1, 1]
  );
});

test("quizzes with no responses are reported rather than skewing averages", () => {
  const attempts = [individual("q1", "A One", "201", 3, 9, 10)];
  const report = buildReport(quizzes.slice(0, 2), attempts, opts());
  assert.deepEqual(report.emptyQuizzes, ["q2"]);
  assert.equal(report.students[0].percent, 90, "an empty quiz must not halve the average to 45");
});

test("attempts from quizzes outside the selection are ignored", () => {
  const attempts = [individual("q1", "A One", "201", 3, 9, 10), individual("q2", "A One", "201", 3, 1, 10)];
  const report = buildReport([quizzes[0]], attempts, opts());
  assert.equal(report.students[0].attempted, 1);
  assert.equal(report.students[0].percent, 90);
});
