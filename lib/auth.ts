import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const COOKIE_NAME = "qd_teacher";

function secret(): string {
  return process.env.AUTH_SECRET || `quizdeck:${process.env.TEACHER_PASSCODE || "quizdeck"}`;
}

/** Owner assigned to passcode sign-ins and to quizzes created before accounts existed. */
export function defaultOwner(): string {
  return (process.env.DEFAULT_OWNER_EMAIL || "ritwik.jude@gmail.com").toLowerCase();
}

export function passcode(): string {
  return process.env.TEACHER_PASSCODE || "quizdeck";
}

export function sessionValue(email: string): string {
  const payload = Buffer.from(email.toLowerCase(), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(value?: string): string | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expect = createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/** Signed-in teacher's email, or null. */
export async function currentTeacher(): Promise<string | null> {
  const store = await cookies();
  return verifySession(store.get(COOKIE_NAME)?.value);
}
