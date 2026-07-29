/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

export interface Theme {
  id: string;
  name: string;
  bg: string; // page background
  card: string; // card background
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string; // accent-tinted background
  accentText: string; // text on accent
}

export const THEMES: Theme[] = [
  { id: "slate", name: "Slate", bg: "#f1f5f9", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b", accent: "#334155", accentSoft: "#e2e8f0", accentText: "#ffffff" },
  { id: "ocean", name: "Ocean", bg: "#eff6ff", card: "#ffffff", border: "#bfdbfe", text: "#172554", muted: "#3b82f6", accent: "#1d4ed8", accentSoft: "#dbeafe", accentText: "#ffffff" },
  { id: "forest", name: "Forest", bg: "#f0fdf4", card: "#ffffff", border: "#bbf7d0", text: "#14532d", muted: "#16a34a", accent: "#15803d", accentSoft: "#dcfce7", accentText: "#ffffff" },
  { id: "sunset", name: "Sunset", bg: "#fff7ed", card: "#ffffff", border: "#fed7aa", text: "#7c2d12", muted: "#ea580c", accent: "#c2410c", accentSoft: "#ffedd5", accentText: "#ffffff" },
  { id: "grape", name: "Grape", bg: "#faf5ff", card: "#ffffff", border: "#e9d5ff", text: "#3b0764", muted: "#9333ea", accent: "#7e22ce", accentSoft: "#f3e8ff", accentText: "#ffffff" },
  { id: "night", name: "Night", bg: "#0f172a", card: "#1e293b", border: "#334155", text: "#f1f5f9", muted: "#94a3b8", accent: "#38bdf8", accentSoft: "#0c4a6e", accentText: "#0f172a" },
];

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
