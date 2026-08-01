/*
 * Copyright © 2026 Ritwik Balo. All rights reserved.
 * https://github.com/ourbee
 */

/**
 * The Quizzine mark: a Q whose tail is drawn as a tick — a question that has
 * been marked. The same geometry is repeated in `app/icon.svg`, the generated
 * PNG icons and the Open Graph cards, so change all of them together.
 */
export function LogoMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="quizzine-mark" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563eb" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#quizzine-mark)" />
      <circle cx="25" cy="30" r="12.5" stroke="#ffffff" strokeWidth="6" />
      <path
        d="M33 38 L38.5 46.5 L51 27.5"
        stroke="#ffffff"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mark plus wordmark, for page headers. */
export default function Logo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      <span className="font-bold tracking-tight text-slate-900" style={{ fontSize: size * 0.62 }}>
        Quizzine
      </span>
    </span>
  );
}
