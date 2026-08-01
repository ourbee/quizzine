/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

// A shared quiz link should announce the quiz, not the app: the title of the
// paper, what it holds, and a card image built from the quiz's own theme.

import type { Metadata } from "next";
import { shareDescription, shareQuiz } from "@/lib/share";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const quiz = await shareQuiz(slug).catch(() => null);
  if (!quiz) {
    return {
      title: "Quiz not found",
      description: "This quiz link is no longer valid. Ask your teacher for the current one.",
    };
  }
  const description = shareDescription(quiz);
  return {
    title: quiz.title,
    description,
    openGraph: {
      type: "website",
      siteName: "Quizzine",
      title: quiz.title,
      description,
      url: `/q/${slug}`,
    },
    twitter: { card: "summary_large_image", title: quiz.title, description },
    robots: { index: false, follow: false }, // a quiz is for whoever holds the link
  };
}

export default function QuizLayout({ children }: { children: React.ReactNode }) {
  return children;
}
