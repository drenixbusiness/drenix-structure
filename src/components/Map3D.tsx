"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEPARTMENTS, DEPT_BY_KEY, EXECS, type DeptKey, type FleetModel } from "@/data/drenix-data";
import { cooStaff, deptCount, deptView, leadRole, totalStaff } from "@/lib/org";
import { resolveTarget, type JDTarget } from "@/lib/targets";
import { COMPACT_QUERY, useCompact, useMedia } from "@/lib/hooks";
import { CompanyScene, webglAvailable, type NodeId } from "./three/CompanyScene";
import { PositionContent } from "./JDContent";
import { DeltaSmall, Icon, NewBadge } from "./ui";

type Level = { t: "hq" } | { t: "coo" } | { t: "dept"; dept: DeptKey } | { t: "pos"; target: JDTarget };

const NODE_IDS: NodeId[] = ["hq", "coo", ...DEPARTMENTS.map((d) => d.key)];

const levelFor = (id: NodeId): Level => (id === "hq" ? { t: "hq" } : id === "coo" ? { t: "coo" } : { t: "dept", dept: id });

interface Props {
  model: FleetModel;
  prevModel: FleetModel | null;
  trucks: number;
  active: boolean;
}

export function Map3D({ model, prevModel, trucks, active }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<CompanyScene | null>(null);
  const panels = useRef<Partial<Record<NodeId, HTMLButtonElement | null>>>({});
  const beams = useRef<Partial<Record<NodeId, HTMLDivElement | null>>>({});
  const [stack, setStack] = useState<Level[]>([]);
  const [hovered, setHovered] = useState<NodeId | null>(null);
  const [sway, setSway] = useState(true);
  const [supported, setSupported] = useState<boolean | null>(null);
  const compact = useCompact();
  const portrait = useMedia("(orientation: portrait)", true);
  const modelRef = useRef(model);
  modelRef.current = model;

  const open = stack.length > 0;
  const building: NodeId | null = useMemo(() => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const l = stack[i];
      if (l.t === "hq") return "hq";
      if (l.t === "coo") return "coo";
      if (l.t === "dept") return l.dept;
    }
    return null;
  }, [stack]);

  // ------------------------------------------------------------------ scene lifecycle
  // Portrait phones use a narrower layout; the scene is rebuilt when that changes (rotation).
  const narrow = compact && portrait;
  const [layoutNarrow, setLayoutNarrow] = useState<boolean | null>(null);
  useEffect(() => {
    const now = window.matchMedia(
      "(max-width: 760px) and (orientation: portrait), (max-height: 520px) and (orientation: portrait)",
    ).matches;
    setLayoutNarrow(now);
  }, [narrow]);

  useEffect(() => {
    if (layoutNarrow === null) return;
    const ok = webglAvailable();
    setSupported(ok);
    if (!ok || !hostRef.current) return;
    let scene: CompanyScene;
    try {
      scene = new CompanyScene(
        hostRef.current,
        {
          onHover: (id) => setHovered(id),
          onSelect: (id) => setStack(id ? [levelFor(id)] : []),
        },
        { compact: window.matchMedia(COMPACT_QUERY).matches, narrow: layoutNarrow },
      );
    } catch {
      setSupported(false);
      return;
    }
    sceneRef.current = scene;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __drenixScene: CompanyScene }).__drenixScene = scene;
    scene.setModel(modelRef.current, false);
    NODE_IDS.forEach((id) => {
      const panel = panels.current[id];
      const beam = beams.current[id];
      if (panel && beam) scene.registerLabel(id, { panel, beam });
    });
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [layoutNarrow]);

  useEffect(() => {
    sceneRef.current?.setActive(active);
  }, [active, supported, layoutNarrow]);

  const firstModel = useRef(true);
  useEffect(() => {
    if (firstModel.current) {
      firstModel.current = false;
      return;
    }
    sceneRef.current?.setModel(model, true);
  }, [model]);

  useEffect(() => sceneRef.current?.setCompact(compact), [compact, layoutNarrow]);
  useEffect(() => sceneRef.current?.setSway(sway), [sway, layoutNarrow]);
  useEffect(() => sceneRef.current?.setSelected(building), [building, layoutNarrow]);

  // drawer inset → shift the scene so the selected building stays visible beside the drawer
  useEffect(() => {
    const s = sceneRef.current;
    const d = drawerRef.current;
    if (!s || !d) return;
    const update = () => {
      if (!open) return s.setInset(0, 0);
      if (compact && portrait) s.setInset(0, d.offsetHeight);
      else s.setInset(d.offsetWidth, 0);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(d);
    return () => ro.disconnect();
  }, [open, compact, portrait, layoutNarrow]);

  // Esc goes back one level
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStack((s) => s.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  // close the drawer when leaving the 3D view
  useEffect(() => {
    if (!active) setStack([]);
  }, [active]);

  const push = useCallback((l: Level) => setStack((s) => [...s, l]), []);
  const back = () => setStack((s) => s.slice(0, -1));
  const close = () => setStack([]);
  const highlight = (dept: DeptKey | null, roleId: string | null) => sceneRef.current?.setHighlightFloor(dept, roleId);

  // ------------------------------------------------------------------ labels
  const total = totalStaff(model);
  const cooN = cooStaff(model);

  const labelBody = (id: NodeId) => {
    if (id === "hq") {
      return compact ? (
        <>
          <span className="holo-name">Drenix HQ</span>
          <span className="holo-count">{total}</span>
        </>
      ) : (
        <>
          <div className="holo-head">
            <span className="holo-name">Drenix Holding</span>
          </div>
          <div className="holo-desc">Owner · CEO · Advisor</div>
          <div className="holo-stats">
            {total} employees · 8 departments
          </div>
        </>
      );
    }
    if (id === "coo") {
      return compact ? (
        <>
          <span className="holo-name">COO</span>
          <span className="holo-count">{cooN}</span>
        </>
      ) : (
        <>
          <div className="holo-head">
            <span className="holo-name">COO</span>
          </div>
          <div className="holo-desc">Chief Operating Officer</div>
          <div className="holo-stats">5 departments · {cooN} employees</div>
        </>
      );
    }
    const d = DEPT_BY_KEY[id];
    const n = deptCount(model, id);
    const roles = model.departments[id].roles;
    if (compact) {
      return (
        <>
          <span className="holo-name">{d.shortName}</span>
          <span className="holo-count">{n}</span>
        </>
      );
    }
    const lead = leadRole(model, id);
    return (
      <>
        <div className="holo-head">
          <span className="holo-name">{d.shortName}</span>
        </div>
        <div className="holo-desc">{d.tagline}</div>
        <div className="holo-stats">
          {n} employees · {roles.length} positions
        </div>
        <div className="holo-mgr">
          {n === 0 ? (
            model.departments[id].coveredBy
          ) : (
            <>
              Head: <b>{d.headExec ? "CFO" : lead?.title}</b>
            </>
          )}
        </div>
        <div className="holo-resp">{d.responsibilities.slice(0, 3).join(" · ")}</div>
      </>
    );
  };

  const labelName = (id: NodeId) => (id === "hq" ? "Drenix Holding" : id === "coo" ? "COO" : DEPT_BY_KEY[id].longName);

  // ------------------------------------------------------------------ breadcrumb
  const levelName = (l: Level) => {
    if (l.t === "hq") return "Headquarters";
    if (l.t === "coo") return "COO";
    if (l.t === "dept") return DEPT_BY_KEY[l.dept].longName;
    return resolveTarget(l.target, model)?.title ?? "Position";
  };

  // if a position disappears after a truck change, drop it from the stack
  useEffect(() => {
    setStack((s) => {
      const i = s.findIndex((l) => l.t === "pos" && !resolveTarget(l.target, model));
      return i === -1 ? s : s.slice(0, i);
    });
  }, [model]);

  // ------------------------------------------------------------------ drawer content
  const current = stack[stack.length - 1];

  // while a position is open, keep its floor lit in the building
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    if (current?.t === "pos" && current.target.kind === "role") s.setHighlightFloor(current.target.dept, current.target.roleId);
    else s.setHighlightFloor(null, null);
  }, [current]);

  const renderDept = (k: DeptKey) => {
    const d = DEPT_BY_KEY[k];
    const v = deptView(model, prevModel, k);
    const lead = v.roles.find((r) => r.lead);
    const rest = v.roles.filter((r) => !r.lead);
    return (
      <>
        <div className="jd-kicker">
          Reports to {d.parent}
        </div>
        <h2>{d.longName}</h2>
        <p className="lead-text">{d.tagline}</p>
        <dl className="stats">
          <div className="stat">
            <dt>Employees</dt>
            <dd>{v.count}</dd>
          </div>
          <div className="stat">
            <dt>Positions</dt>
            <dd>{v.roles.length}</dd>
          </div>
          <div className="stat">
            <dt>Reports to</dt>
            <dd className="small">{d.parent}</dd>
          </div>
        </dl>

        {d.headExec ? (
          <button type="button" className="mgr-card" onClick={() => push({ t: "pos", target: { kind: "exec", key: d.headExec! } })}>
            <span className="dot" />
            <span>
              <div className="t">CFO · Department head</div>
              <div className="s">{EXECS.cfo.subtitle} · open job description</div>
            </span>
            <span className="chev">›</span>
          </button>
        ) : lead ? (
          <button type="button" className="mgr-card" onClick={() => push({ t: "pos", target: { kind: "role", dept: k, roleId: lead.id } })}>
            <span className="dot" />
            <span>
              <div className="t">{lead.title}</div>
              <div className="s">Department head · open job description</div>
            </span>
            <span className="chev">›</span>
          </button>
        ) : null}

        <div className="sec-title">Positions + headcount</div>
        {v.count === 0 ? (
          <p className="lead-text">{v.coveredBy}</p>
        ) : (
          <ul className="tree" onPointerLeave={() => highlight(null, null)}>
            {lead && (
              <li>
                <button
                  type="button"
                  onPointerEnter={() => highlight(k, lead.id)}
                  onFocus={() => highlight(k, lead.id)}
                  onClick={() => push({ t: "pos", target: { kind: "role", dept: k, roleId: lead.id } })}
                >
                  <span className="lead-dot" />
                  <span>{lead.title}</span>
                  <span className="cnt">
                    {lead.isNew && <NewBadge />}— {lead.count}
                  </span>
                </button>
              </li>
            )}
            {rest.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={lead ? "indent" : ""}
                  onPointerEnter={() => highlight(k, r.id)}
                  onFocus={() => highlight(k, r.id)}
                  onClick={() => push({ t: "pos", target: { kind: "role", dept: k, roleId: r.id } })}
                >
                  {lead && <span className="branch">└</span>}
                  <span>{r.title}</span>
                  <span className="cnt">
                    {r.isNew ? <NewBadge /> : <DeltaSmall delta={r.delta} />}— {r.count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="sec-title">Key responsibilities</div>
        <div className="tags">
          {d.responsibilities.map((r) => (
            <span key={r} className="tag">
              {r}
            </span>
          ))}
        </div>
      </>
    );
  };

  const deptRow = (k: DeptKey, onClick: () => void) => {
    const d = DEPT_BY_KEY[k];
    const n = deptCount(model, k);
    return (
      <li key={k}>
        <button type="button" onClick={onClick}>
          <span>{d.name}</span>
          <span className="meta">{n ? `${n} employees` : model.departments[k].coveredBy}</span>
        </button>
      </li>
    );
  };

  let body: React.ReactNode = null;
  if (current?.t === "hq") {
    body = (
      <>
        <div className="jd-kicker">Drenix Holding</div>
        <h2>Headquarters</h2>
        <p className="lead-text">Owner · CEO · Advisor</p>
        <dl className="stats">
          <div className="stat">
            <dt>Employees</dt>
            <dd>{total}</dd>
          </div>
          <div className="stat">
            <dt>Departments</dt>
            <dd>8</dd>
          </div>
          <div className="stat">
            <dt>Fleet</dt>
            <dd className="small">{trucks} trucks</dd>
          </div>
        </dl>
        <div className="sec-title">Leadership</div>
        <ul className="list-nav">
          <li>
            <button type="button" onClick={() => push({ t: "pos", target: { kind: "owner" } })}>
              <span>
                <b>Owner</b>
                <div className="lead-text" style={{ fontSize: 12 }}>
                  Strategic Direction · Business Growth
                </div>
              </span>
            </button>
          </li>
          <li>
            <button type="button" onClick={() => push({ t: "pos", target: { kind: "exec", key: "advisor" } })}>
              <span>
                <b>Advisor / Consultant</b>
                <div className="lead-text" style={{ fontSize: 12 }}>
                  Advisory line to the Owner
                </div>
              </span>
              <span className="meta">›</span>
            </button>
          </li>
        </ul>
        <div style={{ height: 8 }} />
        <button type="button" className="mgr-card" onClick={() => push({ t: "pos", target: { kind: "exec", key: "ceo" } })}>
          <span className="dot" />
          <span>
            <div className="t">CEO</div>
            <div className="s">Chief Executive Officer · open job description</div>
          </span>
          <span className="chev">›</span>
        </button>
        <div className="sec-title">Reports to the CEO</div>
        <ul className="list-nav">
          <li>
            <button type="button" onClick={() => push({ t: "coo" })}>
              <span>COO · Chief Operating Officer</span>
              <span className="meta">{cooN} employees</span>
            </button>
          </li>
          {DEPARTMENTS.filter((d) => d.parent === "CEO").map((d) => deptRow(d.key, () => push({ t: "dept", dept: d.key })))}
        </ul>
      </>
    );
  } else if (current?.t === "coo") {
    body = (
      <>
        <div className="jd-kicker">Reports to CEO</div>
        <h2>COO · Chief Operating Officer</h2>
        <p className="lead-text">US trucking operations: dispatch, fleet, ELD, safety and driver recruiting.</p>
        <dl className="stats">
          <div className="stat">
            <dt>Employees</dt>
            <dd>{cooN}</dd>
          </div>
          <div className="stat">
            <dt>Departments</dt>
            <dd>5</dd>
          </div>
          <div className="stat">
            <dt>Reports to</dt>
            <dd className="small">CEO</dd>
          </div>
        </dl>
        <button type="button" className="mgr-card" onClick={() => push({ t: "pos", target: { kind: "exec", key: "coo" } })}>
          <span className="dot" />
          <span>
            <div className="t">COO</div>
            <div className="s">Job description</div>
          </span>
          <span className="chev">›</span>
        </button>
        <div className="sec-title">Departments</div>
        <ul className="list-nav">
          {DEPARTMENTS.filter((d) => d.parent === "COO").map((d) => deptRow(d.key, () => push({ t: "dept", dept: d.key })))}
        </ul>
      </>
    );
  } else if (current?.t === "dept") {
    body = renderDept(current.dept);
  } else if (current?.t === "pos") {
    const pos = resolveTarget(current.target, model);
    body = pos ? <PositionContent pos={pos} trucks={trucks} /> : null;
  }

  // ------------------------------------------------------------------ render
  return (
    <div className={`map3d ${hovered ? "hovering" : ""}`}>
      <div ref={hostRef} className="map3d-canvas" />

      {supported === false && (
        <div className="webgl-off" role="status">
          <div>
            <strong>3D view unavailable on this device</strong>
            The Chart view shows the same structure.
          </div>
        </div>
      )}

      <div className="labels">
        {NODE_IDS.map((id) => (
          <div key={`b-${id}`} ref={(el) => void (beams.current[id] = el)} className="holo-beam" />
        ))}
        {NODE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            ref={(el) => void (panels.current[id] = el)}
            className={`holo ${compact ? "compact" : ""}`}
            aria-label={`${labelName(id)} — open details`}
            onPointerEnter={() => sceneRef.current?.setLabelHover(id)}
            onPointerLeave={() => sceneRef.current?.setLabelHover(null)}
            onClick={() => setStack([levelFor(id)])}
          >
            {labelBody(id)}
          </button>
        ))}
      </div>

      <nav className="crumbs" aria-label="Breadcrumb">
        <button type="button" onClick={close} aria-current={stack.length === 0 ? "page" : undefined}>
          Drenix Holding · 3D Company Map
        </button>
        {stack.map((l, i) => (
          <span key={i} style={{ display: "contents" }}>
            <span className="sep" aria-hidden="true">
              ›
            </span>
            <button
              type="button"
              aria-current={i === stack.length - 1 ? "page" : undefined}
              onClick={() => setStack(stack.slice(0, i + 1))}
            >
              {levelName(l)}
            </button>
          </span>
        ))}
      </nav>

      <div className="hint3d">
        <span className="hint-text">
          {compact ? "Drag to rotate · pinch to zoom · tap a department" : "Drag to rotate · scroll to zoom · click a department"}
        </span>
        <button
          type="button"
          className="btn icon-btn"
          aria-pressed={sway}
          aria-label={sway ? "Turn idle camera sway off" : "Turn idle camera sway on"}
          title={sway ? "Idle sway: on" : "Idle sway: off"}
          onClick={() => setSway((s) => !s)}
          style={{ opacity: sway ? 1 : 0.55 }}
        >
          {Icon.sway}
        </button>
      </div>

      <aside
        ref={drawerRef}
        className={`drawer ${open ? "open" : ""}`}
        aria-hidden={!open}
        aria-label="Details"
        {...(!open ? { inert: true } : {})}
      >
        <div className="drawer-grab" aria-hidden="true" />
        <div className="drawer-bar">
          <button type="button" className="btn" onClick={back} aria-label="Back">
            {Icon.back}
            Back
          </button>
          <span className="spacer" />
          <button type="button" className="btn icon-btn" onClick={close} aria-label="Close">
            {Icon.close}
          </button>
        </div>
        <div className="drawer-scroll" key={`${stack.length}-${current ? JSON.stringify(current) : ""}`}>
          {body}
        </div>
      </aside>
    </div>
  );
}
