/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { AI_PROMPT, CHECKLIST, COLUMN_GUIDE, QUALITY_RULES, QUESTION_TYPES, templateBrief } from "../lib/aiprompt.ts";
import { parseWorkbookSheets } from "../lib/parsers.ts";

/*
 * The prompt a teacher copies and the brief inside the Excel template are built
 * from the same blocks. These check the splicing actually happened: a section
 * that silently failed to interpolate would leave a model working from half a
 * brief, which is not something the app could otherwise notice.
 */
test("the copied prompt carries every shared section", () => {
  for (const section of [CHECKLIST, QUESTION_TYPES, QUALITY_RULES, COLUMN_GUIDE]) {
    assert.ok(AI_PROMPT.includes(section));
  }
  assert.ok(!AI_PROMPT.includes("${"), "a section failed to interpolate");
});

test("the template's brief carries the same sections", () => {
  const brief = templateBrief(true);
  for (const section of [CHECKLIST, QUESTION_TYPES, QUALITY_RULES, COLUMN_GUIDE]) {
    assert.ok(brief.includes(section));
  }
  assert.ok(!brief.includes("${"));
});

test("the brief points at real tags when the teacher has some, and at the rules when not", () => {
  assert.ok(templateBrief(true).includes("character for character"));
  assert.ok(templateBrief(false).includes("no fixed vocabulary yet"));
});

test("the brief tells a model it may transcribe an existing paper rather than invent one", () => {
  const brief = templateBrief(false);
  assert.ok(/OCR/.test(brief));
  assert.ok(/TRANSCRIBE, not to invent/.test(brief));
});

/**
 * The brief rides inside the workbook, and a filled workbook comes back through
 * the same parser that reads one quiz per sheet. A brief that parsed as a quiz
 * would greet the teacher with a hundred nonsense questions, so it must be
 * invisible to the parser — which it is only because it has no Question column.
 */
test("the instructions sheet is not read back as a quiz", () => {
  const briefRows = templateBrief(true)
    .split("\n")
    .map((line) => ({ "Quizzine — instructions for you or your AI": line }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(briefRows), "Start here");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { Question: "Which word means 'everywhere'?", Type: "mcq", OptionA: "Rare", OptionB: "Ubiquitous", CorrectAnswer: "B" },
    ]),
    "Questions"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ Tag: "Period: Victorian", Notes: "" }]),
    "Tags"
  );

  const round = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  const found = parseWorkbookSheets(
    round.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(round.Sheets[name]) }))
  );

  assert.equal(found.length, 1);
  assert.equal(found[0].sheet, "Questions");
  assert.equal(found[0].quiz.questions.length, 1);
});
