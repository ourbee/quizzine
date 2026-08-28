# Quizzine — Written Answers & Rubric Marking

**Status:** spec agreed 2026-08-28 with Ritwik (revised same day, round 2). Build not started.
**Source rubric:** `~/Downloads/Paragraph_Essay_Evaluation_Rubric.md` (10 parameters in 4 weighted bands; reproduced normalised in §3).
**Round-2 decisions:** v1 makes **no AI API calls** — AI marking is the manual copy-prompt/paste-back flow (§6); direct Gemini integration is deferred (§6b). Reviewer *selection* replaces a fixed precedence pipeline (§9). Saved-rubrics table dropped from v1. Tag hygiene added as an independent fix (§12).

---

## 1. Scope & principles

- `short` and `essay` question types **already exist** (`lib/types.ts`, validator aliases, textarea rendering). This phase builds the **marking pipeline** they never had, plus rubric-based evaluation by teacher, peers, and an LLM.
- **No top-level Quiz-vs-Essay split.** Mixing MCQ and written questions in one quiz is already legal (and peer mode requires it). The real choice is *how typed answers get marked* — expressed through `gradingMode`.
- **One rubric structure, three reviewers.** Teacher marking, peer review, and the LLM pass all score the same rubric shape. The LLM is "one more reviewer", never an authority.
- **v1 has zero AI dependency.** No API keys, no server-side model calls. The LLM participates through marking packages the teacher copies out and pastes back (§6) — Quizzine's existing idiom (cf. `lib/aiprompt.ts`).
- The teacher **chooses which reviewers run** — it is a selection, not a pipeline (§9).

## 2. Terminology & entry points

- Keep **"New quiz"**. Do NOT rename to "New Test".
- Add a starter card **"Written answers"** on `/teacher/new` (uses the existing `preset` column) that pre-selects rubric marking and seeds one essay question.
- Marking selector (teacher-facing), extending `gradingMode`:
  - **Automatic** = `"graded"` (existing)
  - **Not scored** = `"survey"` (existing)
  - **Peer review** = `"peer"` (existing)
  - **Rubric (you, with optional AI assist)** = `"rubric"` (NEW)
- Say **"written answer"**, not "essay type" (covers `short` + `essay`).
- Student-facing language: "marked against a rubric", released by the teacher. Never "AI-graded".

## 3. Rubric model

```ts
interface RubricParam { id: string; label: string; hint?: string; weight: number } // % of total
interface RubricBand  { id: string; label: string; params: RubricParam[] }        // band weight = sum of params
interface RubricConfig { bands: RubricBand[] }  // param weights sum to 100 (validator enforces)
```

- **Default preset** = the attached rubric, normalised to percentages only (drop the contradictory "8/6/4/2" note):
  - **Band A — Content & Correctness (40)**: correctness w.r.t. question 15, factual/textual accuracy 15, use of evidence 10
  - **Band B — Argument & Thinking (30)**: analytical depth vs summary 10, independent critical position 10, structure/argumentative shape 10
  - **Band C — Language & Expression (20)**: grammar/punctuation/spelling/syntax 10, coherence & flow 5, precision & economy 5
  - **Band D — Craft & Discipline (10)**: terminology, register & word-limit adherence 10
- **Built-in presets:** Literary essay (40/30/20/10 as above) · Short factual (A 70, C 20, D 10, B off) · Writing task (A 20, B 20, C 50, D 10).
- **Fully editable per quiz:** add/remove/relabel bands and params, change weights (must sum 100). **Per-question weight overrides** allowed.
- **Dropped from v1:** a saved-rubrics-per-owner table and rubric-file upload/parsing. Single primary user; per-quiz editor + built-in presets suffice. Revisit if needed.

## 4. Data model changes

**Question** (`lib/types.ts`):
- `wordLimit?: number` — advisory by default (§8); absent = unlimited.
- Model answer = **existing `feedbackCorrect`** (already documented as the model answer for written types in `lib/aiprompt.ts`). No new field. Template column `ModelAnswer` is an *alias* for it in parsers.
- `rubricWeights?: Record<paramId, number>` — per-question override, absent = quiz default.

**QuizSettings:**
- `gradingMode: "rubric"` (new value).
- `rubric?: RubricConfig` — present when mode is `"rubric"`, or when peer mode sources criteria from bands (§7).
- `pasteGuard?: boolean` — default off/absent (§8).
- `hardWordLimit?: boolean` — default off/absent (§8).

**Attempts** — additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` per house style:
- `marking jsonb` — per question, per reviewer (`"teacher" | "ai"`; peer aggregate stays in the peer tables):
  ```
  { [qid]: { [reviewer]: {
      params: Record<paramId, number>,   // 0..weight, stored as % points
      percent: number,                    // derived sum, kept for audit
      comment?: string,
      strengths?: string, improvements?: string, corrections?: string, oneThing?: string,
      at: string                          // ISO timestamp
  }}}
  ```
  **Percent and marks stay separate**: `awarded = percent × qn.points / 100`, derived at read time, teacher-editable. Never store only the derived mark — rescaling points must not destroy the diagnostic.
- `telemetry jsonb` — per question: `pasteCount`, `pasteChars`, `blurCount`, `activeSeconds`, `growth: [t, chars][]` (sampled ~30s, capped ~200 points). **Counts only — never clipboard or keystroke content.**

## 5. Teacher marking screen (closes the existing gap)

Today a written question can never be scored outside peer mode — `grade()` marks it `pending` forever and no UI exists to resolve it. New page: **`/teacher/quiz/[id]/mark`**.

- **Question-by-question by default** (all responses to Q1, then Q2…) — marking one question across the class produces far more consistent relative grading than attempt-by-attempt. Toggle to per-student view.
- Per response: the question, passage, model answer, word count vs limit, telemetry badges (§8), the response text, then the rubric — score each **parameter** (teacher sees all 10), live total %, derived marks, free-text fields matching the rubric's feedback format (strengths / improvements / factual corrections / **one thing to fix next time**).
- **Skipped / blank answers:** a question with no response shows as "no response" with 0 marks pre-filled (teacher can still comment). Blank responses never enter marking packages (§6) and never block release — releasing with unmarked blanks is normal.
- Where an AI pass exists, its scores pre-fill the controls as editable suggestions, visibly labelled "AI suggestion — edit freely".
- Partial progress saves; a "Release results" action flips the phase (§9).
- Also serves `"graded"` quizzes that happen to contain written questions — resolving their `pending` items. **This screen has standalone value with no AI at all.**

## 6. AI pass — marking packages (copy out, paste back)

The v1 AI reviewer. No key, no server calls, works with any chatbot.

### The package

- **Unit: one question, its non-blank responses.** A quiz with 3 written questions offers 3 packages. Question-at-a-time marking is also what LLMs (like humans) grade most consistently.
- Contents, in this order: strict output instructions and the required JSON shape → the rubric (with this question's weights) → question, passage, model answer, word limit → the responses, each labelled with a **short opaque code** (`R1`, `R2`, …) plus its word count. **No names or rolls ever enter a package** — the code→attempt map lives only in Quizzine, which is how anonymisation works in this mode.
- The instructions tell the model to: score every parameter within its weight, fill the four feedback fields, penalise word-limit overrun under Band D, **flag unverifiable factual claims rather than penalise them** (the rubric's own "check against the source, not from memory" rule — an unaided LLM is exactly "from memory"), and return **only** a JSON array keyed by the codes.
- One click copies the whole package.

### Size, splitting, and model degradation

- Quizzine estimates package size. Beyond a **word budget (~8,000 response-words, configurable constant)** it splits the question into **parts** — "Copy part 1 of 3" — each part fully self-contained (instructions + rubric + question + model answer + its subset of responses; codes continue `R1…R30` across parts, unique per question).
- The UI advises **a fresh chat per part** — long conversations degrade marking quality toward the tail. This is also why the mega-package (whole quiz in one paste) is not offered: it saves two pastes and costs attention across a 25k-word dump.
- Known limitation, stated in the UI: parts marked in separate chats can drift slightly relative to each other. The teacher review pass (suggestions, not verdicts) is the correction for that.

### The paste-back parser

Teacher pastes the LLM's reply into a box on the marking screen. The parser:

- extracts the JSON (tolerating chatty prose and code fences around it);
- matches codes back to attempts — attribution is mechanical: a valid code maps exactly, a mangled code makes that response show as unmarked, **never mis-assigned**;
- validates scores: clamps a param scored above its weight and flags it; rejects malformed entries with a per-code reason;
- reports coverage: *"24 of 30 responses marked. Unmarked: R3, R11, …"* — and offers a **remainder package** containing only the unmarked responses (handles truncated replies; same resumability a future API route would need, done manually);
- **accumulates and is idempotent**: multiple pastes fill in; re-pasting a code overwrites that code's AI suggestion only;
- stores results as reviewer `"ai"` in `marking` (§4) — suggestions on the marking screen, nothing released.

Scenario coverage: one question × many students = the native case; many questions × one student = that student's answers ride in each question's package, their result assembles itself; skipped questions = simply absent from packages and marked "no response" (§5).

### 6b. Later stage (NOT v1): direct Gemini calls

Deferred until wanted. When built, it is a thin automation of §6 — same package builder, same parser, batched ~8 responses/call, resumable on 429, `GEMINI_API_KEY` server-side. Model id in one config spot with an **ordered fallback list** (nothing on Google's console is automatic — the caller names the model per request, and retired models start erroring, cf. ClaimGuard 2026-07-11: `gemini-2.5-flash` dead for newer keys, `gemini-3-flash-preview` primary). Mode 6 stays as the permanent fallback.

## 7. Peer review with the rubric

Peer review of written answers **already works** (`lib/peer.ts`, `PeerReviewPanel`, `reviewableQuestions`). Changes:

- Peer criteria can be **sourced from the rubric's bands** (one criterion per band, weight = band weight). Peers score **4 bands, not 10 parameters** — 10 params × several questions × 3 reviews is fatigue-clicking territory. Same rubric, two zoom levels (peers: bands; teacher/AI: params). Independent of how the AI reviewer runs — the pasted-back results carry all 10 params regardless.
- **Input control: 5-step descriptor scale** — Very poor / Poor / Fair / Good / Excellent — rendered as a snapping slider or segmented buttons, mapped to 0/25/50/75/100% of the item's weight. **No continuous slider**: false precision, noisier aggregation, worse inter-rater agreement. (Existing numeric criteria entry stays available.)
- Aggregation (mean/median), `reviewPoints`, `commentRequired`, teacher override (`teacher_score`) all reused unchanged.

## 8. Student experience

- **Live word counter** on written questions with a limit; turns amber near, red over. Default is a **soft limit** — typing isn't blocked; Band D and the marking package penalise overrun. `hardWordLimit: true` stops input at the cap.
- **Paste guard** (`pasteGuard`): blocks paste in written fields. Toggle, **default off**, labelled in settings as a deterrent, not a security control (trivially defeated; breaks legitimate offline drafting and transliteration-tool input, which pastes).
- **Telemetry** (always on for written questions, cheap): paste count/chars, tab-blur count, active typing seconds, and the **growth curve** — `(elapsed, charCount)` sampled ~30s via the existing autosave tick. Surfaces as **badges on the marking screen** (same spirit as the existing `late`/duplicate flags) — e.g. "3 pastes · 1,400 chars pasted", a tiny growth sparkline where a 0→1400-in-one-step jump is visible at a glance. **Disclosed on the student intro screen** ("Typing activity on written answers is recorded for your teacher"). No verdicts, no "AI-detection" score — badges inform a human, never accuse.
- **Exam mode + essays — data-loss fix** (`components/ExamShell.tsx`):
  1. Debounced (~2s) localStorage draft per attempt+question; restored on reload.
  2. **Auto-commit on navigate** for written answers: leaving a question with typed text saves it and marks the palette "answered". ("Counts only once saved" remains for MCQs — deliberate exam semantics there, a foot-gun for 20 minutes of typing.)
  3. `beforeunload` guard while a written answer has uncommitted text.

## 9. Reviewer selection, precedence, release

- The marking flow is a **teacher's selection, not a fixed pipeline**: rubric mode = teacher-only, or AI-assist (packages + review); peer mode = peers mark, and their aggregate **can be released as the final mark with no further assessment** (current behaviour: `finalScore = teacher_score ?? peer aggregate`), optionally with teacher overrides.
- Precedence **teacher > AI > peer** applies only where overlapping scores exist — a tiebreak, not a mandate that every layer runs.
- **Release is always the teacher's click**, in every configuration. "Release peer results untouched" and "release AI suggestions untouched" are both legitimate — "never auto-released" means the button is the teacher's, not that every response must be hand-edited first.
- Rubric-marked quizzes reuse the peer phase machine: **responding → marking → closed**. On submit the student sees "response recorded" (like survey mode); marks and feedback appear **only after release**, because rubric feedback quotes and compares against the model answer — instant release would leak it to students still writing. House rule preserved: answer keys and model answers never reach the browser before release.

## 10. Analytics

- Fix `lib/analytics.ts:367`: `pending` items become includable once marked. A written-answer quiz must stop producing empty reports.
- **New, and the payoff:** band-level class analytics — average % per band/parameter across the class ("Band C weakest → teach punctuation next week"), feeding the existing strengths-and-weaknesses reports as new dimensions.

## 11. Templates & generation prompt

- xlsx/CSV template: new optional columns **`ModelAnswer`** (alias → `feedbackCorrect`) and **`WordLimit`**. Old files remain valid untouched.
- `lib/aiprompt.ts`: for written types, the generation prompt asks the chatbot to produce **question + model answer + suggested word limit**, all teacher-editable after import.
- **Prompt self-sufficiency audit:** the generation prompt must describe the sheet format completely — every column (including the two new ones), types/aliases, the letters-only CorrectAnswer rule, one-sheet-per-quiz — so the teacher **never needs to upload the template file into the chat**. Treat any gap that forces a template upload as a bug.

## 12. Tag hygiene (independent fix — current feature, not written-answers)

Problem: near-duplicate tags split analytics across quizzes ("Unit 7 Cultural Studies" vs "Unit 7 Cultural studies"; "Unit 9 Literary Theory (Post World War II)" vs "Unit 9 Literary theory post World War II") — merged by hand twice already. Goal: never need manual merging.

1. **Canonicalise at ingest** (`lib/tags.ts` / validation): match each incoming tag against the owner's existing tag vocabulary using a normalised key — casefold, collapse whitespace, strip punctuation — applied per side of the `Dimension: Value` split. On a match, **store the existing exact form** (existing vocabulary wins; the incoming variant is silently adopted into it). Kills all pure case/spacing/punctuation splits at the door.
2. **Fuzzy warning at preview:** wording-level variants (the "Post World War II" case) can't be auto-merged safely. At upload preview, flag high-similarity near-misses: *"'Unit 9 Literary theory post World War II' is close to existing 'Unit 9 Literary Theory (Post World War II)' — use the existing tag?"* with one-click adoption.
3. **Fix it at the source — the prompt:** `lib/aiprompt.ts` is built in the dashboard, where the owner's tag vocabulary is available. Embed it: *"Reuse these exact existing tags where they fit (copy them character-for-character): […]. Only invent a new tag when none of these applies."* The LLM then never invents a casing variant in the first place.
4. Existing manual merge tooling stays as the escape hatch.

## 13. Build order

1. **Marking storage + teacher marking screen + release gating + analytics fix** (§4, §5, §9, §10) — standalone value, zero AI.
   - Ship the **exam-mode essay autosave fix** (§8) alongside or before: protective and independent.
2. **Rubric editor + presets + per-question weights + word limits + template columns + prompt audit** (§3, §11).
3. **Marking packages + paste-back parser** (§6) — the AI reviewer, no key, no cost.
4. **Peer rubric sourcing + descriptor scale** (§7).
5. **Telemetry + growth curve + paste toggle** (§8).
6. **Tag hygiene** (§12) — independent; can be slotted anywhere, including first.

**Later stage (explicitly not v1):** direct Gemini route (§6b).

## Out of scope (v1)

- Any server-side AI API calls (§6b deferred).
- AI-detection / authorship verdicts of any kind.
- Parsing arbitrary uploaded rubric files (.md/.docx); saved-rubrics-per-owner table.
- Per-teacher BYO keys; AI scores entering the peer average (advisory column only).
