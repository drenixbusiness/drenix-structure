import { config } from "../config.js";
import { db } from "../db.js";
import { addMinutes, dowOf, local, shiftBounds } from "../time.js";
import { cancelPrefix, HR_CHAT, schedule } from "./notifications.js";

export const STATUSES = ["pending", "in_progress", "completed", "postponed", "cancelled", "blocked"] as const;
export type Status = (typeof STATUSES)[number];
export const OPEN: Status[] = ["pending", "in_progress", "postponed", "blocked"];

export interface Task {
  id: number;
  title: string;
  description: string | null;
  shift_date: string | null;
  start_at: string | null;
  duration_min: number | null;
  deadline_at: string | null;
  priority: number;
  status: Status;
  result: string | null;
  notes: string | null;
  recurrence: string | null;
  recurring_parent: number | null;
  depends_on: number | null;
  job_request_id: number | null;
  postponed_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  shift_date?: string | null;
  start_at?: Date | null;
  duration_min?: number | null;
  deadline_at?: Date | null;
  priority?: number;
  recurrence?: string | null;
  depends_on?: number | null;
  job_request_id?: number | null;
  recurring_parent?: number | null;
}

export const getTask = (id: number) => (db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined) ?? null;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Creates a task. The same title on the same day within 10 minutes is treated as a duplicate. */
export function createTask(input: TaskInput): { task: Task; duplicate: boolean } {
  const recent = db
    .prepare("SELECT * FROM tasks WHERE created_at > datetime('now', '-10 minutes') AND IFNULL(shift_date,'') = IFNULL(?, '')")
    .all(input.shift_date ?? null) as Task[];
  const dup = recent.find((t) => norm(t.title) === norm(input.title));
  if (dup) return { task: dup, duplicate: true };

  const blocked = input.depends_on ? getTask(input.depends_on)?.status !== "completed" : false;
  const info = db
    .prepare(
      `INSERT INTO tasks (title, description, shift_date, start_at, duration_min, deadline_at, priority, status, recurrence, depends_on, job_request_id, recurring_parent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.title.trim(),
      input.description ?? null,
      input.recurrence ? null : (input.shift_date ?? null),
      input.start_at?.toISOString() ?? null,
      input.duration_min ?? null,
      input.deadline_at?.toISOString() ?? null,
      clampPriority(input.priority),
      blocked ? "blocked" : "pending",
      input.recurrence ?? null,
      input.depends_on ?? null,
      input.job_request_id ?? null,
      input.recurring_parent ?? null,
    );
  const task = getTask(Number(info.lastInsertRowid))!;
  scheduleTaskReminders(task);
  // a recurring template immediately produces today's instance when it matches
  if (task.recurrence && input.shift_date && matchesRecurrence(task.recurrence, input.shift_date)) spawnFromTemplate(task, input.shift_date);
  return { task, duplicate: false };
}

const clampPriority = (p?: number) => Math.min(4, Math.max(1, Math.round(p ?? 3)));

export interface TaskPatch {
  title?: string;
  description?: string | null;
  shift_date?: string | null;
  start_at?: Date | null;
  duration_min?: number | null;
  deadline_at?: Date | null;
  priority?: number;
  status?: Status;
  result?: string | null;
  notes?: string | null;
  depends_on?: number | null;
}

export function updateTask(id: number, patch: TaskPatch): Task | null {
  const before = getTask(id);
  if (!before) return null;
  const cols: Record<string, unknown> = {};
  if (patch.title !== undefined) cols.title = patch.title.trim();
  if (patch.description !== undefined) cols.description = patch.description;
  if (patch.shift_date !== undefined) cols.shift_date = patch.shift_date;
  if (patch.start_at !== undefined) cols.start_at = patch.start_at?.toISOString() ?? null;
  if (patch.duration_min !== undefined) cols.duration_min = patch.duration_min;
  if (patch.deadline_at !== undefined) cols.deadline_at = patch.deadline_at?.toISOString() ?? null;
  if (patch.priority !== undefined) cols.priority = clampPriority(patch.priority);
  if (patch.result !== undefined) cols.result = patch.result;
  if (patch.notes !== undefined) cols.notes = patch.notes;
  if (patch.depends_on !== undefined) cols.depends_on = patch.depends_on;
  if (patch.status !== undefined) {
    cols.status = patch.status;
    cols.completed_at = patch.status === "completed" ? new Date().toISOString() : null;
  }
  // moving to another day counts as a postponement
  const moved = patch.shift_date !== undefined && before.shift_date && patch.shift_date !== before.shift_date;
  if (moved && patch.status === undefined && before.status !== "completed") cols.status = "postponed";
  if (moved || patch.status === "postponed") cols.postponed_count = before.postponed_count + 1;

  const keys = Object.keys(cols);
  if (!keys.length) return before;
  db.transaction(() => {
    db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map((k) => cols[k] as never), id);
    const hist = db.prepare("INSERT INTO task_history (task_id, field, old, new) VALUES (?, ?, ?, ?)");
    for (const k of keys) {
      const o = (before as unknown as Record<string, unknown>)[k];
      if (String(o ?? "") !== String(cols[k] ?? "")) hist.run(id, k, o == null ? null : String(o), cols[k] == null ? null : String(cols[k]));
    }
  })();
  const after = getTask(id)!;
  scheduleTaskReminders(after);
  if (after.status === "completed" && before.status !== "completed") unblockDependents(id);
  return after;
}

export function deleteTask(id: number): boolean {
  cancelPrefix(`task:${id}:`);
  return db.prepare("DELETE FROM tasks WHERE id = ?").run(id).changes > 0;
}

function unblockDependents(id: number) {
  const deps = db.prepare("SELECT id FROM tasks WHERE depends_on = ? AND status = 'blocked'").all(id) as { id: number }[];
  for (const d of deps) updateTask(d.id, { status: "pending" });
}

export function scheduleTaskReminders(t: Task) {
  cancelPrefix(`task:${t.id}:`);
  if (!OPEN.includes(t.status) || t.recurrence) return;
  const now = Date.now();
  if (t.start_at) {
    const at = addMinutes(new Date(t.start_at), -15);
    if (at.getTime() > now) schedule(`task:${t.id}:start:${t.start_at}`, HR_CHAT, "task_start", at, { taskId: t.id });
  }
  if (t.deadline_at) {
    const dl = new Date(t.deadline_at);
    const warn = addMinutes(dl, -60);
    if (warn.getTime() > now) schedule(`task:${t.id}:dl:${t.deadline_at}`, HR_CHAT, "task_deadline", warn, { taskId: t.id });
    if (dl.getTime() > now) schedule(`task:${t.id}:od:${t.deadline_at}`, HR_CHAT, "task_overdue", dl, { taskId: t.id });
  }
}

export interface TaskFilter {
  shift_date?: string;
  from_shift?: string;
  to_shift?: string;
  statuses?: Status[];
  query?: string;
  include_recurring_templates?: boolean;
  limit?: number;
}

export function listTasks(f: TaskFilter = {}): Task[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (!f.include_recurring_templates) where.push("recurrence IS NULL");
  if (f.shift_date) {
    where.push("shift_date = ?");
    args.push(f.shift_date);
  }
  if (f.from_shift) {
    where.push("shift_date >= ?");
    args.push(f.from_shift);
  }
  if (f.to_shift) {
    where.push("shift_date <= ?");
    args.push(f.to_shift);
  }
  if (f.statuses?.length) {
    where.push(`status IN (${f.statuses.map(() => "?").join(",")})`);
    args.push(...f.statuses);
  }
  if (f.query) {
    where.push("(title LIKE ? OR IFNULL(description,'') LIKE ? OR IFNULL(result,'') LIKE ? OR IFNULL(notes,'') LIKE ?)");
    const q = `%${f.query}%`;
    args.push(q, q, q, q);
  }
  const sql = `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY shift_date IS NULL, shift_date, start_at IS NULL, start_at, priority, id LIMIT ?`;
  return db.prepare(sql).all(...args, f.limit ?? 100) as Task[];
}

/** Tasks belonging to a workday, plus undated open tasks (backlog) when asked. */
export const tasksForShift = (sd: string) => listTasks({ shift_date: sd, limit: 200 });
export const backlog = () =>
  db.prepare("SELECT * FROM tasks WHERE recurrence IS NULL AND shift_date IS NULL AND status IN ('pending','in_progress','blocked','postponed') ORDER BY priority, id LIMIT 50").all() as Task[];

// ---------- recurring ----------

export function matchesRecurrence(rule: string, sd: string): boolean {
  const dow = dowOf(sd);
  if (rule === "daily") return true;
  if (rule === "weekdays") return dow >= 1 && dow <= 5;
  if (rule.startsWith("weekly:")) return rule.slice(7).split(",").map(Number).includes(dow);
  if (rule.startsWith("monthly:")) return Number(sd.slice(8, 10)) === Number(rule.slice(8));
  return false;
}

function spawnFromTemplate(tpl: Task, sd: string) {
  const exists = db.prepare("SELECT 1 FROM tasks WHERE recurring_parent = ? AND shift_date = ?").get(tpl.id, sd);
  if (exists) return;
  // keep the template's clock time on the new day
  let start: Date | null = null;
  if (tpl.start_at) {
    const p = local(new Date(tpl.start_at));
    const offset = (p.h * 60 + p.min - config.shiftStart + 1440) % 1440;
    start = addMinutes(shiftBounds(sd).start, offset);
  }
  createTask({
    title: tpl.title,
    description: tpl.description,
    shift_date: sd,
    start_at: start,
    duration_min: tpl.duration_min,
    priority: tpl.priority,
    recurring_parent: tpl.id,
  });
}

/** Called at the start of each workday. */
export function spawnRecurring(sd: string) {
  const templates = db.prepare("SELECT * FROM tasks WHERE recurrence IS NOT NULL AND status != 'cancelled'").all() as Task[];
  for (const tpl of templates) if (matchesRecurrence(tpl.recurrence!, sd)) spawnFromTemplate(tpl, sd);
}

export const PRIORITY_LABEL: Record<number, string> = { 1: "P1", 2: "P2", 3: "P3", 4: "P4" };
