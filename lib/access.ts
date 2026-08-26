/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * Who may sign in, and how much they may create.
 *
 * A deployment of this app is one Postgres database and one owner paying for
 * it. Google sign-in on its own proves only that somebody has a Gmail account,
 * so an invitation is what actually grants access: without one, a stranger who
 * finds the address can neither create quizzes in that database nor collect
 * students' names and marks in it. Setting OPEN_SIGNUP deliberately opts out.
 */

import { q } from "./db.ts";
import { defaultOwner } from "./owner.ts";

/** Questions one teacher may publish in a rolling day, across all their quizzes. */
export const DEFAULT_QUESTION_QUOTA = 100;

export const questionQuota = (): number => {
  const raw = Number(process.env.QUESTION_QUOTA_PER_DAY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_QUESTION_QUOTA;
};

const openSignup = (): boolean => /^(1|true|yes|on)$/i.test(process.env.OPEN_SIGNUP ?? "");

/** Emails allowed in without an invitation row: the owner, plus any listed in the env. */
function envAllowed(): string[] {
  const list = (process.env.TEACHER_EMAILS ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [defaultOwner(), ...list];
}

export const isOwner = (email: string): boolean => email.toLowerCase() === defaultOwner();

/**
 * Whether this email may hold an account here. Recorded as seen when it may, so
 * the owner's invitation list shows who has actually turned up.
 */
export async function isInvited(email: string): Promise<boolean> {
  const normalized = email.toLowerCase();
  if (envAllowed().includes(normalized)) return true;
  if (openSignup()) return true;
  const rows = await q<{ email: string }>(`SELECT email FROM teacher_invites WHERE email = $1`, [normalized]);
  if (!rows.length) return false;
  await q(`UPDATE teacher_invites SET last_seen_at = now() WHERE email = $1`, [normalized]);
  return true;
}

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
}

/**
 * Questions this teacher has published in the last 24 hours. Counted from the
 * quizzes themselves rather than a usage table, so it can never drift out of
 * step with what is actually stored — and deleting a quiz genuinely gives the
 * allowance back.
 */
export async function questionUsage(owner: string): Promise<QuotaState> {
  const rows = await q<{ used: string | number | null }>(
    `SELECT COALESCE(SUM(jsonb_array_length(questions)), 0) AS used
       FROM quizzes
      WHERE owner = $1 AND created_at > now() - interval '24 hours'`,
    [owner]
  );
  const used = Number(rows[0]?.used ?? 0);
  const limit = questionQuota();
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/** The owner of the deployment is not rationed against their own database. */
export async function checkQuota(owner: string, adding: number): Promise<QuotaState & { ok: boolean }> {
  if (isOwner(owner)) {
    const limit = questionQuota();
    return { used: 0, limit, remaining: limit, ok: true };
  }
  const state = await questionUsage(owner);
  return { ...state, ok: state.used + adding <= state.limit };
}
