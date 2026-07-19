import { createHash } from "crypto";
import { cookies } from "next/headers";

export const COOKIE_NAME = "qd_teacher";

export function passcode(): string {
  return process.env.TEACHER_PASSCODE || "quizdeck";
}

export function teacherToken(): string {
  return createHash("sha256").update(`quizdeck-teacher:${passcode()}`).digest("hex");
}

export async function isTeacher(): Promise<boolean> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value === teacherToken();
}
