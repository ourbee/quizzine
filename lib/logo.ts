/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * The mark as a data URI, for places that can only take an image source —
 * chiefly the Open Graph cards, which are rendered by satori. Keep the geometry
 * in step with `components/Logo.tsx` and `app/icon.svg`.
 */
export const MARK_SVG = `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop stop-color="#2563eb"/><stop offset="1" stop-color="#4f46e5"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#g)"/><circle cx="25" cy="30" r="12.5" stroke="#ffffff" stroke-width="6"/><path d="M33 38 L38.5 46.5 L51 27.5" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** White-on-transparent variant, for dark or accent-coloured backgrounds. */
export const MARK_SVG_PLAIN = `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="25" cy="30" r="12.5" stroke="#ffffff" stroke-width="6"/><path d="M33 38 L38.5 46.5 L51 27.5" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function markDataUri(svg: string = MARK_SVG): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
