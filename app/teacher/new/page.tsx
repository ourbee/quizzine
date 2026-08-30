/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TeacherBar from "@/components/TeacherBar";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import { parseJsonText, parsePastedText, parseWorkbookSheets } from "@/lib/parsers";
import { looksLikeAppsScript, parseAppsScript } from "@/lib/appsscript";
import { validateQuestions } from "@/lib/validate";
import { correctKeysOf, groupByPassage, isGraded } from "@/lib/questions";
import { DEFAULT_PEER_CONFIG, peerMaxScore, type PeerConfig } from "@/lib/peer";
import { aiPrompt, templateBrief } from "@/lib/aiprompt";
import { DEFAULT_MST, mstCapacity, type MstConfig } from "@/lib/mst";
import {
  TAG_PRESETS,
  buildVocabulary,
  canonicalizeBatch,
  difficultyLabel,
  findPreset,
  normalizeTags,
  preferredSpellings,
  presetTags,
  tagNearMisses,
  type TagNearMiss,
} from "@/lib/tags";
import { DEFAULT_RUBRIC, rubricErrors, type RubricConfig } from "@/lib/rubric";
import { THEMES } from "@/lib/themes";
import type { GradingMode, MultiScoring, ParsedQuiz, Question, RawQuestion, TimerMode } from "@/lib/types";
import Material from "@/components/Material";
import Media from "@/components/Media";
import PeerEditor from "@/components/PeerEditor";
import QuestionEditor, { blankQuestion, stripEditing, toEditable, type EditableQuestion } from "@/components/QuestionEditor";
import RubricEditor from "@/components/RubricEditor";

type Step = "intake" | "review" | "settings" | "done";

/** One quiz waiting to be published — a file can produce several. */
interface Draft {
  id: string;
  source: string;
  /** Kept so the scored/survey switch can re-run validation over the same file. */
  parsed: ParsedQuiz;
  gradingMode: GradingMode;
  /** The file implied a survey rather than the teacher choosing one. */
  autoSurvey: boolean;
  title: string;
  description: string;
  questions: EditableQuestion[];
  errors: string[];
  warnings: string[];
  /**
   * The teacher deliberately unticked this one. Kept separate from "has errors"
   * so that fixing the errors — or switching the quiz to unscored — brings it
   * back automatically, and so a lone quiz with no checkbox can never get stuck
   * in an unpublishable state.
   */
  excluded: boolean;
  open: boolean;
  /** Reading the questions as students will, or writing them. */
  editing: boolean;
}

interface PublishResult {
  title: string;
  slug?: string;
  /** Needed to link an allotted quiz straight to its roster panel. */
  id?: string;
  qr?: string;
  error?: string;
}

/** Whose paper this is: one paper for the class, or one question per roll. */
type PaperType = "same" | "allotted";
/**
 * The three ways questions arrive; remembered so a repeat visit opens the right
 * card. `null` is a real state: every card may be shut, which is how a teacher
 * who knows the screen gets all three doors in view at once.
 */
type IntakePath = "ai" | "upload" | "scratch";
const PATH_KEY = "quizzine-intake-path";

const TEMPLATE_HEADERS = [
  "Question", "Type", "OptionA", "OptionB", "OptionC", "OptionD",
  "CorrectAnswer", "FeedbackA", "FeedbackB", "FeedbackC", "FeedbackD",
  "Points", "Tags", "Difficulty", "MediaURL", "Passage", "PassageTitle",
  // Written answers: the answer the marking is judged against, and how long the
  // answer should run to. ModelAnswer is an alias for FeedbackCorrect, so old
  // files that use that header are still read exactly as they were.
  "ModelAnswer", "WordLimit",
];

// Shown on the intake screen so the Type column is self-explanatory.
const TYPE_GUIDE: { type: string; what: string }[] = [
  { type: "mcq", what: "one correct answer, auto-marked" },
  { type: "multi", what: "several correct answers — put every letter in CorrectAnswer, e.g. A,C" },
  { type: "short / essay", what: "typed answer you mark later — give it a ModelAnswer and a WordLimit" },
  { type: "poll", what: "options with no correct answer — collected, never marked" },
  { type: "open", what: "typed answer with no correct answer, e.g. a reflection or peer-reviewed task" },
];

/**
 * Material for the two rows below. Both carry it identically, which is how one
 * passage is attached to several questions: students read it once, above both.
 */
const SAMPLE_RESPONSE =
  "A strong answer names the device, quotes the line it works in, and then says what the quotation does. " +
  "For example: Tennyson ends on 'strong in will', delaying the noun until the line has already spent itself on " +
  "'made weak by time and fate' — so the metre enacts the effort the speaker is claiming. Notice that the quotation " +
  "is short, embedded in the sentence, and followed by a claim rather than a paraphrase. Aim for that shape: " +
  "point, evidence, effect.";

const TEMPLATE_ROWS = [
  {
    Question: "Which word is a synonym of 'ubiquitous'?",
    Type: "mcq", OptionA: "Rare", OptionB: "Omnipresent", OptionC: "Fragile", OptionD: "Ancient",
    CorrectAnswer: "B",
    FeedbackA: "'Rare' is close to an antonym — ubiquitous things are found everywhere, not seldom.",
    FeedbackB: "Correct: 'ubiquitous' means present everywhere at once, i.e. omnipresent.",
    FeedbackC: "'Fragile' describes physical delicacy, not how widespread something is.",
    FeedbackD: "'Ancient' refers to age, not distribution.",
    Points: 1, Tags: "Skill: Vocabulary; Topic: Word meaning", Difficulty: 2, MediaURL: "", Passage: "", PassageTitle: "",
  },
  {
    Question: "In two or three sentences, explain the difference between a metaphor and a simile.",
    Type: "short", OptionA: "", OptionB: "", OptionC: "", OptionD: "",
    CorrectAnswer: "", FeedbackA: "", FeedbackB: "", FeedbackC: "", FeedbackD: "",
    Points: 2, Tags: "Skill: Critical terminology; Genre: Criticism", Difficulty: 3, MediaURL: "", Passage: "", PassageTitle: "",
    ModelAnswer:
      "A simile states the comparison openly, using 'like' or 'as' — 'my love is like a red, red rose'. A metaphor asserts it instead, so the two things are spoken of as one: 'my love is a rose'. The difference is not decorative: a metaphor claims an identity the reader must accept for the sentence to make sense, which is why it carries more force and more risk than a simile.",
    WordLimit: 60,
  },
  {
    Question: "Which of these are figures of speech? Tick all that apply.",
    Type: "multi", OptionA: "Metonymy", OptionB: "Iambic pentameter", OptionC: "Synecdoche", OptionD: "Quatrain",
    CorrectAnswer: "A,C",
    FeedbackA: "Correct: metonymy substitutes a closely associated term for the thing meant.",
    FeedbackB: "Iambic pentameter is a metre — a matter of rhythm, not of figurative meaning.",
    FeedbackC: "Correct: synecdoche lets a part stand for the whole, or the whole for a part.",
    FeedbackD: "A quatrain is a four-line stanza, a unit of form rather than a figure of speech.",
    Points: 2, Tags: "Skill: Critical terminology; Topic: Figures of speech", Difficulty: 3, MediaURL: "", Passage: "", PassageTitle: "",
  },
  {
    Question: "Which of these poets did you find most rewarding to read this term?",
    Type: "poll", OptionA: "Kamala Das", OptionB: "A. K. Ramanujan", OptionC: "Arun Kolatkar", OptionD: "Eunice de Souza",
    CorrectAnswer: "", FeedbackA: "", FeedbackB: "", FeedbackC: "", FeedbackD: "",
    Points: "", Tags: "", Difficulty: "", MediaURL: "", Passage: "", PassageTitle: "",
  },
  {
    Question: "What is one thing from this term's reading you would like to discuss further in class?",
    Type: "open", OptionA: "", OptionB: "", OptionC: "", OptionD: "",
    CorrectAnswer: "", FeedbackA: "", FeedbackB: "", FeedbackC: "", FeedbackD: "",
    Points: "", Tags: "", Difficulty: "", MediaURL: "", Passage: "", PassageTitle: "",
  },
  // The last two rows share one passage — copy the cell down and it is shown once.
  {
    Question: "Following the sample above, analyse how enjambment works in the poem's closing lines. (Max 200 words.)",
    Type: "short", OptionA: "", OptionB: "", OptionC: "", OptionD: "",
    CorrectAnswer: "", FeedbackA: "", FeedbackB: "", FeedbackC: "", FeedbackD: "",
    Points: 5, Tags: "Skill: Close reading; Genre: Poetry; Period: Victorian", Difficulty: 4, MediaURL: "", Passage: SAMPLE_RESPONSE, PassageTitle: "Sample response — write yours like this",
  },
  {
    Question: "Which part of the sample answer above is the claim, as opposed to the evidence?",
    Type: "mcq",
    OptionA: "The quotation from Tennyson", OptionB: "The statement that the metre enacts the speaker's effort",
    OptionC: "The name of the poet", OptionD: "The instruction to aim for point, evidence, effect",
    CorrectAnswer: "B",
    FeedbackA: "That is the evidence — the words quoted from the poem.",
    FeedbackB: "Correct: it is the reading being argued for, which the quotation is there to support.",
    FeedbackC: "Naming the poet is context, not an argument about the text.",
    FeedbackD: "That is advice about structure rather than a claim about the poem.",
    Points: 1, Tags: "Skill: Critical terminology; Genre: Criticism", Difficulty: 3, MediaURL: "", Passage: SAMPLE_RESPONSE, PassageTitle: "Sample response — write yours like this",
  },
];

/**
 * A file whose choice questions carry no answer key at all is a survey, not a
 * quiz with missing answers. Typed-answer questions never have a key, so they
 * are not evidence either way — a quiz of essays alone stays scored.
 */
/** A quiz is published unless the teacher unticked it or it still has errors. */
function isIncluded(draft: Draft): boolean {
  return !draft.excluded && draft.errors.length === 0;
}

function looksLikeSurvey(parsed: ParsedQuiz): boolean {
  const choice = parsed.questions.filter((qn) => qn.options.some((o) => (o.text ?? "").toString().trim() !== ""));
  if (!choice.length) return false;
  return choice.every((qn) => (qn.correct ?? "").toString().trim() === "");
}

export default function NewQuizPage() {
  const [step, setStep] = useState<Step>("intake");
  const [paperType, setPaperType] = useState<PaperType>("same");
  const [path, setPath] = useState<IntakePath | null>("scratch");
  const [tab, setTab] = useState<"upload" | "paste">("paste");
  const [pasted, setPasted] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState("");
  const [parsing, setParsing] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const [drafts, setDrafts] = useState<Draft[]>([]);

  const [theme, setTheme] = useState("slate");
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [timerMode, setTimerMode] = useState<TimerMode>("none");
  const [examMode, setExamMode] = useState(false);
  const [mstMode, setMstMode] = useState(false);
  const [mst, setMst] = useState<MstConfig>(DEFAULT_MST);
  const [preset, setPreset] = useState<string>("");
  /**
   * The palette lets students roam the paper, which is precisely what the
   * per-question countdown exists to prevent. Deriving the timer rather than
   * resetting it on toggle means the two can never disagree — and a teacher who
   * turns exam mode back off gets their countdown back untouched.
   */
  const effectiveTimerMode: TimerMode = (examMode || mstMode) && timerMode === "question" ? "none" : timerMode;
  const [maxMinutes, setMaxMinutes] = useState("15");
  const [perQuestionSeconds, setPerQuestionSeconds] = useState("45");
  const [closesAt, setClosesAt] = useState("");
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [multiScoring, setMultiScoring] = useState<MultiScoring>("exact");
  const [peer, setPeer] = useState<PeerConfig>(DEFAULT_PEER_CONFIG);
  const [peerFromRubric, setPeerFromRubric] = useState(false);
  const [rubric, setRubric] = useState<RubricConfig>(DEFAULT_RUBRIC);
  const [pasteGuard, setPasteGuard] = useState(false);
  const [hardWordLimit, setHardWordLimit] = useState(false);
  /** The exact tag spellings this teacher already uses — see lib/tags.ts. */
  const [vocabulary, setVocabulary] = useState<string[]>([]);
  /** How many questions had a tag quietly rewritten into an established spelling. */
  const [tagsTidied, setTagsTidied] = useState(0);
  const [introMedia, setIntroMedia] = useState("");
  const [groupMode, setGroupMode] = useState(false);
  const [groupMin, setGroupMin] = useState("2");
  const [groupMax, setGroupMax] = useState("5");

  const [publishing, setPublishing] = useState("");
  const [publishError, setPublishError] = useState("");
  const [published, setPublished] = useState<PublishResult[]>([]);

  // The teacher's own tag spellings, fetched once: they go into the AI prompt
  // (so a variant is never invented) and into the upload preview (so one that
  // slipped through can be adopted with a click).
  useEffect(() => {
    fetch("/api/tags")
      .then((r) => (r.ok ? r.json() : null))
      // One spelling per bucket, majority-first. Handing the model every
      // spelling in use — drift included — under a heading that says "copy
      // these character for character" teaches it the drift.
      .then((d) => d && setVocabulary(preferredSpellings(d.counts ?? {})))
      .catch(() => {});
  }, []);

  // Open on the card this teacher actually uses.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PATH_KEY);
      if (saved === "ai" || saved === "upload" || saved === "scratch" || saved === "none") {
        setPath(saved === "none" ? null : saved);
      }
    } catch {}
  }, []);
  /** Clicking the card you are already on shuts it, rather than doing nothing. */
  function choosePath(next: IntakePath) {
    const value = path === next ? null : next;
    setPath(value);
    try {
      localStorage.setItem(PATH_KEY, value ?? "none");
    } catch {}
  }

  const selected = useMemo(() => drafts.filter(isIncluded), [drafts]);
  const ready = selected.length > 0 && selected.every((d) => d.errors.length === 0 && d.title.trim() && d.questions.length > 0);
  const hasMultiQuestions = useMemo(
    () => selected.some((d) => d.questions.some((qn) => qn.type === "multi" && isGraded(qn))),
    [selected]
  );
  const anyPeer = useMemo(() => selected.some((d) => d.gradingMode === "peer"), [selected]);
  const anyRubric = useMemo(() => selected.some((d) => d.gradingMode === "rubric"), [selected]);
  /** Every written question across the selected quizzes — what a rubric marks. */
  const writtenQuestions = useMemo(
    () =>
      selected.flatMap((d) =>
        d.questions
          .filter((qn) => qn.type === "short" || qn.type === "essay")
          .map((qn) => ({ draftId: d.id, draftTitle: d.title, qn }))
      ),
    [selected]
  );
  const rubricBroken = (anyRubric || peerFromRubric) && rubricErrors(rubric).length > 0;

  /**
   * The vocabulary an upload is measured against, in priority order: what this
   * teacher already writes, then the chosen preset for anything they have never
   * tagged. The same order the server uses when it saves, so the preview and
   * the database cannot disagree.
   */
  const tagVocabulary = useCallback(() => {
    const chosen = findPreset(preset);
    return buildVocabulary([...vocabulary, ...(chosen ? presetTags(chosen) : [])]);
  }, [vocabulary, preset]);

  // Tags in the uploaded file that are probably variants of ones already in use.
  const nearMisses: TagNearMiss[] = useMemo(() => {
    const vocab = tagVocabulary();
    if (!vocab.tags.length) return [];
    return tagNearMisses(
      selected.flatMap((d) => d.questions.flatMap((qn) => qn.tags ?? [])),
      vocab
    );
  }, [selected, tagVocabulary]);

  /** Adopt the established spelling of a tag across every draft that carries it. */
  function adoptTag(miss: TagNearMiss) {
    setDrafts((list) =>
      list.map((d) => ({
        ...d,
        questions: d.questions.map((qn) =>
          qn.tags?.length ? { ...qn, tags: qn.tags.map((t) => (t === miss.incoming ? miss.existing : t)) } : qn
        ),
      }))
    );
  }

  /**
   * Put edited questions back into the loose shape a file arrives in, so that
   * everything downstream — the validator, a later switch between scored and
   * unscored — reads a hand-written question exactly as it reads an uploaded
   * one. There is only one definition of a valid question, and this is how an
   * edit reaches it.
   */
  function rawOf(list: Question[]): RawQuestion[] {
    return list.map((qn) => ({
      text: qn.text,
      type: qn.type,
      passage: qn.passage,
      passageTitle: qn.passageTitle,
      media: qn.media,
      options: qn.options,
      correct: qn.type === "multi" ? correctKeysOf(qn).join(",") : qn.correct,
      graded: isGraded(qn),
      // Zero marks on an unscored question is the validator's own doing, not
      // something the teacher typed, so it is left blank for it to fill in
      // again if the question is ever scored.
      points: qn.points > 0 ? qn.points : "",
      feedbackCorrect: qn.feedbackCorrect,
      feedbackIncorrect: qn.feedbackIncorrect,
      tags: qn.tags,
      difficulty: qn.difficulty,
      wordLimit: qn.wordLimit,
    }));
  }

  /**
   * Take the editor's questions as they stand and re-check them. What the
   * teacher typed is kept exactly as typed — a question is never rewritten or
   * dropped mid-sentence — and the validator's verdict is shown alongside it as
   * the list of things still to fix.
   */
  function editQuestions(draftId: string, next: EditableQuestion[]) {
    setDrafts((list) =>
      list.map((d) => {
        if (d.id !== draftId) return d;
        const parsed: ParsedQuiz = { ...d.parsed, questions: rawOf(stripEditing(next)) };
        const result = validateQuestions(parsed, d.gradingMode);
        return { ...d, parsed, questions: next, errors: result.errors, warnings: result.warnings };
      })
    );
  }

  /** Edit one question inside one draft — word limits and weight overrides. */
  function patchQuestion(draftId: string, qid: string, patch: Partial<Question>) {
    setDrafts((list) =>
      list.map((d) =>
        d.id === draftId ? { ...d, questions: d.questions.map((qn) => (qn.id === qid ? { ...qn, ...patch } : qn)) } : d
      )
    );
  }
  // Peers mark typed answers only; the count drives the rubric total shown to the teacher.
  const peerQuestionCount = useMemo(() => {
    const counts = selected
      .filter((d) => d.gradingMode === "peer")
      .map((d) => d.questions.filter((qn) => qn.type === "short" || qn.type === "essay").length);
    return counts.length ? Math.max(...counts) : 0;
  }, [selected]);

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  /**
   * Fold the file's tags into established spellings before anything is shown.
   *
   * The server does this again on save; doing it here as well is what makes the
   * review screen honest — a teacher who reads "Unit 7 Cultural Studies" in the
   * editor and finds "Unit 7 Cultural studies" in the report afterwards has
   * been lied to by the preview. It also catches the case the server cannot see
   * coming: a FIRST upload that disagrees with itself, where neither spelling
   * was ever in use and the majority in the file decides.
   */
  function tidyTags(list: ParsedQuiz[]): { list: ParsedQuiz[]; tidied: number } {
    const lists = list.flatMap((p) => p.questions.map((qn) => normalizeTags(qn.tags)));
    if (!lists.some((t) => t.length)) return { list, tidied: 0 };
    const canonical = canonicalizeBatch(lists, tagVocabulary());
    let at = 0;
    let tidied = 0;
    const next = list.map((p) => ({
      ...p,
      questions: p.questions.map((qn) => {
        const before = lists[at];
        const after = canonical[at];
        at += 1;
        if (!after.length || after.join(";") === before.join(";")) return qn;
        tidied += 1;
        return { ...qn, tags: after };
      }),
    }));
    return { list: next, tidied };
  }

  /** Validate every parsed quiz and move to the review step. */
  function applyParsed(rawList: ParsedQuiz[], sources: string[], fallbackTitle?: string) {
    const { list, tidied } = tidyTags(rawList);
    setTagsTidied(tidied);
    const many = list.length > 1;
    const stamp = Date.now();
    const built: Draft[] = list.map((parsed, i) => {
      const autoSurvey = looksLikeSurvey(parsed);
      const gradingMode: GradingMode = autoSurvey ? "survey" : "graded";
      const result = validateQuestions(parsed, gradingMode);
      const fallback = fallbackTitle ? (many ? `${fallbackTitle} — ${i + 1}` : fallbackTitle) : "";
      return {
        id: `d${stamp}-${i}`,
        source: sources[i] ?? "",
        parsed,
        gradingMode,
        autoSurvey,
        title: parsed.title?.trim() || fallback,
        description: parsed.description ?? "",
        questions: result.questions.map(toEditable),
        errors: result.errors,
        warnings: [...result.warnings, ...(parsed.notes ?? [])],
        excluded: false,
        open: !many,
        editing: false,
      };
    });
    setDrafts(built);
    setStep("review");
  }

  /** Re-run validation for one draft after the teacher flips scored ↔ survey. */
  function setGradingMode(id: string, gradingMode: GradingMode) {
    setDrafts((list) =>
      list.map((d) => {
        if (d.id !== id) return d;
        const result = validateQuestions(d.parsed, gradingMode);
        return {
          ...d,
          gradingMode,
          autoSurvey: false,
          // Revalidation drops anything that cannot be read at all — a question
          // half-written in the editor, say — so the rewritten list is taken
          // only when it still accounts for every question the teacher has.
          questions:
            result.questions.length === d.questions.length
              ? result.questions.map((qn, i) => ({ ...qn, tagText: d.questions[i].tagText }))
              : d.questions,
          errors: result.errors,
          warnings: [...result.warnings, ...(d.parsed.notes ?? [])],
        };
      })
    );
  }

  async function handleFile(file: File) {
    setParseError("");
    const name = file.name.replace(/\.[^.]+$/, "");
    try {
      if (/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) {
        setParsing("Reading the spreadsheet…");
        const wb = XLSX.read(await file.arrayBuffer());
        const sheets = wb.SheetNames.map((sheetName) => ({
          name: sheetName,
          rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" }),
        }));
        const found = parseWorkbookSheets(sheets);
        if (!found.length) throw new Error("no question rows were found in any sheet.");
        applyParsed(found.map((f) => f.quiz), found.map((f) => `Sheet “${f.sheet}”`), name);
        return;
      }
      if (/\.json$/i.test(file.name)) {
        applyParsed([parseJsonText(await file.text())], [file.name], name);
        return;
      }
      const text = await file.text();
      if (/\.(gs|js)$/i.test(file.name) || looksLikeAppsScript(text)) {
        setParsing("Running the Apps Script to read its forms…");
        const quizzes = await parseAppsScript(text);
        applyParsed(quizzes, quizzes.map((_, i) => `Google Form ${i + 1} of ${quizzes.length}`), name);
        return;
      }
      applyParsed([parsePastedText(text)], [file.name], name);
    } catch (err) {
      setParseError(`Could not read the file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setParsing("");
    }
  }

  async function handlePaste() {
    setParseError("");
    if (!pasted.trim()) {
      setParseError("Paste your quiz content first.");
      return;
    }
    try {
      if (looksLikeAppsScript(pasted)) {
        setParsing("Running the Apps Script to read its forms…");
        const quizzes = await parseAppsScript(pasted);
        applyParsed(quizzes, quizzes.map((_, i) => `Google Form ${i + 1} of ${quizzes.length}`));
        return;
      }
      applyParsed([parsePastedText(pasted)], []);
    } catch (err) {
      setParseError(`Could not parse the pasted text: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setParsing("");
    }
  }

  function downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet(TEMPLATE_ROWS, { header: TEMPLATE_HEADERS });
    ws["!cols"] = TEMPLATE_HEADERS.map((h) => ({ wch: h === "Question" || h.startsWith("Feedback") ? 40 : 14 }));
    const wb = XLSX.utils.book_new();

    const chosen = findPreset(preset);
    const known = buildVocabulary([...vocabulary, ...(chosen ? presetTags(chosen) : [])]).tags;

    /*
     * The brief, first, so it is the sheet the workbook opens on and the first
     * thing any model reading the file meets. A teacher who never opens this
     * sheet loses nothing; a teacher who hands the file to ChatGPT no longer
     * has to explain what Quizzine wants.
     */
    const briefSheet = XLSX.utils.json_to_sheet(
      templateBrief(known.length > 0)
        .split("\n")
        .map((line) => ({ "Quizzine — instructions for you or your AI": line })),
      { header: ["Quizzine — instructions for you or your AI"] }
    );
    briefSheet["!cols"] = [{ wch: 120 }];
    XLSX.utils.book_append_sheet(wb, briefSheet, "Start here");

    XLSX.utils.book_append_sheet(wb, ws, "Questions");

    /*
     * A second sheet carrying the exact spellings to copy into the Tags column.
     * Someone filling a template will copy a spelling that is in front of them
     * and invent one that is not, so the cheapest way to prevent drift is to
     * put the vocabulary in the file. (A real dropdown would be better still,
     * but data validation is not something this spreadsheet writer can emit.)
     */
    const rows = [
      { Tag: "HOW TO WRITE A TAG", Notes: "Dimension: Value — several tags in one cell, separated by semicolons." },
      { Tag: "Period: Victorian; Genre: Poetry", Notes: "A complete Tags cell looks like this." },
      { Tag: "", Notes: "" },
      { Tag: "RULES", Notes: "Values are sentence case: capital on the first word and proper nouns only." },
      { Tag: "", Notes: "Author initials are spaced — I. A. Richards, not I.A. Richards." },
      { Tag: "", Notes: "Titles keep their own capitals and apostrophes — Tess of the d’Urbervilles." },
      { Tag: "", Notes: "Never put a comma inside a tag: a comma starts a new tag." },
      { Tag: "", Notes: "Difficulty is its own column, 1–5. Do not also write it as a tag." },
      { Tag: "", Notes: "" },
      {
        Tag: known.length ? "COPY THESE" : "NO TAGS YET",
        Notes: known.length
          ? "Character for character. A tag differing only in case founds a second bucket and halves your report."
          : "Pick a tag vocabulary on the New quiz screen, or invent one and then keep to it.",
      },
      ...known.map((t) => ({ Tag: t, Notes: "" })),
    ];
    const vocabSheet = XLSX.utils.json_to_sheet(rows, { header: ["Tag", "Notes"] });
    vocabSheet["!cols"] = [{ wch: 44 }, { wch: 78 }];
    XLSX.utils.book_append_sheet(wb, vocabSheet, "Tags");

    XLSX.writeFile(wb, "quizzine-template.xlsx");
  }

  /**
   * Start from nothing rather than from a file. Each door seeds one real
   * question of the kind asked for — the first thing on screen is then
   * something to edit rather than an empty box — and picks the marking that
   * kind implies, which the teacher can still change on the next screen.
   */
  function startFromScratch(kind: "written" | "mcq" | "poll") {
    const seeded: Question[] =
      kind === "written"
        ? [{ ...blankQuestion("essay"), id: "q1", text: "Write your question here.", points: 10, wordLimit: 250 }]
        : [
            {
              ...blankQuestion("mcq", kind === "mcq"),
              id: "q1",
              text: "Write your question here.",
              options: ["A", "B", "C", "D"].map((key) => ({ key, text: `Option ${key}` })),
            },
          ];
    const gradingMode: GradingMode = kind === "written" ? "rubric" : kind === "poll" ? "survey" : "graded";
    const parsed: ParsedQuiz = { title: "", questions: rawOf(seeded) };
    const result = validateQuestions(parsed, gradingMode);
    setDrafts([
      {
        id: `d${Date.now()}-s`,
        source: kind === "written" ? "Written answers" : kind === "poll" ? "Poll" : "Multiple choice",
        parsed,
        gradingMode,
        autoSurvey: false,
        title: "",
        description: "",
        questions: (result.questions.length ? result.questions : seeded).map(toEditable),
        errors: result.errors,
        warnings: result.warnings,
        excluded: false,
        open: true,
        // Straight into the editor: someone starting from scratch has nothing
        // to preview yet, they have a question to write.
        editing: true,
      },
    ]);
    setStep("review");
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(aiPrompt(preset || null, vocabulary, paperType === "allotted"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function publish() {
    if (groupMode) {
      const lo = Number(groupMin);
      const hi = Number(groupMax);
      if (!(lo >= 1) || !(hi >= lo)) {
        setPublishError("Group size limits must be at least 1, with the upper limit not below the lower limit.");
        return;
      }
    }
    setPublishError("");
    const allotted = paperType === "allotted";
    const settings = {
      allotMode: allotted || undefined,
      shuffleQuestions,
      shuffleOptions,
      multiScoring,
      peer,
      peerFromRubric,
      rubric,
      pasteGuard,
      hardWordLimit,
      timerMode: effectiveTimerMode,
      examMode,
      mstMode: allotted ? false : mstMode,
      mst: !allotted && mstMode ? mst : undefined,
      maxMinutes: effectiveTimerMode === "quiz" ? Number(maxMinutes) : undefined,
      perQuestionSeconds: effectiveTimerMode === "question" ? Number(perQuestionSeconds) : undefined,
      closesAt: closesAt ? new Date(closesAt).toISOString() : undefined,
      allowMultiple,
      groupMode: allotted ? false : groupMode,
      groupMin: !allotted && groupMode ? Number(groupMin) : undefined,
      groupMax: !allotted && groupMode ? Number(groupMax) : undefined,
    };

    const results: PublishResult[] = [];
    for (const [i, draft] of selected.entries()) {
      setPublishing(selected.length > 1 ? `Publishing ${i + 1} of ${selected.length}…` : "Publishing…");
      try {
        const res = await fetch("/api/quizzes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draft.title,
            description: draft.description,
            introMedia,
            preset: preset || undefined,
            questions: stripEditing(draft.questions),
            theme,
            // Scored vs survey is a property of the questions, so it travels per quiz.
            settings: { ...settings, gradingMode: draft.gradingMode },
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          results.push({ title: draft.title, error: data.error ?? `Publish failed (${res.status}). Are you still signed in?` });
          continue;
        }
        const data = await res.json();
        const url = `${window.location.origin}/q/${data.slug}`;
        results.push({ title: draft.title, slug: data.slug, id: data.id, qr: await QRCode.toDataURL(url, { width: 480, margin: 1 }) });
      } catch (err) {
        results.push({ title: draft.title, error: err instanceof Error ? err.message : String(err) });
      }
    }
    setPublishing("");
    setPublished(results);
    if (results.every((r) => r.error)) {
      setPublishError(results[0].error ?? "Nothing could be published.");
      return;
    }
    setStep("done");
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const liveOnes = published.filter((p) => p.slug);
  const failedOnes = published.filter((p) => p.error);

  function jumpTo(draftId: string) {
    document.getElementById(`draft-${draftId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Only errors on quizzes the teacher still wants actually block publishing.
  const blockingErrors = drafts.filter((d) => !d.excluded).reduce((n, d) => n + d.errors.length, 0);
  const reviewActions = (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={() => setStep("intake")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
        ← Back
      </button>
      <button
        onClick={() => setStep("settings")}
        disabled={!ready}
        className="rounded-lg bg-blue-700 px-5 py-2 text-sm text-white font-semibold hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Continue to settings →
      </button>
      <p className={`text-xs ${ready ? "text-slate-500" : "text-amber-700"}`}>
        {ready
          ? `${selected.length} quiz${selected.length === 1 ? "" : "zes"} ready · ${selected.reduce((n, d) => n + d.questions.length, 0)} questions`
          : blockingErrors > 0
            ? // Name the real obstacle: there is nothing to tick until these are fixed.
              `${blockingErrors} error${blockingErrors === 1 ? "" : "s"} to fix below before you can continue.`
            : selected.length === 0
              ? drafts.length > 1
                ? "Tick at least one quiz to continue."
                : "This quiz cannot be published yet — see the notes below."
              : "Give every selected quiz a title to continue."}
      </p>
    </div>
  );

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">New quiz</h1>
        <Link href="/teacher" className="text-sm text-slate-500 hover:text-slate-800">← Dashboard</Link>
      </div>
      <ol className="mt-3 flex gap-2 text-xs font-medium text-slate-400">
        {(["intake", "review", "settings", "done"] as Step[]).map((s, i) => (
          <li key={s} className={`rounded-full px-3 py-1 ${step === s ? "bg-blue-700 text-white" : "bg-slate-100"}`}>
            {i + 1}. {s === "intake" ? "Add questions" : s === "review" ? "Check & preview" : s === "settings" ? "Settings" : "Share"}
          </li>
        ))}
      </ol>

      {step === "intake" && (() => {
        /* Rendered inside whichever open card needs them, so the finish line of
           a path sits next to its beginning. Only one card is open at a time,
           so the single file-input ref is never shared between two mounts. */
        const dropZone = (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
            onClick={() => fileInput.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${
              dragOver ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-white hover:border-slate-400"
            }`}
          >
            <p className="font-semibold text-slate-700">Drop your quiz file here, or click to browse</p>
            <p className="text-sm text-slate-500 mt-1">.xlsx, .csv, .json, .txt, .md — or a Google Apps Script .gs / .js file</p>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xlsm,.xls,.csv,.json,.txt,.md,.gs,.js"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </div>
        );
        const pasteBox = (
          <div>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={10}
              placeholder={'Paste the AI\'s final output here — JSON, a Google Apps Script quiz builder, or the plain-text block format:\n\nQ: What is ...?\nType: mcq\nA: ...\nB: ...\nFA: feedback for A\nCorrect: B\nPoints: 1'}
              className="w-full rounded-xl border border-slate-300 bg-white p-4 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button onClick={handlePaste} disabled={!!parsing} className="mt-2 rounded-lg bg-blue-700 px-5 py-2.5 text-white font-semibold hover:bg-blue-800 disabled:opacity-50">
              {parsing ? "Reading…" : "Parse questions"}
            </button>
          </div>
        );
        const feedback = (
          <>
            {parsing && <p className="mt-2 text-sm text-slate-500">{parsing}</p>}
            {parseError && <p className="mt-2 text-sm text-red-600">{parseError}</p>}
          </>
        );
        const cardHeader = (target: IntakePath, title: string, sub: string) => (
          <button onClick={() => choosePath(target)} className="flex w-full items-baseline gap-2 text-left" aria-expanded={path === target}>
            <span className={`text-base font-bold ${path === target ? "text-slate-900" : "text-slate-600"}`}>{title}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{sub}</span>
            <span className="text-xs text-slate-400">{path === target ? "▾" : "▸"}</span>
          </button>
        );
        return (
        <section className="mt-8 space-y-5">
          {/* ---------- zone 1: whose paper ---------- */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">Paper type</p>
              {(
                [
                  ["same", "Same paper for everyone"],
                  ["allotted", "Allotted test — each student gets their own question"],
                ] as [PaperType, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setPaperType(value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    paperType === value ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {paperType === "allotted" && (
              <p className="mt-2 text-xs text-slate-600">
                The questions you add here become a <span className="font-semibold">bank</span>: after publishing, you
                attach your class roster and Quizzine deals each roll number its own question. The quiz stays closed
                until every roll on the roster has one. Group work, adaptive papers and peer review do not apply.
              </p>
            )}
          </div>

          {/* ---------- zone 2: how questions arrive ---------- */}
          <p className="text-sm font-semibold text-slate-900">How do you want to add questions?</p>

          <div className={`rounded-xl border p-4 ${path === "scratch" ? "border-slate-400 bg-white" : "border-slate-200 bg-white"}`}>
            {cardHeader("scratch", "✏️ Write your own questions", "type them into the editor here, one at a time")}
            {path === "scratch" && (
              <div className="mt-4">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["mcq", "Multiple choice"],
                      ["written", "Written answers"],
                      ["poll", "Poll"],
                    ] as ["mcq" | "written" | "poll", string][]
                  ).map(([kind, label]) => (
                    <button
                      key={kind}
                      onClick={() => startFromScratch(kind)}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  One question of that kind opens straight in the editor. Add as many more as you like there, and change
                  any question&rsquo;s type as you go.
                </p>
              </div>
            )}
          </div>

          <div className={`rounded-xl border p-4 ${path === "ai" ? "border-blue-300 bg-blue-50/40" : "border-slate-200 bg-white"}`}>
            {cardHeader("ai", "✨ Create Exam with AI", "recommended — ChatGPT, Claude or Gemini writes the file, you review it here")}
            {path === "ai" && (
              <ol className="mt-4 space-y-4">
                <li className="flex gap-3">
                  <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-blue-700 text-center text-sm font-bold leading-6 text-white">1</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">Copy the prompt</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button onClick={copyPrompt} className="rounded-lg bg-blue-700 px-4 py-2 text-sm text-white font-semibold hover:bg-blue-800">
                        {copied ? "Copied ✓" : "Copy AI prompt"}
                      </button>
                      <button onClick={() => setShowPrompt((v) => !v)} className="text-sm font-semibold text-blue-800 underline underline-offset-2 hover:text-blue-900">
                        {showPrompt ? "Hide prompt" : "View prompt"}
                      </button>
                    </div>
                    {showPrompt && (
                      <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-white border border-slate-200 p-3 text-xs whitespace-pre-wrap text-slate-700">{aiPrompt(preset || null, vocabulary, paperType === "allotted")}</pre>
                    )}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-600">How should questions be tagged?</summary>
                      <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-600">
                          A tag vocabulary is the fixed set of words every question gets labelled with — the periods,
                          genres, units or skills you teach. Naming one here writes it into the prompt, so the AI uses
                          the same words on every quiz. That is what lets the strengths report pool a whole term into
                          one picture instead of splitting each topic across near-identical spellings.
                        </p>
                        <label className="mt-3 block text-sm font-semibold text-slate-800">
                          Tag vocabulary
                          <select
                            value={preset}
                            onChange={(e) => setPreset(e.target.value)}
                            className="ml-2 rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-normal text-slate-900"
                          >
                            <option value="">No fixed list — let the AI propose one</option>
                            {TAG_PRESETS.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} — {p.description}
                              </option>
                            ))}
                          </select>
                        </label>
                        {/* What the current choice actually means, spelled out — the
                            <select> row itself is truncated on a narrow screen. */}
                        <p className="mt-2 text-xs text-slate-600">
                          {preset
                            ? `Every question will be tagged from the ${findPreset(preset)?.name} list, so this quiz can be pooled with every other one that uses it.`
                            : "The AI will propose a vocabulary for your subject in its first reply, for you to approve. Choose this the first time; afterwards, reuse what you approved so your quizzes stay comparable."}
                        </p>
                        {vocabulary.length > 0 && (
                          <p className="mt-2 text-xs text-slate-500">
                            Either way, the {vocabulary.length} tag{vocabulary.length === 1 ? "" : "s"} your earlier
                            quizzes already use are listed in the prompt, with instructions to reuse them rather than
                            invent near-copies.
                          </p>
                        )}
                      </div>
                    </details>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-blue-700 text-center text-sm font-bold leading-6 text-white">2</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">Chat</p>
                    <p className="mt-1 text-sm text-slate-600">
                      Paste it into ChatGPT, Claude or Gemini with your brief and any source material. It will ask about
                      anything you left open — the topic or text, question types, level, marking — then return a quiz
                      file.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-blue-700 text-center text-sm font-bold leading-6 text-white">3</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">Bring back the result</p>
                    <div className="mt-2 flex gap-2 text-xs font-semibold">
                      <button onClick={() => setTab("paste")} className={`rounded-lg px-3 py-1.5 ${tab === "paste" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
                        Paste it
                      </button>
                      <button onClick={() => setTab("upload")} className={`rounded-lg px-3 py-1.5 ${tab === "upload" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
                        Upload the file
                      </button>
                    </div>
                    <div className="mt-2">{tab === "paste" ? pasteBox : dropZone}</div>
                    {feedback}
                  </div>
                </li>
              </ol>
            )}
          </div>

          <div className={`rounded-xl border p-4 ${path === "upload" ? "border-slate-300 bg-white" : "border-slate-200 bg-white"}`}>
            {cardHeader("upload", "📄 Upload a file with questions", "a spreadsheet, JSON, text file, or a Google Forms Apps Script")}
            {path === "upload" && (
              <div className="mt-4 space-y-4">
                <ol className="space-y-2.5 text-sm text-slate-700">
                  <li className="flex gap-2">
                    <span className="font-bold text-slate-400">1.</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-slate-900">Get the template.</span>
                      <button
                        onClick={downloadTemplate}
                        className="ml-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Download Excel template
                      </button>
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-slate-400">2.</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-slate-900">Fill it in.</span> Type the questions in yourself —
                      or attach the template to ChatGPT, Claude or Gemini along with your topic, your source material,
                      or a PDF or photo of questions you already have, and ask it to fill the template in. The template
                      carries its own instructions, so the AI needs nothing else from you.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-slate-400">3.</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-slate-900">Drop the finished file below.</span> You review
                      every question on the next screen before anything is published.
                    </span>
                  </li>
                </ol>

                {dropZone}
                {feedback}
                <div className="flex gap-2 text-xs font-semibold">
                  <button onClick={() => setTab("paste")} className="text-slate-600 underline underline-offset-2 hover:text-slate-900">
                    {tab === "paste" ? "…or drop the file above" : "Or paste it as text instead"}
                  </button>
                </div>
                {tab === "paste" && (
                  <>
                    {pasteBox}
                  </>
                )}
                <p className="text-xs text-slate-500">
                  The template is not the only thing accepted here: JSON, plain text, and Google Forms Apps Script files
                  (.gs or .js) are read as they are — every form the script builds becomes a quiz. A workbook with
                  several sheets works the same way: one quiz per sheet.
                </p>
              </div>
            )}
          </div>

          {/* ---------- zone 3: reference ---------- */}
          <details className="rounded-xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Format reference — question types and passages</summary>
            <div className="mt-3 space-y-3 text-sm text-slate-700">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">The Type column</p>
                <ul className="mt-1.5 space-y-1">
                  {TYPE_GUIDE.map((t) => (
                    <li key={t.type}>
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">{t.type}</code> — {t.what}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-slate-500">
                  A whole quiz can be marked as having no correct answers on the next screen — useful for surveys,
                  opinion polls and work you intend to have peer-reviewed. The AI gives you an Excel file by default;
                  say so in your brief if you would rather have JSON, plain text or an Apps Script.
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Giving students something to read first — a passage, a sample response, some theory
                </p>
                <p className="mt-1.5">
                  Put it in the <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">Passage</code> column
                  and head it with{" "}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">PassageTitle</code> — for example
                  &ldquo;Sample response&rdquo; or &ldquo;Read this first&rdquo;. Both are optional and most quizzes leave them empty.
                </p>
                <p className="mt-2">
                  To put one passage in front of several questions, copy the same text down each of their rows: identical
                  text on neighbouring rows is shown <strong>once</strong>, above them all. Change the text and a new
                  block begins, so one paper can carry a different passage for each section.
                </p>
              </div>
            </div>
          </details>
        </section>
        );
      })()}

      {step === "review" && (
        <section className="mt-8 space-y-5">
          {/* Repeated top and bottom so a long list never has to be scrolled to act on. */}
          <div className="sticky top-0 z-20 -mx-6 border-b border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
            {reviewActions}
          </div>

          {/*
            Near misses. Case, spacing and punctuation are already folded in
            above; what is left here is a value one typo from an established
            spelling, which may equally be a different word — so it is offered
            rather than applied. Left alone it simply publishes as written.
          */}
          {tagsTidied > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">
                Tags on {tagsTidied} question{tagsTidied === 1 ? "" : "s"} were folded into the spelling already in use
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Only differences of case, spacing or punctuation — the words are unchanged. Where the file disagreed
                with itself and neither spelling was in use before, the one on the most questions won. Edit any
                question below if you meant them to be different tags.
              </p>
            </div>
          )}

          {nearMisses.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">
                {nearMisses.length} tag{nearMisses.length === 1 ? " looks" : "s look"} close to ones you already use
              </p>
              <p className="mt-1 text-xs text-amber-800">
                Two spellings of one topic split your strengths-and-weaknesses report into two buckets too small to read.
                Adopt the existing spelling unless these really are different things.
              </p>
              <ul className="mt-2 space-y-1.5">
                {nearMisses.map((m) => (
                  <li key={m.incoming} className="flex flex-wrap items-center gap-2 text-xs text-amber-900">
                    <span className="rounded bg-white px-2 py-1 font-medium">{m.incoming}</span>
                    <span>is close to</span>
                    <span className="rounded bg-white px-2 py-1 font-semibold">{m.existing}</span>
                    <button
                      onClick={() => adoptTag(m)}
                      className="rounded-lg border border-amber-400 px-2.5 py-1 font-semibold text-amber-900 hover:bg-amber-100"
                    >
                      Use the existing tag
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {drafts.length > 1 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-semibold text-slate-900">{drafts.length} quizzes found in this file</p>
              <p className="mt-1 text-sm text-slate-600">
                Each one is published separately, with its own link and QR code, sharing the settings you pick next.
                Untick any you do not want, and edit the titles students will see.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                <button
                  onClick={() => setDrafts((list) => list.map((d) => ({ ...d, excluded: false })))}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100"
                >
                  Select all
                </button>
                <button
                  onClick={() => setDrafts((list) => list.map((d) => ({ ...d, excluded: true })))}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100"
                >
                  Clear selection
                </button>
                <button
                  onClick={() => setDrafts((list) => list.map((d) => ({ ...d, open: true })))}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100"
                >
                  Expand all
                </button>
                <button
                  onClick={() => setDrafts((list) => list.map((d) => ({ ...d, open: false })))}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100"
                >
                  Collapse all
                </button>
              </div>
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold text-slate-400">Jump to</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {drafts.map((d, i) => (
                    <button
                      key={d.id}
                      onClick={() => jumpTo(d.id)}
                      title={d.title || `Quiz ${i + 1}`}
                      className={`max-w-52 truncate rounded-lg border px-2.5 py-1 text-xs font-medium ${
                        d.errors.length
                          ? "border-red-300 bg-red-50 text-red-700"
                          : isIncluded(d)
                            ? "border-slate-300 text-slate-700 hover:bg-slate-100"
                            : "border-slate-200 text-slate-400 hover:bg-slate-50"
                      }`}
                    >
                      {i + 1}. {d.title || "Untitled"}
                      {d.errors.length > 0 && " ⚠"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {drafts.map((draft, idx) => {
            const points = draft.questions.reduce((s, qn) => s + qn.points, 0);
            const survey = draft.gradingMode === "survey";
            return (
              <div
                key={draft.id}
                id={`draft-${draft.id}`}
                className={`scroll-mt-24 rounded-xl border bg-white p-4 ${isIncluded(draft) ? "border-slate-300" : "border-slate-200 opacity-70"}`}
              >
                <div className="flex items-start gap-3">
                  {drafts.length > 1 && (
                    <input
                      type="checkbox"
                      checked={isIncluded(draft)}
                      disabled={draft.errors.length > 0}
                      onChange={(e) => updateDraft(draft.id, { excluded: !e.target.checked })}
                      className="mt-2.5 w-4 h-4 shrink-0"
                      aria-label={`Publish quiz ${idx + 1}`}
                    />
                  )}
                  <div className="flex-1 space-y-3">
                    {drafts.length > 1 && draft.source && <p className="text-xs font-semibold text-slate-400">{draft.source}</p>}
                    <input
                      value={draft.title}
                      onChange={(e) => updateDraft(draft.id, { title: e.target.value })}
                      placeholder="Quiz title (shown to students)"
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <textarea
                      value={draft.description}
                      onChange={(e) => updateDraft(draft.id, { description: e.target.value })}
                      placeholder="Instructions / description (optional)"
                      rows={2}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-800">Marking</p>
                        {(
                          [
                            ["graded", "Automatic"],
                            ["rubric", "Rubric (you, with optional AI assist)"],
                            ["peer", "Peer review"],
                            ["survey", "Not scored"],
                          ] as [GradingMode, string][]
                        ).map(([mode, label]) => {
                          const blocked = paperType === "allotted" && mode === "peer";
                          return (
                            <button
                              key={mode}
                              onClick={() => !blocked && setGradingMode(draft.id, mode)}
                              disabled={blocked}
                              title={blocked ? "In an allotted test a reviewer would meet a question they never sat, so peer review is unavailable." : undefined}
                              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                                draft.gradingMode === mode ? "bg-slate-900 text-white" : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-100"
                              } ${blocked ? "cursor-not-allowed opacity-40" : ""}`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-xs text-slate-600">
                        {draft.gradingMode === "peer"
                          ? "Students answer first with nothing marked. When you open peer review, each response is given to several classmates to mark against your rubric — anonymously, both ways. You set the rubric on the next screen."
                          : draft.gradingMode === "rubric"
                            ? "Choice questions are still marked automatically. Written answers go to a marking screen where you score them against your rubric, band by band — optionally starting from a pass by a chatbot, which you review. Students see “response recorded” until you release. You set the rubric on the next screen."
                            : survey
                              ? "Answers are collected but never marked. Students see a confirmation instead of a score, and you get the response spread for every question."
                              : "Questions with an answer key are marked automatically; typed answers wait for you on the marking screen. Individual questions can still be left unscored with Type “poll” or “open”."}
                      </p>
                      {(draft.gradingMode === "peer" || draft.gradingMode === "rubric") &&
                        !draft.questions.some((qn) => qn.type === "short" || qn.type === "essay") && (
                          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                            {draft.gradingMode === "peer"
                              ? "Peers mark written answers, and this quiz has none. Add at least one short or essay question, or there will be nothing for them to review."
                              : "Rubric marking is for written answers, and this quiz has none. Every question here will simply be marked automatically as usual."}
                          </p>
                        )}
                      {draft.autoSurvey && (
                        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                          No correct answers were found in this file, so it has been set up as a survey. If the answer key
                          is simply missing, switch to “Scored quiz” to see what needs filling in.
                        </p>
                      )}
                    </div>

                    {draft.errors.length > 0 && (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                        <p className="font-semibold text-red-800 text-sm">Fix these before publishing ({draft.errors.length})</p>
                        <ul className="mt-2 space-y-1 text-sm text-red-700 list-disc list-inside">
                          {draft.errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                      </div>
                    )}
                    {draft.warnings.length > 0 && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="font-semibold text-amber-800 text-sm">Worth checking ({draft.warnings.length})</p>
                        <ul className="mt-2 space-y-1 text-sm text-amber-700 list-disc list-inside">
                          {draft.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-slate-500">
                        {draft.questions.length} question{draft.questions.length === 1 ? "" : "s"} ·{" "}
                        {points === 0 ? "not scored" : `${points} point${points === 1 ? "" : "s"}`}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => updateDraft(draft.id, { open: true, editing: true })}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                            draft.open && draft.editing
                              ? "bg-slate-900 text-white"
                              : "border border-slate-300 text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          Write questions
                        </button>
                        <button
                          onClick={() => updateDraft(draft.id, { open: true, editing: false })}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                            draft.open && !draft.editing
                              ? "bg-slate-900 text-white"
                              : "border border-slate-300 text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          Preview
                        </button>
                        <button
                          onClick={() => updateDraft(draft.id, { open: false })}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Hide
                        </button>
                      </div>
                    </div>

                    {draft.open && draft.editing && (
                      <QuestionEditor
                        questions={draft.questions}
                        onChange={(next) => editQuestions(draft.id, next)}
                        unscored={survey || draft.gradingMode === "peer"}
                      />
                    )}

                    {draft.open && !draft.editing && (
                      <>
                        <p className="text-sm text-slate-500">
                          This is how they will read (correct answers marked here only — students never receive them before submitting).
                        </p>
                        <div className="space-y-4">
                          {groupByPassage(draft.questions).map((group) => (
                            <div key={group.start} className="space-y-4">
                              <Material text={group.passage} title={group.passageTitle} compact />
                              {group.questions.map((qn, j) => {
                                const i = group.start + j;
                                const scored = isGraded(qn);
                                const keys = correctKeysOf(qn);
                                return (
                                  <div key={qn.id} className="rounded-xl border border-slate-200 bg-white p-4">
                                    <p className="text-xs font-semibold text-slate-400">
                                      Q{i + 1} · {qn.type === "multi" ? "MULTI-ANSWER" : qn.type.toUpperCase()} ·{" "}
                                      {scored ? `${qn.points} pt` : "not scored"}
                                    </p>
                                    <p className="mt-1.5 font-medium text-slate-900">{qn.text}</p>
                                    {(qn.tags?.length || qn.difficulty !== undefined) && (
                                      <div className="mt-1.5 flex flex-wrap gap-1">
                                        {qn.difficulty !== undefined && (
                                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                                            {qn.difficulty} · {difficultyLabel(qn.difficulty)}
                                          </span>
                                        )}
                                        {qn.tags?.map((t) => (
                                          <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{t}</span>
                                        ))}
                                      </div>
                                    )}
                                    <Media url={qn.media} compact />
                                    {qn.type === "mcq" || qn.type === "multi" ? (
                                      <>
                                        {qn.type === "multi" && scored && (
                                          <p className="mt-2 text-xs font-semibold text-blue-700">
                                            Students tick all that apply — {keys.length} correct answers.
                                          </p>
                                        )}
                                        <ul className="mt-2 space-y-1.5">
                                          {qn.options.map((o) => {
                                            const right = scored && keys.includes(o.key);
                                            return (
                                              <li key={o.key} className={`text-sm rounded-lg px-3 py-1.5 border ${right ? "border-green-300 bg-green-50 text-green-900" : "border-slate-200 text-slate-700"}`}>
                                                <span className="font-semibold">{o.key}.</span> {o.text}
                                                {right && <span className="ml-1 text-xs font-semibold">✓ correct</span>}
                                                {o.feedback && <p className="text-xs text-slate-500 mt-0.5">↳ {o.feedback}</p>}
                                              </li>
                                            );
                                          })}
                                        </ul>
                                        {!scored && <p className="mt-2 text-xs italic text-slate-500">No correct answer — responses are collected only.</p>}
                                      </>
                                    ) : (
                                      <p className="mt-2 text-sm italic text-slate-500">
                                        {scored ? "Typed answer — graded by you later." : "Typed answer — collected, not graded."}
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <div className="rounded-xl border border-slate-200 bg-white p-4">{reviewActions}</div>

          {/* A single scratch-built quiz gets long in the editor too, so these are always here. */}
          <div className="fixed bottom-5 right-4 flex flex-col gap-2">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              aria-label="Jump to top"
              className="h-11 w-11 rounded-full bg-slate-900 text-lg font-bold text-white shadow-lg hover:bg-slate-700"
            >
              ↑
            </button>
            <button
              onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })}
              aria-label="Jump to bottom"
              className="h-11 w-11 rounded-full bg-slate-900 text-lg font-bold text-white shadow-lg hover:bg-slate-700"
            >
              ↓
            </button>
          </div>
        </section>
      )}

      {step === "settings" && (
        <section className="mt-8 space-y-6">
          {selected.length > 1 && (
            <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              These settings apply to all {selected.length} quizzes you are publishing.
            </p>
          )}
          {paperType === "allotted" && (
            <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              <span className="font-semibold">Allotted test.</span> This publishes closed: the next step is attaching
              your class roster on the quiz&rsquo;s edit page, and the quiz opens once every roll number has a question
              dealt to it. Group work and adaptive papers do not apply here, so those settings are hidden.
            </p>
          )}
          <div>
            <p className="font-semibold text-slate-900 text-sm">Theme</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition ${theme === t.id ? "border-blue-600" : "border-transparent"}`}
                  style={{ background: t.bg, color: t.text }}
                >
                  <span className="inline-block w-3 h-3 rounded-full mr-1.5 align-middle" style={{ background: t.accent }} />
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {paperType === "same" && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <p className="font-semibold text-slate-900 text-sm">Submission type</p>
            <div className="flex flex-wrap gap-2 text-sm">
              {([[false, "Individual"], [true, "Group work"]] as [boolean, string][]).map(([mode, label]) => (
                <button
                  key={label}
                  onClick={() => setGroupMode(mode)}
                  className={`rounded-lg px-4 py-2 font-medium ${groupMode === mode ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {groupMode ? (
              <div className="text-sm text-slate-700 space-y-2">
                <div className="flex flex-wrap gap-4">
                  <label>
                    Minimum members per group:{" "}
                    <input type="number" min={1} value={groupMin} onChange={(e) => setGroupMin(e.target.value)} className="ml-2 w-20 rounded-lg border border-slate-300 px-3 py-1.5" />
                  </label>
                  <label>
                    Maximum members per group:{" "}
                    <input type="number" min={1} value={groupMax} onChange={(e) => setGroupMax(e.target.value)} className="ml-2 w-20 rounded-lg border border-slate-300 px-3 py-1.5" />
                  </label>
                </div>
                <p className="text-xs text-slate-500">
                  One member submits for the whole group. They enter the group name, semester, and every member&apos;s name and roll number before starting.
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Each student submits their own attempt with their name, roll number and semester.</p>
            )}
          </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <input type="checkbox" checked={shuffleQuestions} onChange={(e) => setShuffleQuestions(e.target.checked)} className="w-4 h-4" />
              Shuffle question order per student
            </label>
            <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <input type="checkbox" checked={shuffleOptions} onChange={(e) => setShuffleOptions(e.target.checked)} className="w-4 h-4" />
              Shuffle options per student
            </label>
            <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <input type="checkbox" checked={allowMultiple} onChange={(e) => setAllowMultiple(e.target.checked)} className="w-4 h-4" />
              Allow multiple attempts per roll number
            </label>
          </div>

          {(anyRubric || peerFromRubric) && (
            <RubricEditor
              value={rubric}
              onChange={setRubric}
              heading="Marking rubric"
              note="Weights are percentages of the whole, so the same rubric marks a 5-mark paragraph and a 40-mark essay: a reviewer scores a percentage and the marks follow from the question's own points. You, and any AI pass you run, score all of these; peers score the bands only."
            />
          )}

          {writtenQuestions.length > 0 && (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-900">Written answers</p>
              <p className="text-xs text-slate-500">
                A word limit is advisory: the counter warns the student, and overrunning is marked down under the rubric
                rather than blocked. Leave it empty for no limit.
              </p>
              <div className="space-y-2">
                {writtenQuestions.map(({ draftId, draftTitle, qn }) => (
                  <div key={`${draftId}-${qn.id}`} className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 first:border-0 first:pt-0">
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700" title={qn.text}>
                      {selected.length > 1 && <span className="text-slate-400">{draftTitle}: </span>}
                      {qn.text}
                    </span>
                    <label className="text-xs text-slate-500">
                      word limit
                      <input
                        type="number"
                        min={1}
                        value={qn.wordLimit ?? ""}
                        placeholder="—"
                        onChange={(e) =>
                          patchQuestion(draftId, qn.id, {
                            wordLimit: Number(e.target.value) > 0 ? Math.round(Number(e.target.value)) : undefined,
                          })
                        }
                        className="ml-1.5 w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                      />
                    </label>
                    {(anyRubric || peerFromRubric) && (
                      <details className="w-full">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                          Weight this question differently
                        </summary>
                        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                          {rubric.bands.flatMap((band) =>
                            band.params.map((param) => (
                              <label key={param.id} className="flex items-center gap-2 text-xs text-slate-600">
                                <span className="min-w-0 flex-1 truncate" title={`${band.label} — ${param.label}`}>
                                  {param.label}
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={0.5}
                                  value={qn.rubricWeights?.[param.id] ?? ""}
                                  placeholder={String(param.weight)}
                                  onChange={(e) => {
                                    const next = { ...(qn.rubricWeights ?? {}) };
                                    if (e.target.value === "") delete next[param.id];
                                    else next[param.id] = Math.max(0, Number(e.target.value) || 0);
                                    patchQuestion(draftId, qn.id, {
                                      rubricWeights: Object.keys(next).length ? next : undefined,
                                    });
                                  }}
                                  className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-right text-slate-900"
                                />
                              </label>
                            ))
                          )}
                        </div>
                        <p className="mt-1.5 text-xs text-slate-400">
                          Blank means the rubric's own weight. Only the parameters you fill in change.
                        </p>
                      </details>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
                <label className="flex items-start gap-2.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={hardWordLimit}
                    onChange={(e) => setHardWordLimit(e.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    Stop typing at the word limit
                    <span className="block text-xs text-slate-500">
                      Off by default. A student who has written 210 words of a good answer should be told, not silenced.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={pasteGuard}
                    onChange={(e) => setPasteGuard(e.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    Block pasting into written answers
                    <span className="block text-xs text-slate-500">
                      A deterrent, not a security control — trivially got round, and it breaks drafting offline and
                      transliteration keyboards, which paste. Typing activity is recorded either way and shown to you on
                      the marking screen; students are told so before they start.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {anyPeer && (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-900">Peer review rubric</p>
              <label className="flex items-start gap-2.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={peerFromRubric}
                  onChange={(e) => setPeerFromRubric(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  Use the marking rubric&apos;s bands as the criteria
                  <span className="block text-xs text-slate-500">
                    Peers then score four bands on a five-step scale — Very poor to Excellent — instead of ten
                    parameters. The same rubric, one zoom level out: ten parameters across several questions and three
                    reviews is where reviewers stop reading and start clicking.
                  </span>
                </span>
              </label>
              <p className="text-xs text-slate-500">
                Classmates score every typed answer against these criteria and leave a comment. A response is worth{" "}
                <span className="font-semibold text-slate-700">{peerMaxScore(peer.criteria, peerQuestionCount)} marks</span>{" "}
                ({peerQuestionCount} reviewed question{peerQuestionCount === 1 ? "" : "s"}).
              </p>
              <PeerEditor value={peer} onChange={setPeer} hideCriteria={peerFromRubric} />
              <p className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900">
                Publishing opens the responding phase. When everyone has answered, come back to the quiz page and click
                “Open peer review” — that is what hands the work out.
              </p>
            </div>
          )}

          {hasMultiQuestions && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <p className="font-semibold text-slate-900 text-sm">Marking multiple-answer questions</p>
              <div className="flex flex-wrap gap-2 text-sm">
                {([["exact", "All or nothing"], ["partial", "Partial credit"]] as [MultiScoring, string][]).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setMultiScoring(mode)}
                    className={`rounded-lg px-4 py-2 font-medium ${multiScoring === mode ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                {multiScoring === "exact"
                  ? "Full marks only when the student ticks exactly the right set — nothing otherwise. The simplest rule to explain."
                  : "Each correct tick earns a share of the marks and each wrong tick cancels one, never going below zero — so ticking everything scores nothing."}
              </p>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={examMode}
                onChange={(e) => setExamMode(e.target.checked)}
                className="mt-0.5 w-4 h-4"
              />
              <span>
                <span className="font-semibold text-slate-900">Exam Interface mode</span>
                <span className="mt-1 block text-xs text-slate-500">
                  Students see one question at a time in a layout modelled on national-level competitive
                  examinations — a question palette showing what is answered, skipped or flagged, plus Save
                  &amp; Next and Mark for Review controls. Answers count only once saved, as in the real
                  thing. Use it to let students rehearse the interface itself, not just the questions.
                </span>
              </span>
            </label>
          </div>

          {paperType === "same" && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={mstMode}
                onChange={(e) => setMstMode(e.target.checked)}
                className="mt-0.5 w-4 h-4"
              />
              <span>
                <span className="font-semibold text-slate-900">Adaptive paper (multistage)</span>
                <span className="mt-1 block text-xs text-slate-500">
                  The paper is dealt in sections rather than all at once. Everyone sits the same first section;
                  each section after it is drawn harder or easier according to how the last one went, so one
                  bank of questions gives a stronger and a weaker student a paper pitched at each of them.
                  Students move freely inside a section but cannot return to one they have finished. Combine it
                  with Exam Interface mode for a full rehearsal. Needs a Difficulty on your questions.
                </span>
              </span>
            </label>

            {mstMode && (
              <div className="space-y-3 border-t border-slate-200 pt-3">
                <div className="flex flex-wrap gap-4 text-sm text-slate-700">
                  <label>
                    Sections:{" "}
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={mst.stages}
                      onChange={(e) => setMst({ ...mst, stages: Math.max(1, Number(e.target.value) || 1) })}
                      className="ml-1 w-20 rounded-lg border border-slate-300 px-2 py-1.5"
                    />
                  </label>
                  <label>
                    Questions per section:{" "}
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={mst.perStage}
                      onChange={(e) => setMst({ ...mst, perStage: Math.max(1, Number(e.target.value) || 1) })}
                      className="ml-1 w-20 rounded-lg border border-slate-300 px-2 py-1.5"
                    />
                  </label>
                  <label>
                    Start at:{" "}
                    <select
                      value={mst.startDifficulty}
                      onChange={(e) => setMst({ ...mst, startDifficulty: Number(e.target.value) })}
                      className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{n} — {difficultyLabel(n)}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <p className="text-xs text-slate-500">
                  Each student sits {mst.stages * mst.perStage} of the questions in the file.
                </p>

                <div className="flex flex-wrap gap-4 text-sm text-slate-700">
                  <label>
                    Step up at or above:{" "}
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={mst.routeUpAt}
                      onChange={(e) => setMst({ ...mst, routeUpAt: Number(e.target.value) || 0 })}
                      className="ml-1 w-20 rounded-lg border border-slate-300 px-2 py-1.5"
                    />%
                  </label>
                  <label>
                    Step down at or below:{" "}
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={mst.routeDownAt}
                      onChange={(e) => setMst({ ...mst, routeDownAt: Number(e.target.value) || 0 })}
                      className="ml-1 w-20 rounded-lg border border-slate-300 px-2 py-1.5"
                    />%
                  </label>
                </div>
                {mst.routeUpAt <= mst.routeDownAt && (
                  <p className="text-xs text-amber-700">
                    The step-up mark must be above the step-down mark, or a section would step both ways at
                    once. It will be nudged up when you publish.
                  </p>
                )}

                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <p className="text-sm font-semibold text-slate-900">Marks</p>
                  <div className="flex flex-wrap gap-2 text-sm">
                    {([["fixed", "Each question is worth what the file says"], ["byDifficulty", "Harder questions are worth more"]] as const).map(
                      ([value, label]) => (
                        <button
                          key={value}
                          onClick={() => setMst({ ...mst, scoring: value })}
                          className={`rounded-lg px-4 py-2 font-medium ${mst.scoring === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
                        >
                          {label}
                        </button>
                      )
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {mst.scoring === "fixed"
                      ? "Everyone is judged on the percentage of the paper they were actually given, which stays comparable however students were routed."
                      : "A level 5 question is worth 5 marks and a level 1 is worth 1. Percentages stay comparable, but raw totals do not — two students who routed differently were marked out of different totals."}
                  </p>
                  <label className="flex items-start gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={mst.abilityScore}
                      onChange={(e) => setMst({ ...mst, abilityScore: e.target.checked })}
                      className="mt-0.5 w-4 h-4"
                    />
                    <span>
                      <span className="font-semibold text-slate-900">Also report an ability estimate</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        A single 0&ndash;100 figure placing the student on the difficulty scale itself, so that
                        60% of very difficult questions is not read as the same achievement as 60% of very easy
                        ones. It is the honest way to compare two students who sat different papers, and an easy
                        number to over-read on its own — it is shown with its margin of error for that reason.
                      </span>
                    </span>
                  </label>
                </div>

                {(() => {
                  const bank = selected.flatMap((d) => d.questions);
                  if (!bank.length) return null;
                  const capacity = mstCapacity(bank, mst);
                  const thin = capacity.thinLevels.filter((l) => l.available === 0);
                  return (
                    <div className="space-y-1 border-t border-slate-200 pt-3 text-xs">
                      <p className="text-slate-600">
                        Your file holds {capacity.bank} questions; a student sits {Math.min(capacity.bank, capacity.wanted)}.
                      </p>
                      {capacity.warnings.map((w) => (
                        <p key={w} className="text-amber-700">{w}</p>
                      ))}
                      {thin.length > 0 && (
                        <p className="text-amber-700">
                          Nothing at difficulty {thin.map((l) => l.difficulty).join(", ")} — a student routed there will be
                          given the nearest level instead.
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <p className="font-semibold text-slate-900 text-sm">Timer</p>
            <div className="flex flex-wrap gap-2 text-sm">
              {([["none", "No timer"], ["quiz", "Whole-quiz limit"], ["question", "Per-question countdown"]] as [TimerMode, string][]).map(([mode, label]) => {
                const blocked = (examMode || mstMode) && mode === "question";
                return (
                  <button
                    key={mode}
                    onClick={() => !blocked && setTimerMode(mode)}
                    disabled={blocked}
                    title={blocked ? "This mode uses a whole-paper timer." : undefined}
                    className={`rounded-lg px-4 py-2 font-medium ${effectiveTimerMode === mode ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"} ${blocked ? "opacity-40 cursor-not-allowed" : ""}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {(examMode || mstMode) && (
              <p className="text-xs text-slate-500">
                {mstMode ? "An adaptive paper" : "Exam Interface mode"} lets students move between questions, so it
                uses a whole-paper timer — the per-question countdown is unavailable.
              </p>
            )}
            {effectiveTimerMode === "quiz" && (
              <label className="block text-sm text-slate-700">
                Maximum minutes once a student starts:{" "}
                <input type="number" min={1} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} className="ml-2 w-24 rounded-lg border border-slate-300 px-3 py-1.5" />
              </label>
            )}
            {effectiveTimerMode === "question" && (
              <div className="text-sm text-slate-700 space-y-2">
                <label className="block">
                  Seconds per question:{" "}
                  <input type="number" min={5} value={perQuestionSeconds} onChange={(e) => setPerQuestionSeconds(e.target.value)} className="ml-2 w-24 rounded-lg border border-slate-300 px-3 py-1.5" />
                </label>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  Per-question mode shows one question at a time and students cannot go back — like a rapid-fire round.
                </p>
              </div>
            )}
            <label className="block text-sm text-slate-700">
              Stop accepting responses at (optional):{" "}
              <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className="ml-2 rounded-lg border border-slate-300 px-3 py-1.5" />
            </label>
          </div>

          <label className="block text-sm text-slate-700">
            <span className="font-semibold text-slate-900">Intro media (optional)</span> — an image or YouTube video students see before starting (e.g. “watch this, then begin”):
            <input
              value={introMedia}
              onChange={(e) => setIntroMedia(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          {publishError && <p className="text-sm text-red-600">{publishError}</p>}
          <div className="flex gap-3">
            <button onClick={() => setStep("review")} className="rounded-lg border border-slate-300 px-5 py-2.5 font-semibold text-slate-700 hover:bg-slate-100">
              ← Back
            </button>
            <button
              onClick={publish}
              disabled={!!publishing || rubricBroken}
              className="rounded-lg bg-green-700 px-6 py-2.5 text-white font-semibold hover:bg-green-800 disabled:opacity-50"
            >
              {publishing || (selected.length > 1 ? `Publish ${selected.length} quizzes` : "Publish quiz")}
            </button>
          </div>
          {rubricBroken && (
            <p className="text-xs text-amber-700">
              The rubric weights do not add up to 100% yet — fix that above and this unlocks.
            </p>
          )}
        </section>
      )}

      {step === "done" && published.length > 0 && (
        <section className="mt-8 space-y-5">
          <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
            <p className="text-2xl">🎉</p>
            <h2 className="mt-1 text-xl font-bold text-green-900">
              {paperType === "allotted"
                ? liveOnes.length > 1
                  ? `${liveOnes.length} allotted tests are published`
                  : `“${liveOnes[0]?.title}” is published`
                : liveOnes.length > 1
                  ? `${liveOnes.length} quizzes are live`
                  : `“${liveOnes[0]?.title}” is live`}
            </h2>
            <p className="mt-2 text-sm text-green-800">
              {paperType === "allotted"
                ? "One step left: attach your class roster and deal the questions. The quiz stays closed to students until every roll number has one."
                : "Share the link (or the QR code) with your students:"}
            </p>
            {paperType === "allotted" && liveOnes[0]?.id && (
              <Link
                href={`/teacher/quiz/${liveOnes[0].id}/edit#allotment`}
                className="mt-3 inline-block rounded-lg bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800"
              >
                Attach the roster →
              </Link>
            )}
            {liveOnes.length > 1 && (
              <button
                onClick={() => navigator.clipboard.writeText(liveOnes.map((p) => `${p.title}: ${origin}/q/${p.slug}`).join("\n"))}
                className="mt-3 rounded-lg bg-green-700 px-4 py-2 text-sm text-white font-semibold hover:bg-green-800"
              >
                Copy all links
              </button>
            )}
          </div>

          {failedOnes.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="font-semibold text-red-800 text-sm">Could not publish {failedOnes.length}</p>
              <ul className="mt-2 space-y-1 text-sm text-red-700 list-disc list-inside">
                {failedOnes.map((p, i) => <li key={i}>“{p.title}” — {p.error}</li>)}
              </ul>
            </div>
          )}

          {liveOnes.map((p) => {
            const url = `${origin}/q/${p.slug}`;
            return (
              <div key={p.slug} className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center gap-4">
                {p.qr && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.qr} alt={`QR code for ${p.title}`} className="w-32 h-32 rounded-lg border border-slate-200 bg-white p-1" />
                )}
                <div className="flex-1 min-w-60">
                  <p className="font-semibold text-slate-900">{p.title}</p>
                  <code className="mt-1 block break-all rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700">{url}</code>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => navigator.clipboard.writeText(url)}
                      className="rounded-lg bg-green-700 px-4 py-2 text-sm text-white font-semibold hover:bg-green-800"
                    >
                      Copy link
                    </button>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                      Open as student
                    </a>
                    {paperType === "allotted" && p.id && (
                      <Link
                        href={`/teacher/quiz/${p.id}/edit#allotment`}
                        className="rounded-lg border border-green-300 bg-green-50 px-4 py-2 text-sm font-semibold text-green-800 hover:bg-green-100"
                      >
                        Attach roster
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <div className="flex justify-center">
            <Link href="/teacher" className="rounded-lg bg-blue-700 px-5 py-2.5 text-white font-semibold hover:bg-blue-800">
              Back to dashboard
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
