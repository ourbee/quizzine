/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { TAG_PRESETS, difficultyLabel, findPreset, type TagPreset } from "./tags.ts";

export const AI_PROMPT = `You are helping me, a teacher, build a quiz file for the Quizzine app. This happens in TWO steps. Do not skip step 1.

STEP 1 — READ MY BRIEF, THEN ASK ME ABOUT ANYTHING UNCLEAR.
Before you write a single question, check my brief against the CHECKLIST below. If anything needed to build the quiz properly is missing, vague or ambiguous, ASK ME — do not guess and do not quietly pick something.

How to ask:
- Put every question you have in ONE numbered list, in one reply. Never dribble them out one at a time.
- Offer a suggested answer for each, so I can reply just "1b, 2 yes, 3 mix".
- Then STOP and wait. Do not write any questions, a sample, a preview, or a partial file while you are waiting.
- Ask only about things I have genuinely left open. Never re-ask something I have already told you, and never ask about anything under DEFAULTS below.
- If nothing is unclear, say so in one line and go straight to step 2.

CHECKLIST — ask whenever I have not made these clear:
1. Topic or source. What exactly is the quiz on? If I attached material, is it the only source, or may you use general knowledge too? If I named a broad subject, which sub-topics should it cover?
2. Number of questions. Ask if I have not given a number.
3. Question types. mcq only? A mix? Any typed answers? This is the one teachers most often forget — ask unless I have said.
4. Whether answers are marked at all. Is this a scored quiz, an unscored survey or opinion poll, or work I intend to have peer reviewed? Ask if my brief could mean either.
5. Student level. Which class, year or semester, and roughly what difficulty?
6. Coverage and balance, when it matters. How to split the questions across topics, or how many of each type.
7. Tagging. Which dimensions should each question be tagged under (period, genre, author, skill, unit, and so on), and should every question carry a difficulty? Ask if I have not said, unless the TAGGING section below already names a fixed list.
8. Anything else genuinely ambiguous in what I wrote — an unclear instruction, a contradiction, a term that could mean two things.

If I say "you decide", "use your judgement", "no questions", or "just produce it", skip the questions entirely and go to step 2 using sensible choices and the defaults.

STEP 2 — PRODUCE THE COMPLETE FILE.
Once I have answered, produce the COMPLETE quiz in ONE reply, in the output format below. I will review it myself; if I ask for changes, return the corrected COMPLETE file again in the same format — never a fragment.

DEFAULTS — apply these silently, never ask about them:
- Output format: FORMAT A, an Excel/CSV table. Only use another format if I explicitly name one.
- Points per question: 1
- Options per choice question: four
- Number of quizzes: 1
- Language: British English

MY BRIEF (anything I leave blank or vague is something to ask about in step 1):
- Topic / syllabus area: [TOPIC — or write "use the attached file/text as the only source" and attach your material]
- Number of questions: [N]
- Student level: [e.g. Semester 3 undergraduate]
- Question types to use: [mcq only / mix of mcq, multi, short, essay / poll and open only, for a survey]
- Scored, survey or peer reviewed: [scored unless I say otherwise]
- Points per question: [leave blank for 1]
- Language/style: [leave blank for British English]
- Tag vocabulary: [leave blank to use the list below, or name your own dimensions]
- Difficulty spread: [leave blank for an even spread across 1-5]
- Output format: [leave blank for Excel/CSV. Otherwise: B = JSON, C = plain-text blocks, D = Google Apps Script quiz builder]
- Number of quizzes: [leave blank for 1 — or e.g. "5 quizzes, one per theme". For several quizzes use format A with one SHEET per quiz (sheet name = quiz title), or format D with one Google Form per quiz.]

QUESTION TYPES:
- "mcq" — one correct answer, auto-graded.
- "multi" — SEVERAL correct answers, auto-graded; the student ticks all that apply. Put every correct letter in CorrectAnswer, comma-separated: A,C
- "short" / "essay" — typed answers I grade myself later. Skip options and CorrectAnswer, but still give FeedbackCorrect as a model answer.
- "poll" — a choice question with NO correct answer (opinion, preference, self-report). Give the options; leave CorrectAnswer empty. Never invent a "right" opinion.
- "open" — a typed question with NO correct answer (reflection, comment, work to be peer-reviewed). Leave options and CorrectAnswer empty.
Use "poll" and "open" for anything I describe as a survey, opinion poll, reflection, feedback form, or peer-review task. If I ask for a survey, EVERY question must be "poll" or "open" and no CorrectAnswer may appear anywhere.

QUALITY RULES (mandatory):
1. Every "mcq" must have exactly one defensible correct answer; every "multi" must have at least two correct answers and at least one wrong one. "poll" and "open" questions have no correct answer at all — do not supply one.
2. Provide feedback for EVERY option (A, B, C and D) on graded questions — for correct options explain why they are right; for each wrong option explain the specific misunderstanding that makes it wrong. Poll options need no feedback.
3. Feedback must be SELF-CONTAINED and ANONYMISED: never mention the source material, attachment, book, passage, study guide, website, or page numbers. Write "The novel was published in 1967", never "The source/LitChart/passage says 1967". The one exception is material you put in the Passage column: the student can see that, so questions and feedback may refer to it ("in the extract above").
4. Never refer to options by letter or position in any feedback or question text ("option C", "the third option", "both A and B") — options are shuffled for every student, so letters are meaningless to them. Refer to the option's content instead.
5. No "All of the above", "None of the above", or negative/meta options. If you want several answers to count, use type "multi" instead.
6. Distractors must be plausible; keep all options similar in length and grammatical form.
7. Balance the answer key roughly evenly across A–D.
8. If I attached source material, base every question strictly on it and do not invent facts — but write questions and feedback so they stand alone without it.
9. MediaURL is optional: a public image, audio file, or YouTube link relevant to the question.
10. Passage is optional material the student reads BEFORE answering — a poem, an extract, a paragraph of theory, or a sample response to imitate. PassageTitle heads it ("Sample response", "Read this first", "The passage"). Leave both empty unless I ask for material or my source material only makes sense if quoted to the student. To put ONE passage in front of SEVERAL questions, repeat the identical Passage and PassageTitle text on every one of those rows, keeping them next to each other — the app shows repeated material once, above the whole run. Do not paraphrase it differently on each row or it will be shown again each time.

TAGGING (this is what makes the strengths-and-weaknesses report work — do not skip it):

Every question needs a Tags value and a Difficulty value.

Tags say what the question is TESTING, written as "Dimension: Value" and separated by semicolons:
Period: Victorian; Genre: Poetry; Author: Tennyson; Skill: Close reading

Rules for tagging:
1. Give each question 2 to 5 tags. One tag per dimension. Never invent a tag for something the question does not actually test.
2. Use EXACTLY the dimension names and values listed under MY TAG VOCABULARY below, spelled exactly as written there. Consistency matters more than precision: "Victorian" and "Victorian Age" as two spellings of one period split my report into two half-empty buckets and make both useless.
3. Where a dimension is marked "open" (Author, Text), any value is fine, but use the standard form of the name — "Tennyson", not "Lord Alfred Tennyson" — and use the same form every time.
4. If a question genuinely does not fit a dimension, leave that dimension out rather than forcing it.
5. Tag what the question TESTS, not what it mentions in passing. A question that quotes Tennyson to ask about metre is Skill: Close reading and Genre: Poetry, not Author: Tennyson.

Difficulty is a whole number from 1 to 5: 1 very easy, 2 easy, 3 medium, 4 difficult, 5 very difficult. Judge it against the level I named, not against the general population. Spread the difficulties deliberately rather than marking everything 3 — if I have asked for an adaptive paper I need a usable number of questions at EVERY level, so aim for a roughly even spread across 1 to 5 unless I have said otherwise.

OUTPUT FORMATS:

FORMAT A — Excel/CSV. THIS IS THE DEFAULT: use it unless I have explicitly named another format. A table with EXACTLY these columns, one row per question:
Question | Type | OptionA | OptionB | OptionC | OptionD | CorrectAnswer | FeedbackA | FeedbackB | FeedbackC | FeedbackD | Points | Tags | Difficulty | MediaURL | Passage | PassageTitle
(Tags and Difficulty are described under TAGGING below. Give me a downloadable .xlsx file if you can produce one — that is what I want by default. If you cannot, give me a CSV code block I can paste into a spreadsheet instead. CorrectAnswer holds letters only — one letter for "mcq", several comma-separated for "multi", empty for "poll", "open", "short" and "essay". For several quizzes, put each quiz on its own sheet and name the sheet after the quiz — the app builds one quiz per sheet.)

FORMAT B — JSON: a single code block:
{
  "title": "...",
  "description": "...",
  "questions": [
    {
      "question": "...",
      "type": "mcq",
      "options": [
        {"key": "A", "text": "...", "feedback": "..."},
        {"key": "B", "text": "...", "feedback": "..."},
        {"key": "C", "text": "...", "feedback": "..."},
        {"key": "D", "text": "...", "feedback": "..."}
      ],
      "correct": "B",
      "points": 1,
      "tags": ["Period: Victorian", "Genre: Poetry", "Author: Tennyson"],
      "difficulty": 3,
      "media": "",
      "passage": "",
      "passageTitle": ""
    }
  ]
}
(For "multi", write "correct": ["A", "C"]. For "poll" and "open", omit "correct" and "points" entirely.)

FORMAT C — Plain text blocks:
Title: ...
Description: ...

Q: question text
Type: mcq
A: option text
B: option text
C: option text
D: option text
FA: feedback for A
FB: feedback for B
FC: feedback for C
FD: feedback for D
Correct: B
Points: 1
Tags: Period: Victorian; Genre: Poetry; Author: Tennyson
Difficulty: 3
Media: (optional URL)
Passage: (optional material to read first — repeat it verbatim on each question it covers)
PassageTitle: (optional heading for that material)

(For "multi" write Correct: A,C — for "poll" and "open" leave the Correct line out altogether.)

FORMAT D — Google Apps Script: a .gs / .js file that builds the quiz as a Google Form, i.e. FormApp.create(title).setDescription(...), form.addMultipleChoiceItem() with setTitle/setPoints/setChoices(createChoice(text, isCorrect)), and FormApp.createFeedback().setText(...) passed to setFeedbackForCorrect / setFeedbackForIncorrect. Use form.addCheckboxItem() where several answers are correct, and form.addParagraphTextItem() for essay or open questions. For a survey, build the Form with no setPoints and no createChoice(text, true) anywhere — Quizzine then collects the responses without scoring them. Build one Form per quiz — several Forms in one file is fine, and each becomes its own quiz. Every builder function must be callable with no arguments so the app can run it.

Use no markdown bold/italics inside the final output values.`;

/** The tag vocabulary section appended to the prompt for a chosen preset. */
export function presetPromptSection(preset: TagPreset): string {
  const lines = preset.dimensions.map((d) => {
    if (!d.values.length) return `- ${d.name}: open — any value, but always in the same standard form.`;
    return `- ${d.name}: ${d.values.join(" | ")}`;
  });
  return [
    "",
    "MY TAG VOCABULARY:",
    `Use the "${preset.name}" list. ${preset.description}`,
    "",
    ...lines,
    "",
    `Difficulty is a separate column, 1 to 5 (${[1, 2, 3, 4, 5].map((n) => `${n} ${difficultyLabel(n).toLowerCase()}`).join(", ")}). Do not also write it as a tag.`,
  ].join("\n");
}

/** The prompt, with a preset's vocabulary spliced in where one is chosen. */
export function aiPrompt(presetId?: string | null): string {
  const preset = findPreset(presetId);
  if (!preset) {
    const names = TAG_PRESETS.map((p) => p.name).join(", ");
    return `${AI_PROMPT}

MY TAG VOCABULARY:
I have not fixed one. Propose a short list of dimensions and values for this subject in step 1 and let me approve it, so that every quiz after this one uses the same words. (Quizzine ships ready-made lists for: ${names}.)`;
  }
  return AI_PROMPT + presetPromptSection(preset);
}
