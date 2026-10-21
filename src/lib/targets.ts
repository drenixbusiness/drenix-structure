import { DEPT_BY_KEY, EXECS, JOB_DESCRIPTIONS, OWNER, type DeptKey, type ExecNode, type FleetModel, type JobDescription } from "@/data/drenix-data";
import { execManages, jdsFor, managesFor } from "./org";

/** Something whose job description can be opened. */
export type JDTarget =
  | { kind: "role"; dept: DeptKey; roleId: string }
  | { kind: "exec"; key: ExecNode["key"] }
  | { kind: "owner" };

export interface ResolvedPosition {
  kicker: string;
  title: string;
  seats: number;
  reportsTo: string;
  manages: string[];
  workplace: string;
  jds: JobDescription[];
  /** Static text for positions without a JD document (Owner) */
  staticText?: string;
}

export function resolveTarget(t: JDTarget, m: FleetModel): ResolvedPosition | null {
  if (t.kind === "owner") {
    return {
      kicker: "Drenix Holding",
      title: OWNER.title,
      seats: 1,
      reportsTo: "—",
      manages: ["CEO", "Advisor / Consultant (advisory)"],
      workplace: "—",
      jds: [],
      staticText: OWNER.description,
    };
  }
  if (t.kind === "exec") {
    const e = EXECS[t.key];
    const jd = JOB_DESCRIPTIONS[e.jd];
    return {
      kicker: t.key === "advisor" ? "Advisory" : jd.department,
      title: jd.title,
      seats: 1,
      reportsTo: jd.reportsTo,
      manages: execManages(m, t.key),
      workplace: jd.workplace,
      jds: [jd],
    };
  }
  const role = m.departments[t.dept].roles.find((r) => r.id === t.roleId);
  if (!role) return null;
  const jds = jdsFor(role);
  return {
    kicker: DEPT_BY_KEY[t.dept].name,
    title: role.title,
    seats: role.count,
    reportsTo: jds[0].reportsTo,
    manages: managesFor(m, t.dept, role),
    workplace: jds[0].workplace,
    jds,
  };
}

export const targetKey = (t: JDTarget) =>
  t.kind === "role" ? `role:${t.dept}:${t.roleId}` : t.kind === "exec" ? `exec:${t.key}` : "owner";
