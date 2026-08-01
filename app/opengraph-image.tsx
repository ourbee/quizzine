/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

// The card for the app itself. Individual quizzes override this with their own
// (see app/q/[slug]/opengraph-image.tsx).

import { ImageResponse } from "next/og";
import { markDataUri, MARK_SVG_PLAIN } from "@/lib/logo";

export const alt = "Quizzine — quizzes your students can take from any device";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={markDataUri(MARK_SVG_PLAIN)} width={72} height={72} alt="" />
          <div style={{ display: "flex", fontSize: 46, letterSpacing: -1 }}>Quizzine</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 74, lineHeight: 1.1, letterSpacing: -2 }}>
            Set it, share it, and let the marking look after itself.
          </div>
          <div style={{ display: "flex", fontSize: 32, color: "#dbeafe" }}>
            Quizzes, surveys, group work and peer review — one link, any device.
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#c7d2fe" }}>quizzine.vercel.app</div>
      </div>
    ),
    size,
  );
}
