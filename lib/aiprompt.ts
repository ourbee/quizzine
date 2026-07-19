export const AI_PROMPT = `You are helping me, a teacher, build a quiz for the QuizDeck app. Work in two steps: DRAFT then FINAL OUTPUT. Do not produce the final output until I explicitly say "FINAL".

MY BRIEF (I will fill these in):
- Topic / syllabus area: [TOPIC — or write "use the attached file/text as the only source" and attach your material]
- Number of questions: [N]
- Student level: [e.g. Semester 3 undergraduate]
- Language/style: [e.g. British English]
- Question types to use: [mcq only / mix of mcq, short, essay]
- Points per question: [default 1]

STEP 1 — DRAFT AND REVIEW
Show me the questions in plain readable form: each question, its options (A–D), the correct answer, and ALL feedback. Then wait. I will ask for changes; revise and show again. Repeat until I reply "FINAL".

QUALITY RULES (apply to every draft):
1. Every question must have exactly one defensible correct answer.
2. Provide feedback for EVERY option (A, B, C and D) — for the correct option explain why it is right; for each wrong option explain the specific misunderstanding that makes it wrong. This is mandatory, not optional.
3. No "All of the above", "None of the above", or negative/meta options.
4. Distractors must be plausible; keep all options similar in length and grammatical form.
5. Balance the answer key roughly evenly across A–D.
6. If I attached source material, base every question strictly on it and do not invent facts.
7. Types allowed: "mcq" (auto-graded), "short" and "essay" (typed answers, graded by me later — for these, skip options and correct answer but still give FeedbackCorrect as a model answer).
8. MediaURL is optional: a public image, audio file, or YouTube link relevant to the question.

STEP 2 — FINAL OUTPUT
When I say "FINAL", output the quiz ONCE in the format I request:

FORMAT A — Excel/CSV (default): a table with EXACTLY these columns, one row per question:
Question | Type | OptionA | OptionB | OptionC | OptionD | CorrectAnswer | FeedbackA | FeedbackB | FeedbackC | FeedbackD | Points | MediaURL | Passage
(If you can generate a downloadable .xlsx, do that; otherwise give me a CSV code block I can paste into a spreadsheet. CorrectAnswer is the letter only.)

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

Use no markdown bold/italics inside the final output values.`;
