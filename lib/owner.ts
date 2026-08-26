/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * Who owns this deployment — the one account that is never rationed and never
 * needs an invitation, and the owner quizzes fall back to from before teacher
 * accounts existed.
 *
 * It lives alone in this file, with no imports, because both the session code
 * and the access rules need it and the session code cannot be loaded outside a
 * request. One definition, so the two can never disagree about who the owner is.
 */
export function defaultOwner(): string {
  return (process.env.DEFAULT_OWNER_EMAIL || "ritwik.jude@gmail.com").toLowerCase();
}
