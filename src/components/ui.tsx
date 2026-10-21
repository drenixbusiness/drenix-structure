"use client";

import { fmtDelta, fmtSigned } from "@/lib/org";
import { useTweenedNumber } from "@/lib/hooks";

export function Num({ value }: { value: number }) {
  const v = useTweenedNumber(value);
  return <span className="num">{v}</span>;
}

/** ▲ 2 / ▼ 1 pill. `k` re-triggers the pop animation on change. */
export function DeltaPill({ delta, k }: { delta: number; k?: string | number }) {
  if (!delta) return null;
  return (
    <span key={k} className={`pill pill-pop ${delta > 0 ? "up" : "down"}`} aria-label={`${delta > 0 ? "up" : "down"} ${Math.abs(delta)}`}>
      {fmtDelta(delta)}
    </span>
  );
}

export function DeltaSmall({ delta }: { delta: number }) {
  if (!delta) return null;
  return <span className={`delta-sm ${delta > 0 ? "up" : "down"}`}>{fmtSigned(delta)}</span>;
}

export const NewBadge = () => <span className="badge-new">NEW</span>;

export function Logo({ size }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="brand-mark" src="/drenix-mark.png" alt="" width={size ?? 30} height={size ?? 30} />;
}

export const Icon = {
  close: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
  print: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z" />
    </svg>
  ),
  doc: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H6v18h12V7zM14 3v4h4M9 12h6M9 16h6" />
    </svg>
  ),
  fit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  ),
  userPlus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5 10 17 19 7" />
    </svg>
  ),
  expand: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />
    </svg>
  ),
  sway: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4" />
    </svg>
  ),
};
