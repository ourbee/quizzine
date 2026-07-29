/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

export const AI_PROMPT = `You are helping me, a teacher, build a quiz file for the Quizzine app. Produce the COMPLETE quiz in ONE reply, in the output format I pick below. Do not ask clarifying questions first — make sensible choices from my brief. I will review the file myself; if I ask for changes, return the corrected COMPLETE file again in the same format.

MY BRIEF (I will fill these in):
- Topic / syllabus area: [TOPIC — or write "use the attached file/text as the only source" and attach your material]
- Number of questions: [N]
- Student level: [e.g. Semester 3 undergraduate]
- Language/style: [e.g. British English]
- Question types to use: [mcq only / mix of mcq, short, essay]
- Points per question: [default 1]
- Output format: [A = Excel/CSV table, B = JSON, C = plain-text blocks, D = Google Apps Script quiz builder]
- Number of quizzes: [1 — or e.g. "5 quizzes, one per theme". For several quizzes use format A with one SHEET per quiz (sheet name = quiz title), or format D with one Google Form per quiz.]

QUALITY RULES (mandatory):
1. Every question must have exactly one defensible correct answer.
2. Provide feedback for EVERY option (A, B, C and D) — for the correct option explain why it is right; for each wrong option explain the specific misunderstanding that makes it wrong.
3. Feedback must be SELF-CONTAINED and ANONYMISED: never mention the source material, attachment, book, passage, study guide, website, or page numbers. Write "The novel was published in 1967", never "The source/LitChart/passage says 1967".
4. Never refer to options by letter or position in any feedback or question text ("option C", "the third option", "both A and B") — options are shuffled for every student, so letters are meaningless to them. Refer to the option's content instead.
5. No "All of the above", "None of the above", or negative/meta options.
6. Distractors must be plausible; keep all options similar in length and grammatical form.
7. Balance the answer key roughly evenly across A–D.
8. If I attached source material, base every question strictly on it and do not invent facts — but write questions and feedback so they stand alone without it.
9. Types allowed: "mcq" (auto-graded), "short" and "essay" (typed answers, graded by me later — for these, skip options and correct answer but still give FeedbackCorrect as a model answer).
10. MediaURL is optional: a public image, audio file, or YouTube link relevant to the question.

OUTPUT FORMATS:

FORMAT A — Excel/CSV (default): a table with EXACTLY these columns, one row per question:
Question | Type | OptionA | OptionB | OptionC | OptionD | CorrectAnswer | FeedbackA | FeedbackB | FeedbackC | FeedbackD | Points | MediaURL | Passage
(If you can generate a downloadable .xlsx, do that; otherwise give me a CSV code block I can paste into a spreadsheet. CorrectAnswer is the letter only. For several quizzes, put each quiz on its own sheet and name the sheet after the quiz — the app builds one quiz per sheet.)

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
      "media": "",
      "passage": ""
    }
  ]
}

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
Media: (optional URL)

FORMAT D — Google Apps Script: a .gs / .js file that builds the quiz as a Google Form, i.e. FormApp.create(title).setDescription(...), form.addMultipleChoiceItem() with setTitle/setPoints/setChoices(createChoice(text, isCorrect)), and FormApp.createFeedback().setText(...) passed to setFeedbackForCorrect / setFeedbackForIncorrect. Build one Form per quiz — several Forms in one file is fine. Quizzine reads such a file directly, so this is also the format to give me if I ask for Google Forms.

Use no markdown bold/italics inside the final output values.`;
