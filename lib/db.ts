/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

// Query helper that runs on Neon Postgres in production (DATABASE_URL set)
// and on an embedded PGlite database for local development (no setup needed).

type Row = Record<string, unknown>;
type QueryFn = (text: string, params?: unknown[]) => Promise<Row[]>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS quizzes (
  id text PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  description text,
  intro_media text,
  questions jsonb NOT NULL,
  settings jsonb NOT NULL,
  theme text NOT NULL DEFAULT 'slate',
  accepting boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS attempts (
  id text PRIMARY KEY,
  quiz_id text NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student jsonb NOT NULL,
  group_info jsonb,
  answers jsonb,
  per_question jsonb,
  score real,
  max_score real,
  flags jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'in_progress',
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);
CREATE INDEX IF NOT EXISTS attempts_quiz_idx ON attempts(quiz_id);
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS owner text;
CREATE TABLE IF NOT EXISTS band_schemes (
  id text PRIMARY KEY,
  owner text NOT NULL,
  name text NOT NULL,
  bands jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS band_schemes_owner_idx ON band_schemes(owner);

-- Peer review: a quiz moves responding -> reviewing -> closed.
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'responding';
-- The mark the teacher set by hand, which beats the peer average when present.
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS teacher_score real;
CREATE TABLE IF NOT EXISTS peer_reviews (
  id text PRIMARY KEY,
  quiz_id text NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  attempt_id text NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  reviewer_attempt_id text NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  scores jsonb,
  comments jsonb,
  status text NOT NULL DEFAULT 'assigned',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS peer_reviews_pair_idx ON peer_reviews(attempt_id, reviewer_attempt_id);

-- One student, two roll numbers: a teacher confirms that a variant belongs to a
-- canonical roll, and every later report treats them as one person. The attempts
-- keep whatever was typed — only the reporting is merged.
CREATE TABLE IF NOT EXISTS roll_aliases (
  owner text NOT NULL,
  variant_roll text NOT NULL,
  canonical_roll text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, variant_roll)
);
CREATE INDEX IF NOT EXISTS peer_reviews_quiz_idx ON peer_reviews(quiz_id);
CREATE INDEX IF NOT EXISTS peer_reviews_reviewer_idx ON peer_reviews(reviewer_attempt_id);

-- The tag vocabulary a quiz was written against, so uploads can be checked
-- against it and the report can order dimensions the way the preset does.
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS preset text;

-- Where an adaptive paper has got to: the questions served stage by stage and
-- how each finished stage went. Null for every ordinary quiz.
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS mst jsonb;

-- Who may sign in. An empty table means only the default owner, which is the
-- safe way round: a deployment nobody has been invited to is a deployment only
-- its owner can fill with quizzes.
-- Rubric marking: what each reviewer (the teacher, and the AI pass the teacher
-- pasted back) said about each written answer. Percentages, never only the
-- derived mark — see lib/marking.ts.
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS marking jsonb;
-- How a written answer was typed: counts only, never content. See lib/telemetry.ts.
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS telemetry jsonb;

-- Handing a quiz to a colleague. The recipient gets their OWN copy: a new id, a
-- new link, a new response pool. Nothing is shared afterwards — a copy is a
-- gift, not a subscription — which is what keeps one teacher's students off
-- another teacher's dashboard. The copy remembers where it came from, and the
-- sender keeps a record of having sent it even if the copy is later deleted.
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS shared_from text;
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS shared_by text;
CREATE TABLE IF NOT EXISTS quiz_shares (
  id text PRIMARY KEY,
  source_quiz_id text NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  -- Deliberately not a foreign key: the record of the gift outlives the copy.
  copy_quiz_id text NOT NULL,
  shared_by text NOT NULL,
  shared_with text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quiz_shares_source_idx ON quiz_shares(source_quiz_id);

-- Allotted tests: the roster and the roll → question map. Teacher-private, so
-- its own column, never a settings field — settings partially reach students.
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS allotment jsonb;
-- Which questions this attempt was dealt (like mst: the server deals, the
-- student only ever receives their share). Null for every ordinary quiz.
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS allotted jsonb;

CREATE TABLE IF NOT EXISTS teacher_invites (
  email text PRIMARY KEY,
  invited_by text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);
`;

// Quizzes created before teacher accounts existed get assigned to this owner.
const BACKFILL_OWNER = "UPDATE quizzes SET owner = $1 WHERE owner IS NULL";
const backfillOwner = () =>
  (process.env.DEFAULT_OWNER_EMAIL || "ritwik.jude@gmail.com").toLowerCase();

let ready: Promise<QueryFn> | null = null;

async function init(): Promise<QueryFn> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: url,
      max: 3,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
    });
    await pool.query(SCHEMA);
    await pool.query(BACKFILL_OWNER, [backfillOwner()]);
    return async (text, params) => (await pool.query(text, params as never[])).rows;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { mkdirSync } = await import("fs");
  mkdirSync(".data/quizzine", { recursive: true });
  const db = new PGlite(".data/quizzine");
  await db.exec(SCHEMA);
  await db.query(BACKFILL_OWNER, [backfillOwner()]);
  return async (text, params) => (await db.query(text, params as never[])).rows as Row[];
}

export function q<T = Row>(text: string, params?: unknown[]): Promise<T[]> {
  // A failed connection must not be cached: holding on to the rejected promise
  // would leave every later query failing until the process was restarted, so a
  // database that comes back up would never be noticed.
  ready ??= init().catch((err) => {
    ready = null;
    throw err;
  });
  return ready.then((fn) => fn(text, params)) as Promise<T[]>;
}
