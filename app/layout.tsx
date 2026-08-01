/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Absolute URLs for link previews. Set NEXT_PUBLIC_SITE_URL if the app ever
// moves; the per-deployment Vercel URL is not usable here because it sits
// behind deployment protection, where crawlers meet a login wall.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://quizzine.vercel.app";

const TAGLINE =
  "Turn your questions into a quiz students take from one link — marked for you, with reports, group work and peer review.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // A shared quiz sets its own title (see app/q/[slug]/layout.tsx); everything
  // else in the app is named after it.
  title: { default: "Quizzine", template: "%s · Quizzine" },
  description: TAGLINE,
  applicationName: "Quizzine",
  openGraph: {
    type: "website",
    siteName: "Quizzine",
    title: "Quizzine",
    description: TAGLINE,
    url: "/",
  },
  twitter: { card: "summary_large_image", title: "Quizzine", description: TAGLINE },
};

export const viewport: Viewport = { themeColor: "#2563eb" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="flex-1 flex flex-col">{children}</div>
        <footer className="no-print text-center text-xs text-slate-500 py-4 border-t border-slate-200 bg-white/70">
          <p>
            Created by{" "}
            <a
              href="https://github.com/ourbee"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2 hover:text-slate-800"
            >
              Ritwik Balo
            </a>
          </p>
          <p className="mt-0.5 text-slate-400">
            © 2026 Ritwik Balo. All rights reserved.
          </p>
        </footer>
      </body>
    </html>
  );
}
