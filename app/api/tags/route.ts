/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentTeacher } from "@/lib/auth";
import { TAG_PRESETS, applyTagMerges, findPreset, normalizeTags, parseTag, tagVariants } from "@/lib/tags";
import type { Question } from "@/lib/types";

/**
 * A teacher's whole tag vocabulary, with the near-duplicates that would
 * otherwise split one topic into two half-sized buckets nobody can draw a
 * conclusion from. Merging is confirmed by the teacher, never automatic.
 */
export async function GET() {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await q<{ id: string; title: string; questions: Question[]; preset: string | null }>(
    `SELECT id, title, questions, preset FROM quizzes WHERE owner = $1 ORDER BY created_at DESC`,
    [owner]
  );

  const counts: Record<string, number> = {};
  const quizzesFor: Record<string, string[]> = {};
  let untagged = 0;
  let total = 0;
  for (const z of rows) {
    for (const qn of z.questions ?? []) {
      total += 1;
      const tags = qn.tags ?? [];
      if (!tags.length) untagged += 1;
      for (const tag of tags) {
        counts[tag] = (counts[tag] ?? 0) + 1;
        if (!quizzesFor[tag]?.includes(z.title)) {
          quizzesFor[tag] = [...(quizzesFor[tag] ?? []), z.title];
        }
      }
    }
  }

  return NextResponse.json({
    counts,
    quizzesFor,
    untagged,
    total,
    variants: tagVariants(counts),
    presets: TAG_PRESETS,
    // The preset most of this teacher's quizzes were written against.
    preset: rows.find((z) => z.preset)?.preset ?? null,
  });
}

/**
 * Apply confirmed tag work across every quiz the teacher owns: merges of
 * variant spellings, and direct edits to one quiz's tags.
 *
 * Only the `tags` and `difficulty` fields of a question are ever written here.
 * Question text, options and answer keys are untouchable through this route, so
 * tagging can never disturb a mark that has already been awarded, which is what
 * makes it safe to tag a quiz students have already sat.
 */
export async function POST(req: NextRequest) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  if (body.merges && typeof body.merges === "object") {
    const merges: Record<string, string> = {};
    for (const [from, to] of Object.entries(body.merges as Record<string, unknown>)) {
      const target = normalizeTags(String(to))[0];
      const source = parseTag(String(from));
      // Identical spellings are nothing to do; a merge with no valid target is
      // meaningless. Both are dropped rather than half-applied. The comparison
      // is on the exact text, not the bucket key — "victorian" and "Victorian"
      // already count as one topic, but the teacher is still owed the tidy-up,
      // and refusing it would leave the same suggestion coming back for ever.
      if (!target || !source || String(from) === target) continue;
      merges[from] = target;
    }
    if (!Object.keys(merges).length) {
      return NextResponse.json({ error: "Nothing to merge." }, { status: 400 });
    }

    const rows = await q<{ id: string; questions: Question[] }>(
      `SELECT id, questions FROM quizzes WHERE owner = $1`,
      [owner]
    );
    let changed = 0;
    for (const z of rows) {
      let touched = false;
      const questions = (z.questions ?? []).map((qn) => {
        if (!qn.tags?.length) return qn;
        const tags = applyTagMerges(qn.tags, merges);
        if (tags.join(" ") === qn.tags.join(" ")) return qn;
        touched = true;
        changed += 1;
        return { ...qn, tags };
      });
      if (touched) {
        await q(`UPDATE quizzes SET questions = $1 WHERE id = $2`, [JSON.stringify(questions), z.id]);
      }
    }
    return NextResponse.json({ ok: true, changed });
  }

  if (typeof body.quizId === "string" && body.tags && typeof body.tags === "object") {
    const rows = await q<{ id: string; questions: Question[] }>(
      `SELECT id, questions FROM quizzes WHERE id = $1 AND owner = $2`,
      [body.quizId, owner]
    );
    if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const incoming = body.tags as Record<string, { tags?: unknown; difficulty?: unknown }>;
    const questions = (rows[0].questions ?? []).map((qn) => {
      const update = incoming[qn.id];
      if (!update) return qn;
      const next = { ...qn };
      if (update.tags !== undefined) {
        const tags = normalizeTags(update.tags);
        next.tags = tags.length ? tags : undefined;
      }
      if (update.difficulty !== undefined) {
        const level = Number(update.difficulty);
        next.difficulty = Number.isFinite(level) && level >= 1 && level <= 5 ? Math.round(level) : undefined;
      }
      return next;
    });

    const preset = body.preset !== undefined ? (findPreset(body.preset)?.id ?? null) : undefined;
    if (preset === undefined) {
      await q(`UPDATE quizzes SET questions = $1 WHERE id = $2`, [JSON.stringify(questions), body.quizId]);
    } else {
      await q(`UPDATE quizzes SET questions = $1, preset = $2 WHERE id = $3`, [
        JSON.stringify(questions),
        preset,
        body.quizId,
      ]);
    }
    return NextResponse.json({ ok: true, questions });
  }

  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}
