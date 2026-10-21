"use client";

import { useEffect, useRef } from "react";
import type { ResolvedPosition } from "@/lib/targets";
import { PositionContent } from "./JDContent";
import { Icon } from "./ui";

export function JDModal({ pos, trucks, onClose }: { pos: ResolvedPosition; trucks: number; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="jd-modal-title">
        <button ref={closeRef} type="button" className="btn icon-btn modal-close" aria-label="Close" onClick={onClose}>
          {Icon.close}
        </button>
        <div className="modal-scroll">
          <PositionContent pos={pos} trucks={trucks} headingId="jd-modal-title" />
        </div>
      </div>
    </div>
  );
}
