import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentTeacher } from "@/lib/auth";
import { genId } from "@/lib/normalize";
import { normalizeBands, type Band } from "@/lib/report";

interface SchemeRow {
  id: string;
  name: string;
  bands: Band[];
  is_default: boolean;
}

export async function GET() {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await q<SchemeRow>(
    `SELECT id, name, bands, is_default FROM band_schemes WHERE owner = $1 ORDER BY created_at ASC`,
    [owner]
  );
  return NextResponse.json({
    schemes: rows.map((r) => ({
      id: r.id,
      name: r.name,
      bands: normalizeBands(r.bands),
      isDefault: r.is_default,
    })),
  });
}

/** Creates a scheme, or overwrites one when an existing id is passed. */
export async function POST(req: NextRequest) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return NextResponse.json({ error: "Give the band scheme a name." }, { status: 400 });
  if (!Array.isArray(body?.bands) || body.bands.length < 2) {
    return NextResponse.json({ error: "A scheme needs at least two bands." }, { status: 400 });
  }
  const bands = normalizeBands(body.bands as Band[]);
  if (bands.length < 2) {
    return NextResponse.json({ error: "Bands need distinct cut-off percentages." }, { status: 400 });
  }
  const makeDefault = !!body.isDefault;

  let id: string = typeof body.id === "string" ? body.id : "";
  if (id) {
    const owned = await q(`SELECT id FROM band_schemes WHERE id = $1 AND owner = $2`, [id, owner]);
    if (!owned.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await q(`UPDATE band_schemes SET name = $1, bands = $2, is_default = $3 WHERE id = $4`, [
      name,
      JSON.stringify(bands),
      makeDefault,
      id,
    ]);
  } else {
    id = genId();
    await q(
      `INSERT INTO band_schemes (id, owner, name, bands, is_default) VALUES ($1, $2, $3, $4, $5)`,
      [id, owner, name, JSON.stringify(bands), makeDefault]
    );
  }
  if (makeDefault) {
    await q(`UPDATE band_schemes SET is_default = false WHERE owner = $1 AND id <> $2`, [owner, id]);
  }
  return NextResponse.json({ id, name, bands, isDefault: makeDefault });
}

export async function DELETE(req: NextRequest) {
  const owner = await currentTeacher();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await q(`DELETE FROM band_schemes WHERE id = $1 AND owner = $2`, [id, owner]);
  return NextResponse.json({ ok: true });
}
