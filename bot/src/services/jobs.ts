import { config } from "../config.js";
import { audit, db } from "../db.js";
import { t } from "../i18n.js";
import { bot, esc, InlineKeyboard, sendHr } from "../tg.js";
import { currentOrNextShift } from "../time.js";
import { createTask } from "./tasks.js";

export interface JobRequest {
  id: number;
  department: string;
  position: string;
  open_positions: number;
  requester: string | null;
  payload: string;
  status: "open" | "closed";
  group_message_id: number | null;
  created_at: string;
  closed_at: string | null;
}

export interface IncomingJob {
  department: string;
  position: string;
  openPositions: number;
  requester: string;
  /** Telegram-HTML message rendered by the website (same text as before) */
  html: string;
  fields: Record<string, unknown>;
}

export const getJob = (id: number) => (db.prepare("SELECT * FROM job_requests WHERE id = ?").get(id) as JobRequest | undefined) ?? null;

/**
 * Website → bot. The group message is the critical part: if it fails the website shows an error.
 * HR notification + task are best-effort extras.
 */
export async function receiveJob(j: IncomingJob): Promise<number> {
  const msg = await bot.api.sendMessage(config.jobsChatId, j.html, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  const info = db
    .prepare("INSERT INTO job_requests (department, position, open_positions, requester, payload, group_message_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(j.department, j.position, j.openPositions, j.requester, JSON.stringify({ html: j.html, fields: j.fields }), msg.message_id);
  const id = Number(info.lastInsertRowid);
  audit("website", "job_request", { id, position: j.position });

  try {
    const { task } = createTask({
      title: `Kandidat qidirish: ${j.position} × ${j.openPositions}`,
      description: `${j.department} · ${j.requester}`,
      shift_date: currentOrNextShift(),
      priority: 2,
      job_request_id: id,
    });
    await sendHr((lang) => ({
      html: t(lang, "job_new", {
        position: esc(j.position),
        count: j.openPositions,
        department: esc(j.department),
        requester: esc(j.requester),
        task: task.id,
      }),
      kb: new InlineKeyboard().text(t(lang, "btn_job_details"), `jr:${id}`),
    }));
  } catch (e) {
    console.error("job request HR notification failed", e);
  }
  return id;
}

export const jobHtml = (j: JobRequest) => {
  try {
    return (JSON.parse(j.payload) as { html: string }).html;
  } catch {
    return esc(j.position);
  }
};

export function listJobs(status?: "open" | "closed"): JobRequest[] {
  return (
    status
      ? db.prepare("SELECT * FROM job_requests WHERE status = ? ORDER BY id DESC LIMIT 50").all(status)
      : db.prepare("SELECT * FROM job_requests ORDER BY id DESC LIMIT 50").all()
  ) as JobRequest[];
}

export function setJobStatus(id: number, status: "open" | "closed") {
  db.prepare("UPDATE job_requests SET status = ?, closed_at = CASE WHEN ? = 'closed' THEN datetime('now') ELSE NULL END WHERE id = ?").run(status, status, id);
  return getJob(id);
}

/** Candidates per job request, for reports and the AI. */
export function jobPipeline(id: number) {
  return db
    .prepare("SELECT status, COUNT(*) n FROM candidates WHERE job_request_id = ? AND status != 'draft' GROUP BY status")
    .all(id) as { status: string; n: number }[];
}
