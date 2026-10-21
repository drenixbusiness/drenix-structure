import {
  DEPARTMENTS,
  DEPT_BY_KEY,
  EXECS,
  FLEET_MODELS,
  JOB_DESCRIPTIONS,
  TRUCK_STOPS,
  type DeptKey,
  type ExecNode,
  type FleetModel,
  type JobDescription,
  type RoleSeat,
  type TruckStop,
} from "@/data/drenix-data";

export function snapTrucks(n: number): TruckStop {
  let best: TruckStop = TRUCK_STOPS[0];
  for (const s of TRUCK_STOPS) if (Math.abs(s - n) < Math.abs(best - n)) best = s;
  return best;
}

export const modelFor = (t: TruckStop): FleetModel => FLEET_MODELS[t];

export const deptCount = (m: FleetModel, k: DeptKey) =>
  m.departments[k].roles.reduce((s, r) => s + r.count, 0);

export const totalStaff = (m: FleetModel) => DEPARTMENTS.reduce((s, d) => s + deptCount(m, d.key), 0);

export const cooStaff = (m: FleetModel) =>
  DEPARTMENTS.filter((d) => d.parent === "COO").reduce((s, d) => s + deptCount(m, d.key), 0);

export interface RoleView extends RoleSeat {
  /** change vs previous selection (0 when unchanged / no previous) */
  delta: number;
  isNew: boolean;
  removed?: boolean;
}

export interface DeptView {
  key: DeptKey;
  count: number;
  delta: number;
  roles: RoleView[];
  removed: RoleView[];
  coveredBy?: string;
}

/** Lead first, then the rest in model order. */
const ordered = (roles: RoleSeat[]) => [...roles.filter((r) => r.lead), ...roles.filter((r) => !r.lead)];

export function deptView(cur: FleetModel, prev: FleetModel | null, key: DeptKey): DeptView {
  const curD = cur.departments[key];
  const prevRoles = prev ? prev.departments[key].roles : null;
  const roles: RoleView[] = ordered(curD.roles).map((role) => {
    const before = prevRoles?.find((p) => p.id === role.id);
    return {
      ...role,
      delta: prevRoles ? role.count - (before?.count ?? 0) : 0,
      isNew: !!prevRoles && !before,
    };
  });
  const removed: RoleView[] = prevRoles
    ? prevRoles
        .filter((p) => !curD.roles.some((c) => c.id === p.id))
        .map((p) => ({ ...p, delta: -p.count, isNew: false, removed: true }))
    : [];
  const count = deptCount(cur, key);
  return {
    key,
    count,
    delta: prev ? count - deptCount(prev, key) : 0,
    roles,
    removed,
    coveredBy: curD.coveredBy,
  };
}

export const jdsFor = (role: RoleSeat): JobDescription[] => role.jds.map((k) => JOB_DESCRIPTIONS[k]);

export const leadRole = (m: FleetModel, k: DeptKey) => {
  const roles = m.departments[k].roles;
  return roles.find((r) => r.lead) ?? roles[0];
};

/** Titles of positions a role manages at the current size. */
export function managesFor(m: FleetModel, k: DeptKey, role: RoleSeat): string[] {
  const roles = m.departments[k].roles;
  if (!role.lead || roles.length < 2) return [];
  return roles.filter((r) => r.id !== role.id).map((r) => r.title);
}

export function execManages(m: FleetModel, key: ExecNode["key"]): string[] {
  if (key === "cfo") {
    return m.departments.cfo.roles
      .filter((r) => r.lead || r.jds.includes("finAn"))
      .map((r) => r.title);
  }
  if (key === "coo") {
    return DEPARTMENTS.filter((d) => d.parent === "COO").map((d) => {
      const l = leadRole(m, d.key);
      return l ? l.title : `${d.shortName} (${m.departments[d.key].coveredBy ?? "—"})`;
    });
  }
  return EXECS[key].manages;
}

export const deptParentLabel = (k: DeptKey) => DEPT_BY_KEY[k].parent;

export const fmtDelta = (d: number) => (d > 0 ? `▲ ${d}` : d < 0 ? `▼ ${Math.abs(d)}` : "");
export const fmtSigned = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : "");
