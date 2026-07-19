import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, defaultOwner, passcode, sessionValue } from "@/lib/auth";

function withSession(email: string) {
  const res = NextResponse.json({ ok: true, email });
  res.cookies.set(COOKIE_NAME, sessionValue(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  // Google Identity Services sign-in: verify the ID token with Google.
  if (typeof body.credential === "string") {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ error: "Google sign-in is not configured." }, { status: 400 });
    }
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(body.credential)}`
    );
    if (!res.ok) return NextResponse.json({ error: "Google sign-in failed." }, { status: 401 });
    const info = await res.json();
    if (info.aud !== clientId || info.email_verified !== "true" || typeof info.email !== "string") {
      return NextResponse.json({ error: "Google sign-in failed." }, { status: 401 });
    }
    return withSession(info.email);
  }

  // Passcode fallback (local dev / owner without Google configured).
  if (typeof body.passcode === "string") {
    if (body.passcode !== passcode()) {
      return NextResponse.json({ error: "Wrong passcode." }, { status: 401 });
    }
    return withSession(defaultOwner());
  }

  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
