# Next session — phase C, and what else is open

Written 2026-08-29, at the end of the session that shipped `df04e42`, `ef62879`, `c34475d`.
Read `MARKER-PROJECT.md` and `SPEC-written-answers.md` §6 before starting phase C.

---

## Phase C — ship the marker prompt inside the app

**The job.** `MARKER-PROJECT.md` §1 is standing instructions for a Claude Project / Gemini Gem that marks Quizzine packages. It currently lives only in that document, where it will drift. Move it into the app:

1. `lib/markerprompt.ts` — export the §1 text, the way `lib/aiprompt.ts` already exports the quiz-writing prompt.
2. A **Set up your marker** copy button, next to the package buttons in the chatbot panel on `app/teacher/quiz/[id]/mark/page.tsx`, or in quiz settings. Same idiom as the existing "copy the AI prompt" button on `/teacher/new`.
3. Note it in `SPEC-written-answers.md` §6b as the keyless answer to the deferred Gemini integration — the section currently reads as though nothing fills that gap.
4. Optional: a downloadable calibration-file template (`MARKER-PROJECT.md` §3).

**The rule that must survive.** The prompt teaches *how to judge*; the package dictates *what to mark, on what rubric, in what shape*. `markerprompt.ts` must not restate the rubric, the weights, or the JSON shape — a Project that restates them marks against stale rules the day a quiz uses a custom rubric.

**The two places it does restate the package**, and must therefore be changed in the same commit as any change to `lib/markpack.ts`: the code rule (`R3Q2` — response 3, question 2) and the four feedback fields (`strengths`, `improvements`, `corrections`, `oneThing`). Worth a test that fails if they diverge.

**Size.** Keep §1 under ~900 words so it fits a Gemini Gem's instruction box, not just a Claude Project's.

---

## Also open

**Unverified on live.** Two UI changes from this session were shipped without anyone looking at them, because they sit behind teacher sign-in: the package scope labels (`Q1 only · 1 question × 4 students` vs `Everything · 4 students × 3 questions`) and the pencil/ink chips. Confirm before building on top of them.

**Peer review not yet exercised.** Scenarios 9–15 of the test protocol cover it end to end on the `TEST — Prosody` quiz; they had not been run when this was written. Anything they turn up belongs at the top of this list.

**Suggested, not built.**

- *Prev / next* within the marking strips — `JumpNav` solved top/bottom, but stepping to the next student or question still means going back to the tabs.
- The pencil glyph is a drawn SVG, deliberately not an emoji (renders consistently, inherits `currentColor`). Emoji is a one-line swap if Ritwik prefers it.
- Delete the `TEST — Prosody (delete me)` quiz from production once testing is done.

**Two environment facts that cost time in this session.**

- The local dev PGlite database wedges (`RuntimeError: Aborted()` on `db.exec(SCHEMA)`). The remedy used four times now is to move `.data/quizzine` aside to `.data/quizzine.broken-<epoch>` and let a fresh one build. Production Neon is unaffected.
- Verifying any teacher-side screen needs Ritwik to sign in — an agent will not enter the passcode. Public pages (`/`, `/q/<slug>`) can be checked freely.
