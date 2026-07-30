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
CREATE INDEX IF NOT EXISTS peer_reviews_quiz_idx ON peer_reviews(quiz_id);
CREATE INDEX IF NOT EXISTS peer_reviews_reviewer_idx ON peer_reviews(reviewer_attempt_id);
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
  ready ??= init();
  return ready.then((fn) => fn(text, params)) as Promise<T[]>;
}
