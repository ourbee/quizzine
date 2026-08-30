# Next session — phase C, and what else is open

Rewritten 2026-08-31 at `13c9af2`, after allotted tests landed.
Read `MARKER-PROJECT.md`, `SPEC-written-answers.md` §6 and `SPEC-allotted-tests.md` before starting phase C.

---

## What changed under this note

It was first written on 2026-08-29, before **allotted tests** existed. Twelve commits later a quiz can deal every roll on a roster its own question, and that reaches the marking screen, the package builder's inputs, and the Marker's standing instructions. The phase C brief below has been corrected for it; the old version was not wrong so much as blind to half the shapes a package can now take.

---

## Phase C — ship the marker prompt inside the app

**The job.** `MARKER-PROJECT.md` §1 is standing instructions for a Claude Project / Gemini Gem that marks Quizzine packages. It lives only in that document, where it will drift. Move it into the app:

1. `lib/markerprompt.ts` — export the §1 text, the way `lib/aiprompt.ts` already exports the quiz-writing prompt.
2. A **Set up your marker** copy button in the chatbot panel on `app/teacher/quiz/[id]/mark/page.tsx`, or in quiz settings. Same idiom as the "copy the AI prompt" button on `/teacher/new`.
3. Note it in `SPEC-written-answers.md` §6b as the keyless answer to the deferred Gemini integration — that section still reads as though nothing fills the gap.
4. Optional: a downloadable calibration-file template (`MARKER-PROJECT.md` §3).

**The rule that must survive.** The prompt teaches *how to judge*; the package dictates *what to mark, on what rubric, in what shape*. `markerprompt.ts` must not restate the rubric, the weights, or the JSON shape — a Project that restates them marks against stale rules the first time a quiz uses a custom rubric.

**The three places §1 deliberately does restate the package.** Each must change in the same commit as any change to `lib/markpack.ts`. A test that fails when they diverge is worth writing.

- the code rule — `R3Q2` is response 3's answer to question 2;
- the four feedback fields — `strengths`, `improvements`, `corrections`, `oneThing`;
- **the per-block question rule** (added for allotted tests): mark every response against the question printed in its own block, never against the one before it.

**Size.** Keep §1 under ~900 words so it fits a Gemini Gem's instruction box, not just a Claude Project's.

### What allotted tests changed, and what they did not

`lib/markpack.ts` **needed no change**, and that is deliberate — do not go looking for a bug there. Blank cells were already dropped, so handing the builder the union of dealt questions yields exactly one cell per student. Tests cover it, including that a reply's codes resolve back to the student-question pair they judged.

What did change is the shape of the pile, and the prompt has to survive it:

- A package can now hold **one question per student**, all different. The instruction added to §1 exists for exactly this; without it a model reads the second response against the first one's question.
- Two students in one package may not be comparable at all. Where each answered a different question, the rubric is the only common measure — which raises the stakes on §1's calibration bands, since relative grading has nothing to lean on.
- The marking screen opens **per student** for an allotted test, and the package scope axes are counted per hand, not per grid (`app/teacher/quiz/[id]/mark/page.tsx`, `questionsFor` / `attemptsFor`). A *Set up your marker* button sits fine in that panel, but any copy near it must not assume the class sat one paper.

---

## Also open

**Unverified on live.** Two changes from 2026-08-29 shipped without anyone looking at them, because they sit behind teacher sign-in: the package scope labels (`Q1 only · 1 question × 4 students` vs `Everything · 4 students × 3 questions`) and the pencil/ink chips. Both since gained an allotted-test path that reduces the counts to one student's hand — worth a look before building on either.

**Peer review still unexercised.** Scenarios 9–15 of the test protocol cover it end to end on the `TEST — Prosody` quiz. Note that peer review is **excluded from allot mode** along with group work and adaptive papers, so those two features never meet — the scenarios stand as written.

**One commit to check.** `13c9af2` (the closed-quiz banner on the quiz page) was found uncommitted in the working tree on 2026-08-31 and committed then, having been verified green but not authored in that session. If it was deliberately left uncommitted as mid-flight work, `git revert 13c9af2` backs it out cleanly; nothing depends on it.

**Suggested, not built.** *Prev / next* within the marking strips — `JumpNav` solved top and bottom and `TeacherBar` solved getting out, but stepping to the next student or question still means going back to the tabs. That is worth more in an allotted test than it was before, where per-student is the default view and the tab strip is as long as the roster.

**Housekeeping.** Delete the `TEST — Prosody (delete me)` quiz from production when testing is done.

**Two environment facts that cost time.**

- The local dev PGlite database wedges (`RuntimeError: Aborted()` on `db.exec(SCHEMA)`). The remedy, used four times, is to move `.data/quizzine` aside to `.data/quizzine.broken-<epoch>` and let a fresh one build. Production Neon is unaffected.
- Verifying any teacher-side screen needs Ritwik to sign in — an agent will not enter the passcode. Public pages (`/`, `/q/<slug>`) can be checked freely.
