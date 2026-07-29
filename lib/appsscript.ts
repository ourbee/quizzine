/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import type { ParsedQuiz, RawQuestion } from "./types";

/**
 * Reading Google Apps Script quiz builders.
 *
 * Teachers already have .gs / .js files that build Google Form quizzes — either
 * data-driven (a FORM_DEFS array plus a generic builder) or imperative (a long
 * run of form.addMultipleChoiceItem() calls). Rather than pattern-match the many
 * shapes those files take, we *run* the script against a mock Apps Script
 * runtime inside a sandboxed iframe and record every form it builds. One script
 * can therefore yield several quizzes.
 */

const OPTION_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export type HarvestedKind = "mcq" | "checkbox" | "list" | "text" | "paragraph" | "other";

export interface HarvestedItem {
  kind: HarvestedKind;
  title: string;
  help: string;
  points?: number;
  choices: { text: string; correct: boolean }[];
  feedbackCorrect: string;
  feedbackIncorrect: string;
  section: string;
}

export interface HarvestedForm {
  title: string;
  description: string;
  items: HarvestedItem[];
}

/** Fields the Apps Script forms collect that Quizzine asks for itself. */
const IDENTITY_RE =
  /^(full\s*name|name|your\s*name|student\s*name|roll|roll\s*(no\.?|number)|registration|reg\.?\s*no|enrol(l)?ment|email|e-?mail|semester|sem|class|section|department|college|course|batch|date|phone|mobile)\b/i;
const IDENTITY_SECTION_RE = /student\s*info|your\s*details|respondent|participant\s*info/i;

export function looksLikeAppsScript(text: string): boolean {
  return /\bFormApp\s*\./.test(text) || /\.\s*add(MultipleChoice|Checkbox|List|PageBreak)Item\s*\(/.test(text);
}

/** Strip markdown code fences a teacher may have copied along with the script. */
export function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:javascript|js|gs|apps-?script)?\s*\n([\s\S]*?)```/i);
  return fenced ? fenced[1] : text;
}

/**
 * The mock Apps Script runtime. Runs inside a sandboxed iframe (no same-origin
 * access), receives the teacher's script by postMessage, and posts back the
 * forms it built. Anything it does not model is a chainable no-op, so unusual
 * scripts degrade instead of crashing.
 */
export const SANDBOX_SOURCE = `
(function () {
  "use strict";
  function post(msg) { parent.postMessage(msg, "*"); }

  // Any method we do not model returns the same object, so long chains survive.
  function chain(obj) {
    var p = new Proxy(obj, {
      get: function (t, prop) {
        if (prop in t) { var v = t[prop]; return typeof v === "function" ? v.bind(p) : v; }
        if (typeof prop === "symbol") return undefined;
        return function () { return p; };
      },
    });
    return p;
  }

  var forms = [];
  var scheduled = [];

  function text(v) { return v === undefined || v === null ? "" : String(v); }

  function makeItem(form, kind) {
    var data = {
      kind: kind, title: "", help: "", points: undefined, choices: [],
      feedbackCorrect: "", feedbackIncorrect: "", section: form.section,
    };
    form.items.push(data);
    return chain({
      setTitle: function (t) { data.title = text(t); return this; },
      setHelpText: function (t) { data.help = text(t); return this; },
      setPoints: function (n) { var v = Number(n); if (isFinite(v)) data.points = v; return this; },
      getPoints: function () { return data.points || 0; },
      getTitle: function () { return data.title; },
      createChoice: function (t, correct) {
        return { __choice: true, text: text(t), correct: correct === true };
      },
      setChoices: function (list) {
        data.choices = (list || []).map(function (c) {
          return c && c.__choice ? { text: c.text, correct: c.correct }
                                 : { text: text(c), correct: false };
        });
        return this;
      },
      setChoiceValues: function (values) {
        data.choices = (values || []).map(function (v) { return { text: text(v), correct: false }; });
        return this;
      },
      setFeedbackForCorrect: function (f) { data.feedbackCorrect = f && f.__text ? f.__text : ""; return this; },
      setFeedbackForIncorrect: function (f) { data.feedbackIncorrect = f && f.__text ? f.__text : ""; return this; },
      getId: function () { return form.items.length; },
      getIndex: function () { return form.items.length - 1; },
    });
  }

  function makeForm(title) {
    var form = { title: text(title), description: "", items: [], section: "" };
    forms.push(form);
    var api = chain({
      setTitle: function (t) { form.title = text(t); return this; },
      getTitle: function () { return form.title; },
      setDescription: function (t) { form.description = text(t); return this; },
      getDescription: function () { return form.description; },
      addMultipleChoiceItem: function () { return makeItem(form, "mcq"); },
      addCheckboxItem: function () { return makeItem(form, "checkbox"); },
      addListItem: function () { return makeItem(form, "list"); },
      addTextItem: function () { return makeItem(form, "text"); },
      addParagraphTextItem: function () { return makeItem(form, "paragraph"); },
      addScaleItem: function () { return makeItem(form, "other"); },
      addGridItem: function () { return makeItem(form, "other"); },
      addCheckboxGridItem: function () { return makeItem(form, "other"); },
      addDateItem: function () { return makeItem(form, "other"); },
      addTimeItem: function () { return makeItem(form, "other"); },
      addDurationItem: function () { return makeItem(form, "other"); },
      addImageItem: function () { return makeItem(form, "other"); },
      addVideoItem: function () { return makeItem(form, "other"); },
      addPageBreakItem: function () { return makeSection(form); },
      addSectionHeaderItem: function () { return makeSection(form); },
      getItems: function () { return []; },
      getId: function () { return "MOCK_FORM_ID"; },
      getPublishedUrl: function () { return "https://docs.google.com/forms/d/e/MOCK/viewform"; },
      getEditUrl: function () { return "https://docs.google.com/forms/d/MOCK/edit"; },
      getSummaryUrl: function () { return "https://docs.google.com/forms/d/MOCK/viewanalytics"; },
      getResponses: function () { return []; },
      shortenFormUrl: function (u) { return u; },
    });
    return api;
  }

  // Page breaks name the section that follows; they are not questions.
  function makeSection(form) {
    return chain({
      setTitle: function (t) { form.section = text(t); return this; },
      setHelpText: function () { return this; },
      getTitle: function () { return form.section; },
    });
  }

  var FormApp = chain({
    create: function (title) { return makeForm(title); },
    openById: function () { return makeForm(""); },
    openByUrl: function () { return makeForm(""); },
    getActiveForm: function () { return forms.length ? makeForm("") : makeForm(""); },
    createFeedback: function () {
      var fb = { __text: "" };
      return chain({
        setText: function (t) { fb.__text = text(t); return this; },
        addLink: function () { return this; },
        build: function () { return fb; },
      });
    },
    Alignment: { LEFT: "LEFT", CENTER: "CENTER", RIGHT: "RIGHT" },
    DestinationType: { SPREADSHEET: "SPREADSHEET" },
    ItemType: { CHECKBOX: "CHECKBOX", MULTIPLE_CHOICE: "MULTIPLE_CHOICE", TEXT: "TEXT", PARAGRAPH_TEXT: "PARAGRAPH_TEXT", LIST: "LIST", PAGE_BREAK: "PAGE_BREAK" },
    PageNavigationType: { CONTINUE: "CONTINUE", GO_TO_PAGE: "GO_TO_PAGE", RESTART: "RESTART", SUBMIT: "SUBMIT" },
  });

  // Scripts that build several forms often hand the next one to a time trigger;
  // we queue the handler name and call it ourselves.
  var ScriptApp = chain({
    newTrigger: function (fn) {
      var handler = String(fn);
      return chain({
        timeBased: function () { return this; },
        after: function () { return this; },
        at: function () { return this; },
        everyMinutes: function () { return this; },
        everyHours: function () { return this; },
        everyDays: function () { return this; },
        create: function () {
          scheduled.push(handler);
          return chain({ getHandlerFunction: function () { return handler; }, getUniqueId: function () { return "trigger"; } });
        },
      });
    },
    getProjectTriggers: function () { return []; },
    getScriptTriggers: function () { return []; },
    deleteTrigger: function () { return undefined; },
    getService: function () { return chain({ getUrl: function () { return ""; } }); },
  });

  function propertyStore() {
    var store = {};
    return chain({
      getProperty: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setProperty: function (k, v) { store[k] = text(v); return this; },
      deleteProperty: function (k) { delete store[k]; return this; },
      getProperties: function () { return JSON.parse(JSON.stringify(store)); },
      setProperties: function (o) { for (var k in o) store[k] = text(o[k]); return this; },
      deleteAllProperties: function () { store = {}; return this; },
      getKeys: function () { return Object.keys(store); },
    });
  }
  var scriptProps = propertyStore();
  var PropertiesService = chain({
    getScriptProperties: function () { return scriptProps; },
    getUserProperties: function () { return scriptProps; },
    getDocumentProperties: function () { return scriptProps; },
  });

  var Logger = chain({ log: function () { return this; }, clear: function () { return this; }, getLog: function () { return ""; } });
  var console_ = console;
  var Utilities = chain({
    sleep: function () { return undefined; },
    getUuid: function () { return "00000000-0000-4000-8000-000000000000"; },
    formatDate: function (d) { try { return new Date(d).toISOString(); } catch (e) { return ""; } },
    formatString: function (t) {
      var args = Array.prototype.slice.call(arguments, 1), i = 0;
      return String(t).replace(/%s|%d/g, function () { return text(args[i++]); });
    },
    base64Encode: function (s) { return btoa(text(s)); },
    base64Decode: function (s) { return atob(text(s)); },
  });
  var Session = chain({
    getActiveUser: function () { return chain({ getEmail: function () { return "teacher@example.com"; } }); },
    getEffectiveUser: function () { return chain({ getEmail: function () { return "teacher@example.com"; } }); },
    getScriptTimeZone: function () { return "Asia/Kolkata"; },
  });
  var SpreadsheetApp = chain({});
  var DriveApp = chain({});
  var DocumentApp = chain({});
  var GmailApp = chain({});
  var MailApp = chain({});
  var UrlFetchApp = chain({});
  var CacheService = chain({});
  var LockService = chain({});
  var HtmlService = chain({});
  var CalendarApp = chain({});

  // Names declared in the script: window diffing catches "function foo()" and
  // "var foo =", the regex additionally catches top-level const/let arrows.
  function declaredNames(code, before) {
    var names = [];
    var re = /(?:^|\\n)\\s*(?:function\\s+([A-Za-z_$][\\w$]*)|(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?(?:function|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>))/g;
    var m;
    while ((m = re.exec(code))) names.push(m[1] || m[2]);
    Object.getOwnPropertyNames(window).forEach(function (n) {
      if (!before[n] && names.indexOf(n) === -1) names.push(n);
    });
    return names;
  }

  var SKIP_RE = /^(reset|delete|remove|clear|show|list|print|log|dump|test|help|onOpen|onInstall|onEdit|onFormSubmit|doGet|doPost)/i;
  var MAX_FORMS = 60;

  // Called from inside the script's own eval, so "resolveLocal" can see const/let
  // builders too — those are invisible from anywhere outside that eval.
  function invokeEntryPoints(code, before, resolveLocal) {
    function resolve(name) {
      var fn = resolveLocal(name);
      return typeof fn === "function" ? fn : null;
    }
    var failures = [];
    function call(fn) {
      try { fn(); } catch (e) { failures.push(e && e.message ? e.message : String(e)); }
    }
    function drainTriggers() {
      var guard = 0;
      while (scheduled.length && guard++ < 60 && forms.length < MAX_FORMS) {
        var fn = resolve(scheduled.shift());
        if (fn && fn.length === 0) call(fn);
      }
    }

    declaredNames(code, before).forEach(function (name) {
      if (SKIP_RE.test(name) || forms.length >= MAX_FORMS) return;
      var fn = resolve(name);
      if (!fn || fn.length !== 0) return; // helpers take arguments; entry points do not
      call(fn);
      drainTriggers();
    });
    return failures;
  }

  function run(code) {
    var before = {};
    Object.getOwnPropertyNames(window).forEach(function (n) { before[n] = true; });

    // Expose the mock services as globals for the script being run.
    window.FormApp = FormApp; window.ScriptApp = ScriptApp;
    window.PropertiesService = PropertiesService; window.Logger = Logger;
    window.Utilities = Utilities; window.Session = Session;
    window.SpreadsheetApp = SpreadsheetApp; window.DriveApp = DriveApp;
    window.DocumentApp = DocumentApp; window.GmailApp = GmailApp;
    window.MailApp = MailApp; window.UrlFetchApp = UrlFetchApp;
    window.CacheService = CacheService; window.LockService = LockService;
    window.HtmlService = HtmlService; window.CalendarApp = CalendarApp;
    window.console = console_;

    var failures = [];
    window.__quizzineBoot = function (resolveLocal) {
      failures = invokeEntryPoints(code, before, resolveLocal);
    };
    // The script and the call that drives it share one eval, so every builder it
    // declares — var, function, const or let — is reachable by name.
    var boot = "\\n;window.__quizzineBoot(function (__quizzineName) {" +
      " try { return eval(__quizzineName); } catch (e) { return null; } });";
    try {
      (0, eval)(code + boot);
    } finally {
      delete window.__quizzineBoot;
    }
    return { forms: forms, failures: failures };
  }

  addEventListener("message", function (ev) {
    if (!ev.data || ev.data.type !== "quizzine-run") return;
    try {
      var out = run(String(ev.data.code));
      post({ type: "quizzine-result", forms: out.forms, failures: out.failures });
    } catch (e) {
      post({ type: "quizzine-error", message: e && e.message ? e.message : String(e) });
    }
  });

  post({ type: "quizzine-ready" });
})();
`;

const HARNESS = `<!doctype html><meta charset="utf-8"><script>${SANDBOX_SOURCE}<\/script>`;

/** Run an Apps Script file in the sandbox and return every form it builds. */
export function runAppsScript(code: string, timeoutMs = 15000): Promise<HarvestedForm[]> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("Apps Script files can only be read in the browser."));
      return;
    }
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.display = "none";
    frame.srcdoc = HARNESS;

    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      frame.remove();
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error("The script took too long to run — it may contain an endless loop."))),
      timeoutMs
    );

    function onMessage(ev: MessageEvent) {
      if (ev.source !== frame.contentWindow || !ev.data) return;
      const data = ev.data as { type?: string; forms?: HarvestedForm[]; failures?: string[]; message?: string };
      if (data.type === "quizzine-ready") {
        frame.contentWindow?.postMessage({ type: "quizzine-run", code }, "*");
      } else if (data.type === "quizzine-result") {
        const forms = data.forms ?? [];
        if (!forms.length) {
          const why = data.failures?.length ? ` The script reported: ${data.failures[0]}` : "";
          finish(() => reject(new Error(`No Google Form was built by this script.${why}`)));
        } else {
          finish(() => resolve(forms));
        }
      } else if (data.type === "quizzine-error") {
        finish(() => reject(new Error(data.message || "The script could not be run.")));
      }
    }

    window.addEventListener("message", onMessage);
    document.body.appendChild(frame);
  });
}

function isIdentityField(item: HarvestedItem): boolean {
  if (item.kind !== "text" && item.kind !== "paragraph") return false;
  if (item.points) return false;
  return IDENTITY_RE.test(item.title.trim()) || IDENTITY_SECTION_RE.test(item.section);
}

/** Turn one harvested form into a quiz the rest of the app understands. */
export function formToParsedQuiz(form: HarvestedForm): ParsedQuiz {
  const questions: RawQuestion[] = [];
  const notes: string[] = [];
  let skippedIdentity = 0;
  let ungraded = 0;

  for (const item of form.items) {
    if (item.kind === "other") continue;
    if (isIdentityField(item)) {
      skippedIdentity += 1;
      continue;
    }
    const title = item.title.trim();
    if (!title) continue;

    const question: RawQuestion = {
      text: title,
      passage: item.help.trim() || undefined,
      options: [],
      points: item.points && item.points > 0 ? item.points : undefined,
      feedbackCorrect: item.feedbackCorrect.trim() || undefined,
      feedbackIncorrect: item.feedbackIncorrect.trim() || undefined,
    };

    if (item.kind === "text" || item.kind === "paragraph") {
      question.type = item.kind === "text" ? "short" : "essay";
      if (!item.points) ungraded += 1;
      questions.push(question);
      continue;
    }

    const choices = item.choices.filter((c) => c.text.trim());
    if (choices.length < 2) {
      // A choice question with no usable options is worth flagging, not dropping.
      question.type = "short";
      notes.push(`“${title.slice(0, 60)}…”: no options were found, so it is treated as a typed answer.`);
      questions.push(question);
      continue;
    }
    question.type = "mcq";
    question.options = choices.slice(0, OPTION_KEYS.length).map((c, i) => ({ key: OPTION_KEYS[i], text: c.text.trim() }));
    const correctIdx = choices.findIndex((c) => c.correct);
    if (correctIdx >= 0 && correctIdx < OPTION_KEYS.length) question.correct = OPTION_KEYS[correctIdx];
    const correctCount = choices.filter((c) => c.correct).length;
    if (correctCount > 1) {
      notes.push(`“${title.slice(0, 60)}…” had ${correctCount} correct choices; only the first is graded as correct.`);
    }
    questions.push(question);
  }

  if (skippedIdentity) {
    notes.push(
      `${skippedIdentity} student-information field${skippedIdentity > 1 ? "s were" : " was"} skipped — Quizzine collects name, roll number and semester itself.`
    );
  }
  if (ungraded) {
    notes.push(`${ungraded} typed-answer question${ungraded > 1 ? "s" : ""} carried no points in the Form; each is set to 1 point.`);
  }

  return {
    title: form.title.trim() || undefined,
    description: form.description.trim() || undefined,
    questions,
    notes,
  };
}

/** Same script run twice (an "all forms" function plus per-form ones) yields duplicates. */
function dedupe(forms: HarvestedForm[]): HarvestedForm[] {
  const seen = new Set<string>();
  const out: HarvestedForm[] = [];
  for (const form of forms) {
    const key = `${form.title}::${form.items.length}::${form.items.find((i) => i.title)?.title ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(form);
  }
  return out;
}

/** Harvested forms → publishable quizzes, duplicates and empty forms dropped. */
export function formsToQuizzes(forms: HarvestedForm[]): ParsedQuiz[] {
  return dedupe(forms)
    .map(formToParsedQuiz)
    .filter((quiz) => quiz.questions.length > 0);
}

/** Read an Apps Script file into one quiz per Google Form it builds. */
export async function parseAppsScript(code: string): Promise<ParsedQuiz[]> {
  const quizzes = formsToQuizzes(await runAppsScript(stripCodeFences(code)));
  if (!quizzes.length) {
    throw new Error("The script ran, but no questions were found in the forms it builds.");
  }
  return quizzes;
}
