"use client";

import { useEffect, useState } from "react";
import { TRUCK_STOPS, type TruckStop } from "@/data/drenix-data";
import { snapTrucks } from "@/lib/org";
import { DeltaPill, Num } from "./ui";

interface Props {
  trucks: TruckStop;
  onChange: (t: TruckStop) => void;
  total: number;
  totalDelta: number;
  modelName: string;
  changeKey: number;
}

export function TruckSelector({ trucks, onChange, total, totalDelta, modelName, changeKey }: Props) {
  const idx = TRUCK_STOPS.indexOf(trucks);
  const [draft, setDraft] = useState(String(trucks));
  useEffect(() => setDraft(String(trucks)), [trucks]);

  const commit = () => {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n)) onChange(snapTrucks(n));
    else setDraft(String(trucks));
  };
  const fill = `${(idx / (TRUCK_STOPS.length - 1)) * 100}%`;

  return (
    <section className="trucks" aria-label="Fleet size">
      <div className="trucks-readout">
        <button
          type="button"
          className="step-btn step-minus"
          aria-label="Fewer trucks"
          disabled={idx <= 0}
          onClick={() => onChange(TRUCK_STOPS[Math.max(0, idx - 1)])}
        >
          −
        </button>
        <label className="trucks-num">
          <input
            inputMode="numeric"
            type="number"
            min={TRUCK_STOPS[0]}
            max={TRUCK_STOPS[TRUCK_STOPS.length - 1]}
            value={draft}
            aria-label="Number of trucks"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <span className="trucks-num-label">/ TRUCKS</span>
        </label>
        <button
          type="button"
          className="step-btn step-plus"
          aria-label="More trucks"
          disabled={idx >= TRUCK_STOPS.length - 1}
          onClick={() => onChange(TRUCK_STOPS[Math.min(TRUCK_STOPS.length - 1, idx + 1)])}
        >
          +
        </button>
      </div>

      <div className="slider">
        <input
          type="range"
          min={0}
          max={TRUCK_STOPS.length - 1}
          step={1}
          value={idx}
          style={{ ["--fill" as string]: fill }}
          aria-label="Fleet size"
          aria-valuetext={`${trucks} trucks`}
          onChange={(e) => onChange(TRUCK_STOPS[Number(e.target.value)])}
        />
        <div className="ticks">
          {TRUCK_STOPS.map((s, i) => (
            <button
              key={s}
              type="button"
              className="tick"
              style={{ left: `${(i / (TRUCK_STOPS.length - 1)) * 100}%` }}
              aria-pressed={s === trucks}
              onClick={() => onChange(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="trucks-total">
        <span className="total-num">
          <Num value={total} />
        </span>
        <div className="total-meta">
          <strong>
            {modelName} <DeltaPill delta={totalDelta} k={changeKey} />
          </strong>
          <span>Office staff only · executives not counted</span>
        </div>
      </div>
    </section>
  );
}
