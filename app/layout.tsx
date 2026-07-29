import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Quizzine",
  description:
    "Upload an AI-generated question file, get a beautiful auto-graded quiz your students can take from any device.",
};

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
          Created by{" "}
          <a
            href="https://github.com/ourbee"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-2 hover:text-slate-800"
          >
            Ritwik Balo
          </a>
        </footer>
      </body>
    </html>
  );
}
