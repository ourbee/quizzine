# Tag naming — the rules, and where each one is enforced

**Status:** 2026-08-30. Rules §1–§8 are the naming convention; §10 records the four gaps that used to let drift through, all now closed in code.
**Read with:** `lib/tags.ts` (the keys and the vocabulary), `lib/aiprompt.ts` (what the LLM is told), `app/teacher/new/page.tsx` (intake), `app/teacher/tags/page.tsx` (the merge queue).

---

## Why this document exists

Two spellings of one tag do not make a small mess. They split one topic into two half-empty buckets, and a report built on half-empty buckets is worse than no report — it invites a conclusion from a sample too small to carry one. Everything below exists to keep that from happening, and the order matters: prevention at the source, enforcement at the door, human judgement last and only where judgement is genuinely required.

The evidence for that ordering is what the merge queue actually contains. Nine variant groups observed on 2026-08-30, run through the app's own keys:

| pair | same `tagKey`? | same `looseKey`? |
|---|---|---|
| `Unit 7 Cultural studies` / `Unit 7 Cultural Studies` | yes | yes |
| `Unit 8 Literary Criticism` / `Unit 8 Literary criticism` | yes | yes |
| `Text: Tess of the d'Urbervilles` / `…D'Urbervilles` | yes | yes |
| `Author: I. A. Richards` / `Author: I.A. Richards` | no | yes |
| `Author: D. H. Lawrence` / `Author: D.H. Lawrence` | no | yes |
| `Author: P. B. Shelley` / `Author: P.B. Shelley` | no | yes |
| `Author: R. K. Narayan` / `Author: R.K. Narayan` | no | yes |
| `Unit 9 Literary theory post World War II` / `Unit 9 Literary Theory (Post World War II)` | no | yes |
| `Author: Edward Said` / `Author: Edward W. Said` | no | **no** |

Eight of nine are mechanical — case, spacing, punctuation, a parenthesis. **One** is a judgement a machine cannot make. A queue where eight cards out of nine are noise trains the teacher to ignore the ninth, which is the only one that ever mattered.

---

## The rules

### 1. Shape

A tag is `Dimension: Value`. Tags are separated by **semicolons**:

```
Period: Victorian; Genre: Poetry; Author: Tennyson; Skill: Close reading
```

Commas and newlines also separate (`splitTagCell`), which is a kindness to teachers typing freehand. The cost is that **a value may never contain a comma** — `Narayan, R. K.` shatters into two tags. Write the natural order instead.

A value may contain a colon; only the first colon splits (`Text: Ulysses: a reading`).

### 2. Dimensions

Sentence case, from the fixed list: **Unit, Period, Genre, Skill, Author, Text, Topic**. A bare tag with no colon is filed under `Topic` (`DEFAULT_DIMENSION`), so a teacher who types "Prosody" is never wrong, only less precise.

Do not invent a dimension for one quiz. A dimension is a column of the report; a column that exists on four questions out of two hundred is not a column. If a new one is genuinely needed, add it to the preset in `lib/tags.ts` so every later quiz can use it too.

### 3. Values — sentence case

Capital on the first word and on proper nouns. Nothing else.

- `Unit 8 Literary criticism` — not `Literary Criticism`
- `Unit 7 Cultural studies` — not `Cultural Studies`
- `Skill: Close reading` — not `Close Reading`

This one rule accounts for two of the nine groups above, and it is the rule an LLM breaks most often, because title case looks more correct to a model than it is.

### 4. Authors — surname-anchored, initials spaced

`I. A. Richards`, `D. H. Lawrence`, `P. B. Shelley`, `R. K. Narayan`. A full stop and a space after **every** initial.

Include a middle initial only where it belongs to the name as normally cited: it is `Edward Said`, not `Edward W. Said`; it is `I. A. Richards`, never `Ivor Richards`. Never expand initials to forenames, and never invert to `Surname, Forename` — see §1 on commas.

Four of the nine groups are the spaced-initial rule alone.

### 5. Texts — as printed

Original capitalisation, original apostrophes, no article stripping: `Tess of the d'Urbervilles`. A lowercase `d'` that looks like a typo is the title.

### 6. Units — verbatim from the preset

The ten NTA units live in `NET_ENGLISH_UNITS`. Copy them character for character. No parenthetical rephrasing (`Literary Theory (Post World War II)`), no hyphen variants (`post-World War II`), no truncation.

### 7. Difficulty is a column, not a tag

Whole number 1–5. Writing `Difficulty: 4` in the Tags cell works — `extractDifficulty` lifts it into the field — but it is not the intended path, and difficulty is excluded from drift detection entirely because it is generated, never typed.

### 8. How many

Two to five tags per question, **one per dimension**. Tag what the question *tests*, not what it mentions: a question that quotes Tennyson to ask about metre is `Skill: Close reading` and `Genre: Poetry`, not `Author: Tennyson`. Where a dimension does not apply, leave it out rather than forcing it.

Hard limits, for reference: 12 tags per question, 60 characters per side of the colon. **The 60-character truncation is silent, and truncation can manufacture a variant** out of a long `Text:` value — keep titles short enough to survive it.

---

## 9. Where each rule is enforced

The rules above are not meant to be remembered. Each one should be compiled into a surface where following it is easier than breaking it.

| surface | what it should do |
|---|---|
| **Excel template** (`downloadTemplate`) | A second **Tags** sheet listing the rules and the live vocabulary to copy from. Someone filling a template copies a spelling in front of them and invents one that is not. |
| **AI prompt** (`lib/aiprompt.ts`) | `existingTagsSection` names the exact spellings already in use — the only mechanism that stops a variant being *invented* — deduplicated to one per bucket (§10.3), plus the rules models break most (§3, §4). |
| **Ingest** (`canonicalizeBatch`) | Silently rewrites an incoming tag into the established spelling on an exact or loose match, and makes the file agree with itself. This is enforcement; the prompt is only reduction. |
| **Upload preview** (`tagNearMisses`) | Offers the near misses — a typo, or a different word — for a click before anything is stored, and reports how many tags were folded in silently. |
| **Tags page** (`tagVariants`) | The exception queue for tags already stored. Mechanical groups fold in one click; the rest ask. Should be near-empty. |

Prompts do not achieve full adherence and are not expected to. Attention to a 300-item list degrades over a forty-question file; models normalise casing on their own. The prompt reduces the problem, the ingest closes it.

---

## 10. How the gaps were closed

All four shipped on 2026-08-30. What follows is the reasoning, kept because the *order* of the fixes is the policy and would otherwise be invisible in the diff.

### 10.1 A file now agrees with itself — `canonicalizeBatch`

The old canonicalisation ran question by question against a vocabulary built *before* the file arrived, so an upload carrying both `Cultural studies` ×10 and `Cultural Studies` ×8, where neither had been used before, founded two buckets in one go. That is the 10/8 and 18/14 shape in the queue.

`canonicalizeBatch` seeds the vocabulary with the batch's own **majority** spelling before rewriting anything — majority rather than first-seen, so the result does not depend on which question happens to sit at the top of the sheet. Both write paths use it (`app/api/quizzes/route.ts`, `app/api/quizzes/[id]/route.ts`), and so does the review screen, which previously showed the teacher tags that the server was about to change behind their back.

### 10.2 Presets are part of the vocabulary — but rank second

A vocabulary is now built in explicit **priority order**: the teacher's own majority spellings first, the chosen preset second, the incoming file last.

The order is the point. Letting a preset outrank established usage would rewrite a habit used two hundred times to match a list, creating exactly the split the preset was meant to prevent. Ranked second, it fills only the buckets the teacher has never touched — which is where a fresh account needs it and where a settled one is indifferent.

### 10.3 One spelling per bucket, everywhere — `preferredSpellings`

The intake screen took `Object.keys(counts)` — every spelling in use, drift included — and fed it to `existingTagsSection` under a heading reading "copy these character for character". The prompt was teaching the drift it existed to prevent.

`preferredSpellings` collapses counts to the most-used spelling per loose bucket (ties break on a plain code-unit comparison, which is stable across platforms and prefers the capitalised form). It backs the prompt list, both server vocabularies, and the template's new **Tags** sheet.

`buildVocabulary` now enforces the same invariant structurally: **the first spelling offered owns its loose bucket and later rivals are dropped**, so `byLoose` maps to one spelling rather than a list. That is what makes adopting a loose match unambiguous, and it is why priority order had to become explicit.

### 10.4 The auto-merge line moved

Old policy: exact bucket match auto-merges, loose match asks. New policy: **both are adopted silently**; only a near miss asks.

The evidence is the table at the top of this document — eight of nine loose-key differences were case, spacing, punctuation or a bracket, none of them anything anyone meant. `tagNearMisses` no longer reports what canonicalisation has already handled, so the queue is edit-distance-1 typos and outright different words. On the observed data that is one card, Edward Said.

### Also shipped

- **The merge queue can clear itself.** `TagVariantGroup.mechanical` marks a group whose spellings differ only in case, spacing, punctuation or a trailing plural — no near miss involved. `/teacher/tags` offers **Fold all N in** for those in one request and keeps asking, individually, about the rest. This is the only fix that touches tags already in the database; §10.1–§10.4 stop new ones arriving.
- **The review screen says what it did.** A note reports how many questions had a tag folded in, so nothing is rewritten invisibly.
- **The Excel template carries the vocabulary.** A second **Tags** sheet lists the rules and the exact spellings to copy. Not a dropdown: data validation is not something SheetJS's community build can write, so the sheet is the nearest honest thing.
- **The AI prompt states the rules it kept breaking.** Sentence case explicitly (models tidy values into title case because it looks more correct), spaced author initials, no rewording of a listed value, no commas inside a value.

## 11. What stays human, permanently

Whether **Edward Said** and **Edward W. Said** are one author. No key can decide it, and none should try. The point of closing the gaps in §10 was never to automate that question away — it was to make sure it is the only one left on the screen.
