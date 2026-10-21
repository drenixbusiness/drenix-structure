"use client";

import { useEffect, useRef, useState } from "react";

export function useMedia(query: string, initial = false) {
  const [match, setMatch] = useState(initial);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Phones (portrait) and small landscape screens. Keep in sync with globals.css. */
export const COMPACT_QUERY = "(max-width: 760px), (max-height: 520px)";
export const useCompact = () => useMedia(COMPACT_QUERY);
export const useCanHover = () => useMedia("(hover: hover) and (pointer: fine)");

/** Tween a number toward `value` (ease-out). */
export function useTweenedNumber(value: number, ms = 450) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(a + (value - a) * e);
      setShown(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}
