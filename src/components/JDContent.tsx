"use client";

import { docUrl, type JobDescription } from "@/data/drenix-data";
import type { ResolvedPosition } from "@/lib/targets";
import { Icon } from "./ui";

function JDSections({ jd }: { jd: JobDescription }) {
  return (
    <>
      <section className="jd-sec">
        <h4>Purpose</h4>
        <p>{jd.purpose}</p>
      </section>
      <section className="jd-sec">
        <h4>Responsibilities</h4>
        <ul className="jd-list">
          {jd.duties.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </section>
      <section className="jd-sec">
        <h4>Responsibility within the department</h4>
        <p>{jd.authority}</p>
      </section>
      <section className="jd-sec">
        <h4>Accountability</h4>
        <p>{jd.accountability}</p>
      </section>
      <section className="jd-sec">
        <h4>Required experience</h4>
        <p>Work experience: {jd.experience}</p>
      </section>
      <section className="jd-sec">
        <h4>Requirements</h4>
        <p>{jd.requirements}</p>
      </section>
      <section className="jd-sec">
        <h4>Work schedule &amp; procedure</h4>
        <p>
          Workplace: {jd.workplace}. {jd.procedure}
        </p>
      </section>
    </>
  );
}

export function DocLink({ jd, label }: { jd: JobDescription; label?: string }) {
  return (
    <a className="btn btn-accent" href={docUrl(jd.docId)} target="_blank" rel="noopener noreferrer">
      {Icon.doc}
      {label ?? "Open full job description"}
    </a>
  );
}

export function PositionContent({ pos, trucks, headingId }: { pos: ResolvedPosition; trucks: number; headingId?: string }) {
  const merged = pos.jds.length > 1;
  return (
    <article>
      <div className="jd-kicker">{pos.kicker}</div>
      <h2 className="jd-title" id={headingId}>
        {pos.title}
      </h2>
      <div className="jd-seats num">
        {pos.seats} {pos.seats === 1 ? "seat" : "seats"} at {trucks} trucks
        {merged ? ` · combines ${pos.jds.length} job descriptions` : ""}
      </div>

      <dl className="jd-meta">
        <div>
          <dt>Reports to</dt>
          <dd>{pos.reportsTo}</dd>
        </div>
        <div>
          <dt>Manages</dt>
          <dd>{pos.manages.length ? pos.manages.join(", ") : "—"}</dd>
        </div>
        <div>
          <dt>Workplace</dt>
          <dd>{pos.workplace}</dd>
        </div>
      </dl>

      {pos.staticText && <p className="jd-static">{pos.staticText}</p>}

      {pos.jds.map((jd, i) => (
        <div className="jd-block" key={jd.key}>
          {merged && (
            <div className="jd-sub">
              <h3>{jd.title}</h3>
              <span className="jd-part num">
                Part {i + 1} of {pos.jds.length}
              </span>
            </div>
          )}
          <JDSections jd={jd} />
          {merged && (
            <div className="jd-actions">
              <DocLink jd={jd} label={`Open full job description — ${jd.title}`} />
            </div>
          )}
        </div>
      ))}

      {!merged && pos.jds[0] && (
        <div className="jd-actions">
          <DocLink jd={pos.jds[0]} />
        </div>
      )}
    </article>
  );
}
