import type { ReactNode } from "react";

export type IllustrationName = "empty" | "search" | "error" | "offline" | "done" | "locked" | "calendar" | "upload";

// One consistent set: 2px rounded strokes in a neutral ink, soft neutral fills and a single brand
// accent. Colours come from tokens, so dark mode and the tenant's brand apply automatically.
const ink = "var(--wd-illustration-ink)";
const soft = "var(--wd-illustration-fill)";
const paper = "var(--wd-illustration-paper)";
const accent = "var(--wd-illustration-accent)";
const line = { stroke: ink, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

const art: Record<IllustrationName, ReactNode> = {
  empty: <>
    <ellipse cx="60" cy="84" rx="38" ry="5" fill={soft} />
    <rect x="30" y="22" width="60" height="44" rx="8" {...line} fill={paper} />
    <path d="M30 50h16l5 8h18l5-8h16" {...line} />
    <path d="M44 34h32M44 42h20" {...line} stroke={soft} strokeWidth={4} />
    <circle cx="92" cy="20" r="6" fill={accent} />
  </>,
  search: <>
    <ellipse cx="60" cy="84" rx="38" ry="5" fill={soft} />
    <rect x="22" y="18" width="52" height="58" rx="8" {...line} fill={paper} />
    <path d="M32 32h32M32 42h24M32 52h28" {...line} stroke={soft} strokeWidth={4} />
    <circle cx="76" cy="52" r="14" {...line} fill={paper} />
    <path d="M86 62l12 12" {...line} strokeWidth={4} stroke={accent} />
  </>,
  error: <>
    <ellipse cx="60" cy="84" rx="38" ry="5" fill={soft} />
    <rect x="26" y="20" width="68" height="52" rx="8" {...line} fill={paper} />
    <path d="M26 32h68" {...line} />
    <circle cx="34" cy="26" r="1.5" fill={ink} /><circle cx="40" cy="26" r="1.5" fill={ink} />
    <path d="M60 42v12" {...line} stroke={accent} strokeWidth={3} />
    <circle cx="60" cy="61" r="2" fill={accent} />
  </>,
  offline: <>
    <ellipse cx="60" cy="84" rx="38" ry="5" fill={soft} />
    <path d="M38 66h46a14 14 0 0 0 0-28 20 20 0 0 0-38-4 16 16 0 0 0-8 32z" {...line} fill={paper} />
    <path d="M40 26l44 48" {...line} stroke={accent} strokeWidth={3} />
  </>,
  done: <>
    <ellipse cx="60" cy="84" rx="38" ry="5" fill={soft} />
    <circle cx="60" cy="46" r="24" {...line} fill={paper} />
    <path d="M49 46l8 8 15-16" {...line} stroke={accent} strokeWidth={3} />
    <path d="M26 24l4 4M94 22l-4 4M98 54h-5M22 56h5" {...line} />
  </>,
  locked: <>
    <ellipse cx="60" cy="84" rx="38" ry="5" fill={soft} />
    <path d="M46 40v-8a14 14 0 0 1 28 0v8" {...line} />
    <rect x="38" y="40" width="44" height="34" rx="8" {...line} fill={paper} />
    <circle cx="60" cy="55" r="4" fill={accent} />
    <path d="M60 59v6" {...line} stroke={accent} strokeWidth={3} />
  </>,
  calendar: <>
    <ellipse cx="60" cy="84" rx="38" ry="5" fill={soft} />
    <rect x="28" y="22" width="64" height="54" rx="8" {...line} fill={paper} />
    <path d="M28 36h64M44 16v12M76 16v12" {...line} />
    <path d="M40 48h8M56 48h8M72 48h8M40 60h8M56 60h8" {...line} stroke={soft} strokeWidth={4} />
    <rect x="70" y="56" width="12" height="8" rx="2" fill={accent} />
  </>,
  upload: <>
    <ellipse cx="60" cy="84" rx="38" ry="5" fill={soft} />
    <rect x="28" y="22" width="64" height="54" rx="10" {...line} fill={paper} strokeDasharray="4 5" />
    <path d="M60 60V36M50 46l10-10 10 10" {...line} stroke={accent} strokeWidth={3} />
  </>,
};

/** Decorative state illustration; the text beside it carries the meaning. */
export function Illustration({ name, size = 120 }: { name: IllustrationName; size?: number }) {
  return <svg aria-hidden="true" className="wd-illustration" focusable="false" height={(size * 96) / 120} viewBox="0 0 120 96" width={size}>{art[name]}</svg>;
}
