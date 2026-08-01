# Quizzine

A Google Forms alternative built for teachers. Draft the questions in any AI chatbot or type them yourself, upload the file, and share one link or QR code: students answer on any device with no account, marking happens on the server the moment they submit, and a term's worth of quizzes collapses into a single report.

Live at [quizzine.vercel.app](https://quizzine.vercel.app)

Created by [Ritwik Balo](https://github.com/ourbee).

## What it does

- **Takes the file you already have.** `.xlsx`, `.csv`, `.json`, plain-text blocks, or the Google Apps Script (`.gs` / `.js`) that builds your Google Forms quizzes. Every row is validated with line-by-line errors and previewed before anything is published. One file can hold several quizzes — a sheet each, or a form each.
- **Four kinds of paper.** Marked quizzes, unscored surveys and polls, group submissions, and peer-reviewed writing.
- **Question types.** `mcq`, `multi` (several correct answers, marked all-or-nothing or partially), `short` and `essay` typed answers, and `poll` / `open` for anything collected but not scored. Questions can carry an image, an audio clip or a YouTube video, and a shared passage — an extract, a sample response — can sit above the questions that use it.
- **Runs a class.** Link plus QR code, whole-quiz or per-question timers, a closing time, per-student shuffling of questions and options, autosave on the device, and one attempt per roll number (or per group) unless you allow more.
- **Marks itself.** Grading is server-side, so answer keys never reach the browser. Students see their score with per-option feedback and can print or save their copy; typed answers wait for you or for their peers.
- **Peer review, double-blind.** Everyone reviews a fixed number of classmates' responses against your rubric and nobody reviews their own. The panel average becomes the mark, outlier reviews are flagged, your own mark overrides everything, and each student gets a per-question feedback page.
- **Shows you the class.** Live responses, item analysis with distractor bars, late and duplicate flags, one-click Excel export — and cross-quiz reports with your own bands.

## How it works

1. **Teacher** opens `/teacher` (Google sign-in or passcode), clicks **New quiz**, copies the built-in AI prompt into any chatbot, reviews the drafted questions there, then uploads/pastes the final output (`.xlsx`, `.csv`, `.json`, plain-text blocks, or a Google Apps Script `.gs` / `.js` quiz builder).
2. Quizzine validates the file with row-level error messages, shows a full preview, and publishes to a share link + QR code. One file can hold several quizzes — see below.
3. **Students** open the link, enter name / roll number / semester, and take the quiz — with autosave, optional timers, and per-student question/option shuffling.
4. Grading happens **server-side** (answer keys never reach the browser). Students immediately see their score, every option's feedback, and can print/save their copy.
5. The dashboard shows live responses, item analysis with distractor breakdowns, late/duplicate flags, and one-click Excel export.
6. **Reports** combine any set of quizzes into one performance report by student and by semester — see below.

## Shared links

A quiz link carries its own preview: pasted into WhatsApp, Telegram, Slack or anywhere else that reads Open Graph tags, it shows the quiz's title, how many questions it holds and how long it runs, on a card painted in the theme the quiz uses — not a generic description of the app. Quiz pages are marked `noindex`, since a quiz is for whoever holds the link.

Absolute preview URLs are built from `NEXT_PUBLIC_SITE_URL` (default `https://quizzine.vercel.app`). Set it if the app moves; the per-deployment Vercel URL cannot be used, because deployment protection shows crawlers a login wall.

## Reports across several quizzes

`/teacher/reports` turns a term's worth of quizzes into a single performance report.

- **Roll number is the identity anchor.** Students are matched across quizzes on their roll number alone, never on their name, so a term of "ANANYA SEN", "Ananya  Sen" and "ananya sen" stays one record. Where the same roll has been entered under genuinely different names, the report flags it and shows the most recent.
- **Group work counts too.** A group submission credits its score to every member listed on it, so individual and group quizzes combine into one picture per student.
- **Two levels.** A per-student table with a column per quiz, and a summary per semester — average, median, range, participation, and the spread across bands.
- **Teacher-defined bands.** Set your own cut-offs, labels and colours, save them as a named scheme, and mark one as your default. Each band runs from its cut-off up to the next; the lowest is always pulled down to 0% so every student lands in exactly one band.
- **Choices that change the maths**, all set in the report itself: whether each quiz counts equally or every mark does; whether a quiz a student never sat is left out of their average or counted as zero; and whether a repeat attempt counts as their best or their latest.
- Exports to Excel with four sheets — students, semester summary, per-quiz averages, and the settings and bands the report was built with, so the numbers can be reproduced later.
- **Two roll numbers, one student.** When the same student writes their college roll on one paper and their university roll on the next, the report proposes the pair — only where the name and semester match and the two rolls never appear on the same quiz, so genuine namesakes are never suggested — and you confirm or undo the merge. Attempts are never rewritten, so Undo restores exactly what was there.

## Peer review

A quiz can be marked by the class instead of by you. It moves through three phases — responding, reviewing, closed — and you open each one.

- Set the criteria and their maxima, how many reviews each response gets, whether the panel's mean or median counts, whether a comment is compulsory, and the marks a student earns simply for doing their share of reviewing.
- Reviews are allocated in a ring: everyone reviews the same number of responses, every response gets the same number of reviews, and nobody reviews their own. Latecomers are slotted in without disturbing pairs already made.
- It is **double-blind**. A reviewer sees "Response 2 of 3" and the writing, never a name; the author reads the comments with no author attached, and comments are ordered differently on every question so one reviewer's voice cannot be followed down the page.
- Releasing the results writes the aggregated mark onto the attempt, so the responses table, the Excel export and the cross-quiz reports need no separate path. Reviews more than 25% from the panel median are flagged, and a mark you set by hand wins.
- Students get a feedback page per question: the question, their response, their reviewers' comments, and the criterion-by-criterion breakdown behind the score.

Peers mark typed answers (`short` and `essay`) only — choice questions are marked by the server as usual.

## Local development

```bash
npm install
npm run dev
npm test    # aggregation maths for the cross-quiz reports
```

No database setup needed locally — Quizzine uses an embedded PGlite database stored in `.data/` when `DATABASE_URL` is not set. Default teacher passcode in dev: `quizzine`.

## Deploying to Vercel + Neon

1. Push this repo to GitHub and import it in Vercel.
2. In the Vercel dashboard → **Storage → Create Database → Neon (Postgres)** — this provisions the free tier and injects `DATABASE_URL` automatically.
3. Add an environment variable `TEACHER_PASSCODE` with a passcode of your choice.
4. Deploy. Tables are created automatically on first use.

## Teacher accounts (Google sign-in)

Any teacher can sign in with Google; each account only sees its own quizzes. To enable it:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create/select a project → **APIs & Services → OAuth consent screen** (External, app name Quizzine, publish).
2. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
3. Under **Authorised JavaScript origins** add your production URL (e.g. `https://quizzine.vercel.app`) and `http://localhost:3600` for local dev. No redirect URIs are needed.
4. Copy the Client ID into the `NEXT_PUBLIC_GOOGLE_CLIENT_ID` environment variable and redeploy.

When `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is not set, the dashboard falls back to the passcode sign-in, which maps to `DEFAULT_OWNER_EMAIL`. Quizzes created before accounts existed are automatically assigned to `DEFAULT_OWNER_EMAIL` — set it to the same Gmail address you will sign in with so you keep your old quizzes.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | in production | Postgres connection string (Neon). Falls back to local PGlite when absent. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | for Google sign-in | OAuth Web client ID from Google Cloud console. |
| `DEFAULT_OWNER_EMAIL` | recommended | Email that owns passcode sign-ins and pre-account quizzes. |
| `AUTH_SECRET` | recommended | Secret for signing session cookies (any long random string). |
| `TEACHER_PASSCODE` | fallback only | Passcode sign-in when Google is not configured. Defaults to `quizzine`. |
| `NEXT_PUBLIC_SITE_URL` | recommended | Public address used for absolute link-preview URLs. Defaults to `https://quizzine.vercel.app`. |

## File format

Download the Excel template from the New quiz screen, or use these columns:

`Question | Type | OptionA–D | CorrectAnswer | FeedbackA–D | Points | MediaURL | Passage | PassageTitle`

`Type` is `mcq`, `multi` (put every correct letter in `CorrectAnswer`, e.g. `A,C`), `short`, `essay`, or the unscored `poll` / `open`. An optional `Graded` column (`yes` / `no`) says outright whether a question counts, which is worth adding when a marked paper carries an opinion question or two. `MediaURL` accepts image, audio, or YouTube links — YouTube URLs render as embedded players. JSON and plain-text block formats are documented inside the in-app AI prompt.

### Material to read first

`Passage` holds anything the student reads before answering — an extract, a paragraph of theory, a sample response to imitate — and `PassageTitle` heads it ("Sample response", "Read this first"). Both are optional; most quizzes leave them empty.

To put one passage in front of several questions, copy the same text down each of their rows. Consecutive questions whose `Passage` (and `PassageTitle`) match exactly are treated as one run: the material is shown **once**, above them all, and repeats per screen only when the per-question timer puts students on one question at a time. Change the text and a new run begins, so a single paper can carry a different passage for each section. Shuffling keeps such a run together and shuffles within it, so no question is ever separated from its material.

## Several quizzes from one file

- **Workbook with several sheets** — one quiz per sheet, named after the sheet (a `QuizTitle` column overrides that). Sheets without question rows, such as instructions or answer keys, are ignored.
- **Google Apps Script** (`.gs` / `.js`) — the script that builds your Google Forms quizzes is read directly, one quiz per `FormApp.create(...)`. Both styles work: a data array plus a generic builder, or a long run of `form.addMultipleChoiceItem()` calls. Scripts that build one form per run and reschedule themselves with a time trigger are followed through to the end, so all their forms arrive at once.

  The script is executed in a sandboxed iframe against a mock Apps Script runtime (`lib/appsscript.ts`) — nothing is sent to Google, and it never touches the page or your account. Question titles, help text (kept as the passage), points, choices, the correct answer, and correct/incorrect feedback all carry over; `Full Name`/`Roll Number`-style fields are dropped, since Quizzine collects those itself. Checkbox items become `multi` questions, keeping every correct choice.

The review step lists everything found, so you can untick quizzes, rename them, and check the questions before publishing. Selected quizzes share the settings you pick and each gets its own link and QR code.
