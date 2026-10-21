"use client";

import { Icon, Logo } from "./ui";

export type ViewMode = "chart" | "3d";

export function Header({
  view,
  onView,
  onPrint,
  onHire,
}: {
  view: ViewMode;
  onView: (v: ViewMode) => void;
  onPrint: () => void;
  onHire: () => void;
}) {
  return (
    <header className="header">
      <div className="brand">
        <Logo />
        <span className="brand-word">DRENIX</span>
        <span className="brand-div" aria-hidden="true" />
        <span className="brand-sub">ORGANIZATIONAL STRUCTURE</span>
      </div>
      <div className="header-right">
        <button type="button" className="btn btn-accent hire-btn" onClick={onHire} aria-label="Need worker — open recruitment request form">
          {Icon.userPlus}
          <span className="hire-label">Need worker</span>
        </button>
        <div className="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "chart"} onClick={() => onView("chart")}>
            Chart
          </button>
          <button type="button" aria-pressed={view === "3d"} onClick={() => onView("3d")}>
            3D
          </button>
        </div>
        <button type="button" className="btn print-btn" onClick={onPrint} aria-label="Print chart">
          {Icon.print}
          <span className="print-label">Print</span>
        </button>
      </div>
    </header>
  );
}
