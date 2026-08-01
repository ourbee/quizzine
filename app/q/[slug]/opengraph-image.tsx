/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

// The picture on the link preview: the quiz's own title and facts, painted in
// the theme the teacher chose for it.

import { ImageResponse } from "next/og";
import { getTheme } from "@/lib/themes";
import { markDataUri } from "@/lib/logo";
import { shareFacts, shareQuiz } from "@/lib/share";

export const alt = "Quizzine quiz";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic"; // the title comes from the database

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const quiz = await shareQuiz(slug).catch(() => null);
  const theme = getTheme(quiz?.theme ?? "slate");
  const full = quiz?.title ?? "Quiz not found";
  // Long titles shrink, and a title longer than the card can hold is cut.
  const title = full.length > 140 ? `${full.slice(0, 139).trimEnd()}…` : full;
  const facts = quiz ? shareFacts(quiz) : [];
  const titleSize = title.length > 90 ? 54 : title.length > 50 ? 66 : 80;
  const closed = quiz ? !quiz.open : false;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: theme.bg,
          color: theme.text,
          padding: "64px 72px",
          borderTop: `18px solid ${theme.accent}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={markDataUri()} width={56} height={56} alt="" />
          <div style={{ display: "flex", fontSize: 34, color: theme.text, letterSpacing: -0.5 }}>Quizzine</div>
          {closed && (
            <div
              style={{
                display: "flex",
                marginLeft: 16,
                padding: "6px 18px",
                borderRadius: 999,
                background: theme.accentSoft,
                color: theme.accent,
                fontSize: 24,
              }}
            >
              {quiz?.phase === "reviewing" ? "Peer review under way" : "Closed"}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              display: "flex",
              fontSize: titleSize,
              lineHeight: 1.12,
              letterSpacing: -1.5,
              maxHeight: 300,
              overflow: "hidden",
            }}
          >
            {title}
          </div>
          {facts.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
              {facts.map((fact) => (
                <div
                  key={fact}
                  style={{
                    display: "flex",
                    padding: "10px 24px",
                    borderRadius: 999,
                    background: theme.accentSoft,
                    color: theme.accent,
                    border: `1px solid ${theme.border}`,
                    fontSize: 30,
                  }}
                >
                  {fact}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", fontSize: 27, color: theme.muted }}>
          {!quiz || quiz.open
            ? "Open the link and answer on any device — no account needed"
            : quiz.phase === "reviewing"
              ? "Responses are closed — classmates are marking them now"
              : "This link is no longer taking responses"}
        </div>
      </div>
    ),
    size,
  );
}
