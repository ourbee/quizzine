/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentTeacher } from "@/lib/auth";
import { normRoll } from "@/lib/normalize";
import { canonicalRoll, type AliasMap } from "@/lib/report";

/**
 * The teacher's roll-number merges. A student who writes their class roll on one
 * test and their university roll on the next would otherwise appear twice in a
 * semester report, each row holding half their work; confirming a merge here
 * joins them from then on. Attempts are never rewritten — undoing a merge puts
 * both rolls straight back.
 */

const readAliases = async (owner: string): Promise<AliasMap> => {
  const rows = await q<{ variant_roll: string; canonical_roll: string }>(
    `SELECT variant_roll, canonical_roll FROM roll_aliases WHERE owner = $1`,
    [owner]
  );
  return Object.fromEntries(rows.map((r) => [r.variant_roll, r.canonical_roll]));
};

export async function GET() {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ aliases: await readAliases(owner) });
}

export async function POST(req: NextRequest) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const merge = normRoll(String(body?.merge ?? ""));
  const keep = normRoll(String(body?.keep ?? ""));
  if (!merge || !keep) return NextResponse.json({ error: "Give both roll numbers." }, { status: 400 });
  if (merge === keep) return NextResponse.json({ error: "That is the same roll number." }, { status: 400 });

  // Merging into a roll that is itself merged elsewhere would build a chain the
  // reports have to walk; point it straight at the roll that actually survives.
  const aliases = await readAliases(owner);
  const target = canonicalRoll(keep, aliases);
  if (target === merge) {
    return NextResponse.json({ error: "Those two are already merged, the other way round." }, { status: 400 });
  }

  await q(
    `INSERT INTO roll_aliases (owner, variant_roll, canonical_roll) VALUES ($1, $2, $3)
     ON CONFLICT (owner, variant_roll) DO UPDATE SET canonical_roll = EXCLUDED.canonical_roll`,
    [owner, merge, target]
  );
  // Anything that pointed at the roll just merged away now points where it went.
  await q(`UPDATE roll_aliases SET canonical_roll = $1 WHERE owner = $2 AND canonical_roll = $3`, [
    target,
    owner,
    merge,
  ]);

  return NextResponse.json({ aliases: await readAliases(owner) });
}

export async function DELETE(req: NextRequest) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const variant = normRoll(req.nextUrl.searchParams.get("variant") ?? "");
  if (!variant) return NextResponse.json({ error: "Missing roll number" }, { status: 400 });
  await q(`DELETE FROM roll_aliases WHERE owner = $1 AND variant_roll = $2`, [owner, variant]);
  return NextResponse.json({ aliases: await readAliases(owner) });
}
