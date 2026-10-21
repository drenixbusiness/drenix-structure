"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEPARTMENTS, JOB_DESCRIPTIONS, type FleetModel } from "@/data/drenix-data";
import { emptyHiringRequest, GENDERS, validateHiring, type HiringRequest } from "@/lib/hiring";
import { Combobox, Select } from "./Select";
import { Icon } from "./ui";

const DRAFT_KEY = "drenix-hiring-draft";
const EXEC_DEPT = "Executive / Management";

type ListKey = "responsibilities" | "hardSkills" | "softSkills";

function loadDraft(): HiringRequest {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...emptyHiringRequest(), ...JSON.parse(raw), website: "" };
  } catch {}
  return emptyHiringRequest();
}

export function HiringForm({ model, onClose }: { model: FleetModel; onClose: () => void }) {
  const [f, setF] = useState<HiringRequest>(emptyHiringRequest);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [serverError, setServerError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  // restore an unsent draft (this browser only)
  useEffect(() => {
    setF(loadDraft());
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current || status === "sent") return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...f, website: "" }));
    } catch {}
  }, [f, status]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // an open dropdown closes itself first
        if ((e.target as HTMLElement | null)?.closest?.(".dd.open")) return;
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus?.();
    };
  }, [onClose]);

  const set = <K extends keyof HiringRequest>(k: K, v: HiringRequest[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    if (errors[k as string]) setErrors((e) => ({ ...e, [k as string]: "" }));
  };
  const setItem = (k: ListKey, i: number, v: string) => {
    setF((s) => {
      const next = [...s[k]];
      next[i] = v;
      return { ...s, [k]: next };
    });
    if (errors[k]) setErrors((e) => ({ ...e, [k]: "" }));
  };

  // position suggestions: roles of the chosen department at the current fleet size + their JD titles
  const deptObj = DEPARTMENTS.find((d) => d.name === f.department);
  const suggestions = useMemo(() => {
    const titles = new Set<string>();
    const depts = deptObj ? [deptObj] : DEPARTMENTS;
    for (const d of depts)
      for (const r of model.departments[d.key].roles) {
        titles.add(r.title);
        r.jds.forEach((k) => titles.add(JOB_DESCRIPTIONS[k].title));
      }
    if (!deptObj || f.department === EXEC_DEPT) ["COO", "CFO", "Advisor / Consultant"].forEach((t) => titles.add(t));
    return [...titles];
  }, [deptObj, f.department, model]);

  // JD whose duties can pre-fill "Main Responsibilities"
  const matchedJd = useMemo(() => {
    const t = f.position.trim().toLowerCase();
    if (!t) return null;
    const byTitle = Object.values(JOB_DESCRIPTIONS).find((j) => j.title.toLowerCase() === t);
    if (byTitle) return byTitle;
    for (const d of DEPARTMENTS)
      for (const r of model.departments[d.key].roles) if (r.title.toLowerCase() === t) return JOB_DESCRIPTIONS[r.jds[0]];
    return null;
  }, [f.position, model]);

  const fillFromJd = () => {
    if (!matchedJd) return;
    const duties = matchedJd.duties.slice(0, 5);
    set("responsibilities", [0, 1, 2, 3, 4].map((i) => f.responsibilities[i]?.trim() || duties[i] || ""));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateHiring(f);
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = Object.keys(errs)[0];
      document.getElementById(`hf-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setStatus("sending");
    setServerError("");
    try {
      const res = await fetch("/api/hiring-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; errors?: Record<string, string> };
      if (!res.ok || !json.ok) {
        if (json.errors) setErrors(json.errors);
        throw new Error(json.error || "Could not send the request.");
      }
      setStatus("sent");
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {}
      scrollRef.current?.scrollTo({ top: 0 });
    } catch (err) {
      setStatus("error");
      setServerError(err instanceof Error ? err.message : "Could not send the request.");
    }
  };

  const reset = () => {
    setF(emptyHiringRequest());
    setErrors({});
    setStatus("idle");
  };

  const err = (k: string) => (errors[k] ? <span className="hf-err">{errors[k]}</span> : null);
  // `div` for custom dropdowns: a <label> would re-click its button when an option is picked
  const field = (k: keyof HiringRequest, label: string, input: React.ReactNode, wide = false, div = false) => {
    const Tag = div ? "div" : "label";
    return (
      <Tag className={`hf-field ${wide ? "wide" : ""} ${errors[k as string] ? "invalid" : ""}`} id={`hf-${k as string}`}>
        <span className="hf-label">
          {label}
          {err(k as string)}
        </span>
        {input}
      </Tag>
    );
  };
  const text = (k: keyof HiringRequest, placeholder = "", type = "text") => (
    <input
      type={type}
      value={f[k] as string}
      placeholder={placeholder}
      onChange={(e) => set(k, e.target.value as never)}
    />
  );
  const list = (k: ListKey, label: string, hint: string, extra?: React.ReactNode) => (
    <div className="hf-field wide" id={`hf-${k}`}>
      <span className="hf-label">
        {label}
        {err(k)}
        {extra}
      </span>
      <div className="hf-list">
        {f[k].map((v, i) => (
          <div key={i} className="hf-list-row">
            <span className="hf-n num">{i + 1}</span>
            <input
              value={v}
              placeholder={hint}
              aria-label={`${label} ${i + 1}`}
              aria-invalid={!!errors[k] && !v.trim()}
              className={errors[k] && !v.trim() ? "invalid" : ""}
              onChange={(e) => setItem(k, i, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal hf" role="dialog" aria-modal="true" aria-labelledby="hf-title">
        <button ref={closeRef} type="button" className="btn icon-btn modal-close" aria-label="Close" onClick={onClose}>
          {Icon.close}
        </button>

        {status === "sent" ? (
          <div className="hf-done" role="status">
            <div className="hf-done-mark" aria-hidden="true">
              {Icon.check}
            </div>
            <h2>Request sent to HR</h2>
            <p>
              The recruitment request for <b>{f.position}</b> ({f.openPositions}) has been posted to the HR Telegram group.
            </p>
            <div className="jd-actions" style={{ justifyContent: "center" }}>
              <button type="button" className="btn" onClick={reset}>
                New request
              </button>
              <button type="button" className="btn btn-accent" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <form className="hf-form" onSubmit={submit} noValidate>
            <div className="modal-scroll" ref={scrollRef}>
              <div className="jd-kicker">Internal hiring request</div>
              <h2 className="jd-title" id="hf-title">
                Employee Recruitment Request
              </h2>
              <p className="jd-seats">Fill in the form and press Send — it goes straight to the HR Telegram group.</p>

              {/* honeypot */}
              <input
                className="hf-hp"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={f.website}
                onChange={(e) => set("website", e.target.value)}
              />

              <section className="hf-sec">
                <h3>Position</h3>
                <div className="hf-grid">
                  {field(
                    "department",
                    "Department",
                    <Select
                      value={f.department}
                      options={[...DEPARTMENTS.map((d) => d.name), EXEC_DEPT]}
                      placeholder="Select department…"
                      ariaLabel="Department"
                      invalid={!!errors.department}
                      onChange={(v) => set("department", v)}
                    />,
                    false,
                    true,
                  )}
                  {field(
                    "position",
                    "Position / Job Title",
                    <Combobox
                      value={f.position}
                      options={suggestions}
                      placeholder="e.g. Dispatcher"
                      ariaLabel="Position / Job Title"
                      invalid={!!errors.position}
                      onChange={(v) => set("position", v)}
                    />,
                    false,
                    true,
                  )}
                  {field("requester", "Requester's Full Name", text("requester", "Full name"))}
                  {field(
                    "openPositions",
                    "Number of Open Positions",
                    <div className="hf-stepper">
                      <button
                        type="button"
                        aria-label="Fewer positions"
                        disabled={Number(f.openPositions) <= 1}
                        onClick={() => set("openPositions", String(Math.max(1, (Number(f.openPositions) || 1) - 1)))}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        inputMode="numeric"
                        aria-label="Number of Open Positions"
                        value={f.openPositions}
                        onChange={(e) => set("openPositions", e.target.value.replace(/\D/g, "").slice(0, 3))}
                      />
                      <button
                        type="button"
                        aria-label="More positions"
                        disabled={Number(f.openPositions) >= 100}
                        onClick={() => set("openPositions", String(Math.min(100, (Number(f.openPositions) || 0) + 1)))}
                      >
                        +
                      </button>
                    </div>,
                    false,
                    true,
                  )}
                </div>
              </section>

              <section className="hf-sec">
                <h3>Role profile</h3>
                <div className="hf-grid">
                  {list(
                    "responsibilities",
                    "Main Responsibilities",
                    "Responsibility",
                    matchedJd && (
                      <button type="button" className="hf-link" onClick={fillFromJd}>
                        Fill from “{matchedJd.title}” job description
                      </button>
                    ),
                  )}
                  <div className="hf-two wide">
                    {list("hardSkills", "5 Hard Skills", "Hard skill")}
                    {list("softSkills", "5 Soft Skills", "Soft skill")}
                  </div>
                </div>
              </section>

              <section className="hf-sec">
                <h3>Requirements</h3>
                <div className="hf-grid">
                  {field("experience", "Required Work Experience", text("experience", "e.g. 2+ years in US trucking dispatch"), true)}
                  {field("languages", "Language(s)", text("languages", "e.g. English, Russian"))}
                  {field("languageLevel", "Language Level", text("languageLevel", "e.g. B2 / Fluent"))}
                  {field("education", "Education Requirements", text("education", "e.g. Bachelor's degree"))}
                  {field("age", "Age", text("age", "e.g. 22–35"))}
                  <div className={`hf-field wide ${errors.gender ? "invalid" : ""}`} id="hf-gender">
                    <span className="hf-label">
                      Gender
                      {err("gender")}
                    </span>
                    <div className="hf-chips" role="radiogroup" aria-label="Gender">
                      {GENDERS.map((g) => (
                        <button key={g} type="button" role="radio" aria-checked={f.gender === g} className="hf-chip" onClick={() => set("gender", g)}>
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <section className="hf-sec">
                <h3>Schedule &amp; salary</h3>
                <div className="hf-grid">
                  {field("schedule", "Proposed Work Schedule", text("schedule", "e.g. 18:00–03:00 (US hours)"))}
                  {field("workingDays", "Working Days", text("workingDays", "e.g. Mon–Fri"))}
                  {field("probation", "Probation Period Duration", text("probation", "e.g. 2 months"))}
                  {field("salaryProbation", "Salary During Probation Period", text("salaryProbation", "Amount"))}
                  {field("salaryAfter", "Salary After Probation Period", text("salaryAfter", "Amount"))}
                </div>
              </section>

              <section className="hf-sec">
                <h3>Notes</h3>
                <div className="hf-grid">
                  {field(
                    "mandatory",
                    "Mandatory Requirements",
                    <textarea rows={3} value={f.mandatory} onChange={(e) => set("mandatory", e.target.value)} />,
                    true,
                  )}
                  {field(
                    "comments",
                    "Additional Comments / Requirements",
                    <textarea rows={3} value={f.comments} onChange={(e) => set("comments", e.target.value)} />,
                    true,
                  )}
                </div>
              </section>
            </div>

            <div className="hf-foot">
              <span className={`hf-foot-note ${status === "error" ? "is-error" : ""}`} role={status === "error" ? "alert" : undefined}>
                {status === "error"
                  ? serverError
                  : Object.values(errors).some(Boolean)
                    ? "Please complete the highlighted fields."
                    : "Please complete all fields before submitting the request to HR."}
              </span>
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-accent hf-send" disabled={status === "sending"}>
                {status === "sending" ? "Sending…" : "Send"}
                {Icon.send}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
