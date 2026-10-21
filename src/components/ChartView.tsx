"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DEPARTMENTS, JOB_DESCRIPTIONS, type Department, type DeptKey, type FleetModel } from "@/data/drenix-data";
import { cooStaff, deptView, type DeptView, type RoleView } from "@/lib/org";
import type { JDTarget } from "@/lib/targets";
import { useCanHover } from "@/lib/hooks";
import { DeltaPill, DeltaSmall, Icon, Logo, NewBadge, Num } from "./ui";

interface Props {
  model: FleetModel;
  prevModel: FleetModel | null;
  changeKey: number;
  active: boolean;
  onOpen: (t: JDTarget) => void;
  onOpenDept: (d: DeptKey) => void;
}

type NodeId = "owner" | "advisor" | "ceo" | "coo" | DeptKey;
type Hover = { dept: DeptKey; roleId: string; rect: DOMRect } | null;

const COO_DEPTS = DEPARTMENTS.filter((d) => d.parent === "COO");
const CEO_DEPTS = DEPARTMENTS.filter((d) => d.parent === "CEO");

// ---------------------------------------------------------------------------- geometry helpers

function boxOf(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight, cx: x + el.offsetWidth / 2, b: y + el.offsetHeight };
}

function elbow(x1: number, y1: number, x2: number, y2: number, yb: number, r = 12) {
  if (Math.abs(x2 - x1) < 1) return `M${x1} ${y1} V${y2}`;
  const dir = x2 > x1 ? 1 : -1;
  const rr = Math.max(0, Math.min(r, Math.abs(x2 - x1) / 2, yb - y1, y2 - yb));
  return `M${x1} ${y1} V${yb - rr} Q${x1} ${yb} ${x1 + dir * rr} ${yb} H${x2 - dir * rr} Q${x2} ${yb} ${x2} ${yb + rr} V${y2}`;
}

interface Links {
  w: number;
  h: number;
  solid: string[];
  dashed: string[];
}

// ---------------------------------------------------------------------------- department card

function DeptCard({
  dept,
  view,
  changeKey,
  hoverRoleId,
  onRoleEnter,
  onRoleLeave,
  onRoleClick,
  onHead,
  onExpand,
}: {
  onExpand: () => void;
  dept: Department;
  view: DeptView;
  changeKey: number;
  hoverRoleId: string | null;
  onRoleEnter: (roleId: string, el: HTMLElement) => void;
  onRoleLeave: () => void;
  onRoleClick: (roleId: string) => void;
  onHead?: () => void;
}) {
  const [exiting, setExiting] = useState<RoleView[]>([]);
  useEffect(() => {
    if (!view.removed.length) return;
    setExiting(view.removed);
    const t = setTimeout(() => setExiting([]), 520);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeKey]);

  const seats = view.roles.flatMap((r) =>
    Array.from({ length: r.count }, (_, i) => ({ key: `${r.id}-${i}`, roleId: r.id, lead: !!r.lead && i === 0 })),
  );
  const empty = view.count === 0;

  return (
    <div className={`card dept ${empty ? "empty" : ""}`}>
      {/* clicking the header (outside its buttons) opens the whole department */}
      <div className="dept-head" onClick={(e) => !(e.target as HTMLElement).closest("button") && onExpand()}>
        <div className="dept-top">
          <span>{dept.parent}</span>
          <button type="button" className="dept-expand" onClick={onExpand} aria-label={`Open ${dept.name}: all positions`} title="All positions">
            {Icon.expand}
          </button>
        </div>
        {onHead ? (
          <button type="button" className="dept-name dept-name-btn" onClick={onHead} title="Open CFO job description">
            {dept.name}
            <span className="dept-head-link">Department head ›</span>
          </button>
        ) : (
          <div className="dept-name">{dept.name}</div>
        )}
        <div className="dept-count">
          <span className="big">
            (<Num value={view.count} />)
          </span>
          <DeltaPill delta={view.delta} k={changeKey} />
        </div>
        <div className="seats" aria-hidden="true">
          {seats.map((s) => (
            <span key={s.key} className={`seat ${s.lead ? "lead" : ""} ${hoverRoleId === s.roleId ? "hl" : ""}`} />
          ))}
        </div>
      </div>
      {empty ? (
        <div className="covered">{view.coveredBy}</div>
      ) : (
        <ul className="roles">
          {view.roles.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={`role ${r.lead ? "lead" : ""} ${hoverRoleId === r.id ? "hl" : ""}`}
                onPointerEnter={(e) => e.pointerType === "mouse" && onRoleEnter(r.id, e.currentTarget)}
                onPointerLeave={onRoleLeave}
                onFocus={(e) => onRoleEnter(r.id, e.currentTarget)}
                onBlur={onRoleLeave}
                onClick={() => onRoleClick(r.id)}
              >
                <span className="dot" />
                <span className="role-title">{r.title}</span>
                <span className="role-right">
                  {r.isNew && <NewBadge />}
                  {!r.isNew && <DeltaSmall delta={r.delta} />}
                  <span>×{r.count}</span>
                </span>
              </button>
            </li>
          ))}
          {exiting.map((r) => (
            <li key={`x-${r.id}`} className="role-exit" aria-hidden="true">
              <span className="role" style={{ animation: "none" }}>
                <span className="dot" />
                <span className="role-title">{r.title}</span>
                <span className="role-right">
                  <DeltaSmall delta={r.delta} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ul className="resp">
        {dept.responsibilities.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------- chart

export function ChartView({ model, prevModel, changeKey, active, onOpen, onOpenDept }: Props) {
  const vpRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodes = useRef<Partial<Record<NodeId, HTMLDivElement | null>>>({});
  const xf = useRef({ x: 0, y: 0, s: 1, minS: 0.3, touched: false });
  const [pannable, setPannable] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fitMode, setFitMode] = useState(false);
  const [links, setLinks] = useState<Links>({ w: 0, h: 0, solid: [], dashed: [] });
  const [hover, setHover] = useState<Hover>(null);
  const canHover = useCanHover();

  const views = Object.fromEntries(DEPARTMENTS.map((d) => [d.key, deptView(model, prevModel, d.key)])) as Record<
    DeptKey,
    DeptView
  >;
  const cooN = cooStaff(model);
  const cooDelta = prevModel ? cooN - cooStaff(prevModel) : 0;

  // ------------------------------------------------------------ transform
  const apply = useCallback(() => {
    const { x, y, s } = xf.current;
    // 2D transform on whole pixels: the browser re-rasterises text at the final scale (sharp)
    if (stageRef.current) stageRef.current.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${s.toFixed(4)})`;
  }, []);

  const clamp = useCallback(() => {
    const vp = vpRef.current;
    const cv = canvasRef.current;
    if (!vp || !cv) return;
    const t = xf.current;
    const W = vp.clientWidth;
    const H = vp.clientHeight;
    const cw = cv.offsetWidth * t.s;
    const ch = cv.offsetHeight * t.s;
    const m = 24;
    t.x = cw <= W ? (W - cw) / 2 : Math.min(m, Math.max(W - cw - m, t.x));
    t.y = ch <= H ? (H - ch) / 2 : Math.min(m, Math.max(H - ch - m, t.y));
    setPannable(cw > W + 1 || ch > H + 1);
  }, []);

  const layout = useCallback(
    (reset: boolean) => {
      const vp = vpRef.current;
      const cv = canvasRef.current;
      if (!vp || !cv) return;
      const W = vp.clientWidth;
      const H = vp.clientHeight;
      if (!W || !H) return;
      const cw = cv.offsetWidth;
      const ch = cv.offsetHeight;
      const fit = Math.min(W / cw, H / ch);
      const compact = W < 760 || H < 520;
      const t = xf.current;
      t.minS = Math.min(fit, 0.95);
      if (reset || !t.touched) {
        if (fitMode) t.s = fit;
        else if (compact) t.s = Math.max(fit, 0.96);
        else t.s = Math.min(Math.max(fit, 0.62), 1.12);
        const w = cw * t.s;
        t.x = (W - w) / 2;
        t.y = ch * t.s <= H ? (H - ch * t.s) / 2 : 12;
      }
      clamp();
      apply();
    },
    [apply, clamp, fitMode],
  );

  // ------------------------------------------------------------ links
  const computeLinks = useCallback(() => {
    const root = canvasRef.current;
    const n = nodes.current;
    if (!root || !n.owner || !n.ceo || !n.coo) return;
    const B = (id: NodeId) => boxOf(n[id] as HTMLDivElement, root);
    const owner = B("owner");
    const advisor = B("advisor");
    const ceo = B("ceo");
    const l2 = (["coo", ...CEO_DEPTS.map((d) => d.key)] as NodeId[]).map(B);
    const l3 = COO_DEPTS.map((d) => B(d.key));
    const coo = l2[0];
    const solid: string[] = [];
    solid.push(`M${owner.cx} ${owner.b} V${ceo.y}`);
    const bus1 = (ceo.b + Math.min(...l2.map((b) => b.y))) / 2;
    l2.forEach((b) => solid.push(elbow(ceo.cx, ceo.b, b.cx, b.y, bus1)));
    // CFO / UZB HR / IT are full-height columns beside the COO zone, so the COO bus sits
    // between the COO card and its five departments only
    const l3Top = Math.min(...l3.map((b) => b.y));
    const bus2 = (coo.b + l3Top) / 2;
    l3.forEach((b) => solid.push(elbow(coo.cx, coo.b, b.cx, b.y, bus2)));
    const dashed = [`M${owner.x + owner.w} ${owner.y + owner.h / 2} H${advisor.x}`];
    setLinks({ w: root.offsetWidth, h: root.offsetHeight, solid, dashed });
  }, []);

  useLayoutEffect(() => {
    computeLinks();
    layout(false);
  }, [model, computeLinks, layout]);

  useEffect(() => {
    const vp = vpRef.current;
    const cv = canvasRef.current;
    if (!vp || !cv) return;
    const ro = new ResizeObserver(() => {
      computeLinks();
      layout(false);
    });
    ro.observe(vp);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [computeLinks, layout]);

  useEffect(() => {
    if (active) {
      xf.current.touched = false;
      layout(true);
    }
  }, [active, layout]);

  // re-run once fonts are ready (card heights change)
  useEffect(() => {
    document.fonts?.ready.then(() => {
      computeLinks();
      layout(true);
    });
  }, [computeLinks, layout]);

  // ------------------------------------------------------------ pointer: pan / pinch / tilt
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, sx: 0, sy: 0, ox: 0, oy: 0, pinch: null as null | { d: number; s: number; mx: number; my: number; x: number; y: number } });
  const suppressClick = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (ptrs.current.size === 1) {
      g.moved = false;
      g.sx = e.clientX;
      g.sy = e.clientY;
      g.ox = xf.current.x;
      g.oy = xf.current.y;
      g.pinch = null;
    } else if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      const r = vpRef.current!.getBoundingClientRect();
      g.pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y),
        s: xf.current.s,
        mx: (a.x + b.x) / 2 - r.left,
        my: (a.y + b.y) / 2 - r.top,
        x: xf.current.x,
        y: xf.current.y,
      };
      g.moved = true;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const vp = vpRef.current;
    if (!vp) return;
    // desktop tilt — only while the mouse moves; settles flat (transform: none) when it rests
    if (e.pointerType === "mouse" && canHover && ptrs.current.size === 0 && tiltRef.current) {
      const r = vp.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      tiltRef.current.style.transform = `perspective(2200px) rotateX(${(-py * 3).toFixed(2)}deg) rotateY(${(px * 4).toFixed(2)}deg)`;
      scheduleFlat(900);
    }
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const t = xf.current;
    if (g.pinch && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const s = Math.min(1.8, Math.max(t.minS, (g.pinch.s * d) / g.pinch.d));
      t.x = g.pinch.mx - (g.pinch.mx - g.pinch.x) * (s / g.pinch.s);
      t.y = g.pinch.my - (g.pinch.my - g.pinch.y) * (s / g.pinch.s);
      t.s = s;
      t.touched = true;
      clamp();
      apply();
      return;
    }
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) > 6) {
      g.moved = true;
      setDragging(true);
      setHover(null);
      try {
        vp.setPointerCapture(e.pointerId);
      } catch {}
    }
    if (g.moved) {
      t.x = g.ox + dx;
      t.y = g.oy + dy;
      t.touched = true;
      clamp();
      apply();
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    const g = gesture.current;
    if (ptrs.current.size === 0) {
      if (g.moved) suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      setDragging(false);
      g.pinch = null;
    } else if (ptrs.current.size === 1) {
      // continue panning with the remaining finger
      const [p] = [...ptrs.current.values()];
      g.sx = p.x;
      g.sy = p.y;
      g.ox = xf.current.x;
      g.oy = xf.current.y;
      g.pinch = null;
    }
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick.current = false;
    }
  };

  const flatTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function scheduleFlat(delay: number) {
    clearTimeout(flatTimer.current);
    flatTimer.current = setTimeout(() => {
      const el = tiltRef.current;
      if (!el) return;
      el.style.transform = "perspective(2200px) rotateX(0deg) rotateY(0deg)";
      // after the ease-back, drop the 3D transform entirely so text is rasterised crisply
      flatTimer.current = setTimeout(() => (el.style.transform = "none"), 650);
    }, delay);
  }
  useEffect(() => () => clearTimeout(flatTimer.current), []);

  const onLeave = () => scheduleFlat(0);

  // ------------------------------------------------------------ role hover popover (desktop only)
  const onRoleEnter = (dept: DeptKey) => (roleId: string, el: HTMLElement) => {
    if (!canHover || dragging) return;
    setHover({ dept, roleId, rect: el.getBoundingClientRect() });
  };
  const onRoleLeave = () => setHover(null);

  const openRole = (dept: DeptKey) => (roleId: string) => {
    setHover(null);
    onOpen({ kind: "role", dept, roleId });
  };

  const setNode = (id: NodeId) => (el: HTMLDivElement | null) => {
    nodes.current[id] = el;
  };

  const card = (d: Department) => (
    <div key={d.key} ref={setNode(d.key)} className="float" style={{ animationDelay: `${-d.index * 0.7}s` }}>
      <DeptCard
        dept={d}
        view={views[d.key]}
        changeKey={changeKey}
        hoverRoleId={hover?.dept === d.key ? hover.roleId : null}
        onRoleEnter={onRoleEnter(d.key)}
        onRoleLeave={onRoleLeave}
        onRoleClick={openRole(d.key)}
        onHead={d.headExec ? () => onOpen({ kind: "exec", key: d.headExec! }) : undefined}
        onExpand={() => {
          setHover(null);
          onOpenDept(d.key);
        }}
      />
    </div>
  );

  // popover content
  let popover: React.ReactNode = null;
  if (hover && vpRef.current) {
    const role = model.departments[hover.dept].roles.find((r) => r.id === hover.roleId);
    if (role) {
      const vr = vpRef.current.getBoundingClientRect();
      const jd = JOB_DESCRIPTIONS[role.jds[0]];
      const width = 300;
      let left = hover.rect.right - vr.left + 12;
      if (left + width > vr.width - 8) left = hover.rect.left - vr.left - width - 12;
      const top = Math.max(8, Math.min(hover.rect.top - vr.top - 8, vr.height - 290));
      popover = (
        <div className="popover" style={{ left, top }} role="tooltip">
          <h4>{role.title}</h4>
          <p>{jd.purpose}</p>
          <ul>
            {jd.duties.slice(0, 3).map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          {role.jds.length > 1 && <div className="hint">Combines {role.jds.length} job descriptions</div>}
          <div className="hint">Click to open the full job description</div>
        </div>
      );
    }
  }

  return (
    <div
      ref={vpRef}
      className={`chart-viewport ${pannable ? "pannable" : ""} ${dragging ? "dragging" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onPointerLeave={onLeave}
      onClickCapture={onClickCapture}
    >
      <div ref={stageRef} className="chart-stage">
        <div ref={tiltRef} className="chart-tilt">
          <div ref={canvasRef} className="chart-canvas">
            <svg className="chart-links" viewBox={`0 0 ${links.w || 1} ${links.h || 1}`} aria-hidden="true">
              <defs>
                <filter id="pulseGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2.4" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {links.solid.map((d, i) => (
                <g key={i}>
                  <path className="link-glow" d={d} />
                  <path className="link-base" d={d} />
                  <path
                    className="link-pulse"
                    d={d}
                    pathLength={100}
                    filter="url(#pulseGlow)"
                    style={{ animationDelay: `${-(i * 0.37) % 2.8}s` }}
                  />
                </g>
              ))}
              {links.dashed.map((d, i) => (
                <path key={`d${i}`} className="link-dashed" d={d} />
              ))}
            </svg>

            <div className="row row-top">
              <span />
              <div ref={setNode("owner")} className="float">
                <button type="button" className="card exec exec-owner" onClick={() => onOpen({ kind: "owner" })}>
                  <Logo size={28} />
                  <span>
                    <div className="exec-title">OWNER</div>
                    <div className="exec-sub">Strategic Direction · Business Growth</div>
                  </span>
                </button>
              </div>
              <div className="advisor-slot">
                <div ref={setNode("advisor")} className="float" style={{ animationDelay: "-2s" }}>
                  <button type="button" className="card exec exec-advisor" onClick={() => onOpen({ kind: "exec", key: "advisor" })}>
                    <span>
                      <div className="exec-kicker">ADVISORY</div>
                      <div className="exec-title" style={{ fontSize: 13.5, letterSpacing: "0.04em" }}>
                        Advisor / Consultant
                      </div>
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <div className="row">
              <div ref={setNode("ceo")} className="float" style={{ animationDelay: "-1s" }}>
                <button type="button" className="card exec exec-ceo" onClick={() => onOpen({ kind: "exec", key: "ceo" })}>
                  <div className="exec-title">CEO</div>
                  <div className="exec-sub">Chief Executive Officer</div>
                </button>
              </div>
            </div>

            {/* COO, CFO, UZB HR and IT share one level under the CEO:
                the COO zone (with its 5 departments) on the left, three full-height columns on the right */}
            <div className="org-grid">
              <div className="coo-zone">
                <div className="coo-head">
                  <div ref={setNode("coo")} className="float" style={{ animationDelay: "-3s" }}>
                    <button type="button" className="card exec exec-coo" onClick={() => onOpen({ kind: "exec", key: "coo" })}>
                      <span className="coo-left">
                        <span className="exec-kicker">CEO · OPERATIONS</span>
                        <span className="exec-title">COO</span>
                        <span className="exec-sub">Chief Operating Officer · 5 departments</span>
                      </span>
                      <span className="coo-num">
                        (<Num value={cooN} />)
                        <DeltaPill delta={cooDelta} k={changeKey} />
                      </span>
                    </button>
                  </div>
                </div>
                <div className="coo-depts">{COO_DEPTS.map(card)}</div>
              </div>
              {CEO_DEPTS.map(card)}
            </div>
          </div>
        </div>
      </div>

      {popover}

      <div className="chart-tools">
        {pannable || fitMode ? (
          <button
            type="button"
            className="btn"
            aria-label={fitMode ? "Show readable size" : "Fit whole chart"}
            onClick={() => {
              setFitMode((f) => !f);
              xf.current.touched = false;
            }}
          >
            {Icon.fit}
            {fitMode ? "Readable" : "Fit"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
