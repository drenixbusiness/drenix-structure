"use client";

import { useEffect, useRef } from "react";
import { DEPARTMENTS, DEPT_BY_KEY, EXECS, JOB_DESCRIPTIONS, type DeptKey, type FleetModel, type JobDescription } from "@/data/drenix-data";
import { deptView, type RoleView } from "@/lib/org";
import type { JDTarget } from "@/lib/targets";
import { DeltaSmall, Icon, NewBadge, Num } from "./ui";

interface Props {
  dept: DeptKey;
  model: FleetModel;
  prevModel: FleetModel | null;
  trucks: number;
  /** true while a JD modal is open on top — keyboard shortcuts pause */
  paused: boolean;
  onClose: () => void;
  onNavigate: (dept: DeptKey) => void;
  onOpen: (t: JDTarget) => void;
}

function JDSummary({ jd, showTitle }: { jd: JobDescription; showTitle: boolean }) {
  return (
    <div className="ov-jd">
      {showTitle && <div className="ov-jd-title">{jd.title}</div>}
      <p>{jd.purpose}</p>
      <ul className="jd-list">
        {jd.duties.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
    </div>
  );
}

function RoleCard({ role, lead, onOpen }: { role: RoleView; lead?: boolean; onOpen: () => void }) {
  const jds = role.jds.map((k) => JOB_DESCRIPTIONS[k]);
  return (
    <button type="button" className={`ov-role ${lead ? "ov-lead" : ""}`} onClick={onOpen}>
      <div className="ov-role-head">
        <span className="ov-role-title">
          {lead && <span className="ov-dot" />}
          {role.title}
        </span>
        <span className="ov-role-count num">
          {role.isNew ? <NewBadge /> : <DeltaSmall delta={role.delta} />}×{role.count}
        </span>
      </div>
      {!lead && (
        <div className="ov-seats" aria-hidden="true">
          {Array.from({ length: role.count }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
      )}
      {jds.map((jd) => (
        <JDSummary key={jd.key} jd={jd} showTitle={jds.length > 1} />
      ))}
      <span className="ov-more">Open full job description ›</span>
    </button>
  );
}

export function DeptOverview({ dept, model, prevModel, trucks, paused, onClose, onNavigate, onOpen }: Props) {
  const d = DEPT_BY_KEY[dept];
  const v = deptView(model, prevModel, dept);
  const lead = v.roles.find((r) => r.lead);
  const rest = v.roles.filter((r) => !r.lead);
  const idx = DEPARTMENTS.findIndex((x) => x.key === dept);
  const prev = DEPARTMENTS[(idx - 1 + DEPARTMENTS.length) % DEPARTMENTS.length];
  const next = DEPARTMENTS[(idx + 1) % DEPARTMENTS.length];
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // desktop scrolls the right column; phones scroll the whole sheet
    scrollRef.current?.scrollTo({ top: 0 });
    scrollRef.current?.parentElement?.scrollTo({ top: 0 });
  }, [dept]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => before?.focus?.();
  }, []);

  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onNavigate(prev.key);
      else if (e.key === "ArrowRight") onNavigate(next.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused, onClose, onNavigate, prev.key, next.key]);

  const cfo = d.headExec ? EXECS[d.headExec] : null;
  const seats = v.roles.flatMap((r) =>
    Array.from({ length: r.count }, (_, i) => ({ key: `${r.id}-${i}`, lead: !!r.lead && i === 0 })),
  );

  return (
    <div className="modal-backdrop ov-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ov" role="dialog" aria-modal="true" aria-labelledby="ov-title">
        <button ref={closeRef} type="button" className="btn icon-btn ov-close" aria-label="Close" onClick={onClose}>
          {Icon.close}
        </button>
        <aside className="ov-side">
          <div className="ov-side-top">
            <span className="jd-kicker">Reports to {d.parent}</span>
            <span className="ov-nav">
              <button type="button" className="btn icon-btn" aria-label={`Previous: ${prev.name}`} onClick={() => onNavigate(prev.key)}>
                {Icon.back}
              </button>
              <button type="button" className="btn icon-btn" aria-label={`Next: ${next.name}`} onClick={() => onNavigate(next.key)}>
                <span style={{ display: "inline-flex", transform: "scaleX(-1)" }}>{Icon.back}</span>
              </button>
            </span>
          </div>
          <h2 id="ov-title" className="ov-title">
            {d.name}
          </h2>
          <p className="ov-tag">{d.tagline}</p>
          <div className="ov-count">
            <span className="ov-big">
              <Num value={v.count} />
            </span>
            <span className="ov-count-label">
              People · {trucks} trucks
            </span>
          </div>
          <div className="seats ov-side-seats" aria-hidden="true">
            {seats.map((s) => (
              <span key={s.key} className={`seat ${s.lead ? "lead" : ""}`} />
            ))}
          </div>
          <div className="ov-sec">Functions</div>
          <div className="tags">
            {d.responsibilities.map((r) => (
              <span key={r} className="tag">
                {r}
              </span>
            ))}
          </div>
        </aside>

        <div className="ov-main" ref={scrollRef}>
          {v.count === 0 ? (
            <div className="ov-empty">
              <strong>No dedicated staff at {trucks} trucks</strong>
              {v.coveredBy}
            </div>
          ) : (
            <>
              <div className="ov-top">
                {cfo ? (
                  <button type="button" className="ov-role ov-lead" onClick={() => onOpen({ kind: "exec", key: cfo.key })}>
                    <div className="ov-role-head">
                      <span className="ov-role-title">
                        <span className="ov-dot" />
                        CFO · Department head
                      </span>
                      <span className="ov-role-count num">×1</span>
                    </div>
                    <JDSummary jd={JOB_DESCRIPTIONS.cfo} showTitle={false} />
                    <span className="ov-more">Open full job description ›</span>
                  </button>
                ) : (
                  lead && <RoleCard role={lead} lead onOpen={() => onOpen({ kind: "role", dept, roleId: lead.id })} />
                )}
              </div>
              {(cfo ? v.roles : rest).length > 0 && (
                <>
                  <div className="ov-bus" aria-hidden="true" />
                  <div className="ov-grid">
                    {(cfo ? v.roles : rest).map((r) => (
                      <RoleCard key={r.id} role={r} onOpen={() => onOpen({ kind: "role", dept, roleId: r.id })} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
