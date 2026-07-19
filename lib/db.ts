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
`;

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
    return async (text, params) => (await pool.query(text, params as never[])).rows;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { mkdirSync } = await import("fs");
  mkdirSync(".data/quizdeck", { recursive: true });
  const db = new PGlite(".data/quizdeck");
  await db.exec(SCHEMA);
  return async (text, params) => (await db.query(text, params as never[])).rows as Row[];
}

export function q<T = Row>(text: string, params?: unknown[]): Promise<T[]> {
  ready ??= init();
  return ready.then((fn) => fn(text, params)) as Promise<T[]>;
}
