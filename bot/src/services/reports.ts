/**
 * Reports (TZ §9). Formulas:
 *   Completion Rate = Completed / Total Due × 100%
 *   Overdue Rate    = Overdue / Total Due × 100%
 *   Growth Rate     = (Current − Previous) / Previous × 100%  (not computed when Previous = 0)
 */
import PDFDocument from "pdfkit";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { config } from "../config.js";
import { modelOpts, openai } from "../ai/client.js";
import { db } from "../db.js";
import * as gcal from "../google/calendar.js";
import { LANG_NAME, t, type Lang } from "../i18n.js";
import { esc } from "../tg.js";
import { addDays, fmtDay, isoLocal, isWorkday, shiftBounds, shiftDateOf } from "../time.js";
import type { Task } from "./tasks.js";

export type Period = "day" | "week" | "month";

export interface DayStat {
  shift_date: string;
  total: number;
  completed: number;
  rate: number | null;
}

export interface Stats {
  period: Period;
  from: string;
  to: string;
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  postponed: number;
  completionRate: number | null;
  overdueRate: number | null;
  meetings: number;
  confirmedInterviews: number;
  cancelledMeetings: number;
  byDay: DayStat[];
  bestDay: DayStat | null;
  overdueItems: { id: number; title: string; shift_date: string | null; postponed: number }[];
  growth: number | null;
  previousRate: number | null;
  topTasks: string[];
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function periodRange(period: Period, anchor?: string): { from: string; to: string } {
  // reports look back from the workday that is running / just finished
  const end = anchor ?? lastRelevantShift();
  const len = period === "day" ? 1 : period === "week" ? 7 : 30;
  return { from: addDays(end, -(len - 1)), to: end };
}

function lastRelevantShift(): string {
  const now = new Date();
  const sd = shiftDateOf(now);
  // before today's shift starts, "today's report" means the previous workday
  if (now < shiftBounds(sd).start) {
    let d = addDays(sd, -1);
    for (let i = 0; i < 7 && !isWorkday(d); i++) d = addDays(d, -1);
    return d;
  }
  return sd;
}

function isOverdue(task: Task, now: Date): boolean {
  if (task.status === "completed" || task.status === "cancelled") return false;
  if (task.deadline_at && new Date(task.deadline_at) < now) return true;
  return !!task.shift_date && shiftBounds(task.shift_date).end < now;
}

export async function computeStats(period: Period, anchor?: string, withPrevious = true): Promise<Stats> {
  const { from, to } = periodRange(period, anchor);
  const now = new Date();
  const tasks = db
    .prepare("SELECT * FROM tasks WHERE recurrence IS NULL AND status != 'cancelled' AND shift_date BETWEEN ? AND ?")
    .all(from, to) as Task[];
  const completed = tasks.filter((x) => x.status === "completed");
  const overdue = tasks.filter((x) => isOverdue(x, now));
  const pending = tasks.filter((x) => x.status !== "completed" && !isOverdue(x, now));
  const postponed = (db.prepare("SELECT COUNT(*) n FROM task_history WHERE field = 'shift_date' AND old BETWEEN ? AND ?").get(from, to) as { n: number }).n;

  const fromDate = shiftBounds(from).start;
  const toDate = shiftBounds(to).end;
  const meetRows = db
    .prepare("SELECT kind, status, candidate_id, calendar_event_id FROM meetings WHERE start_at >= ? AND start_at < ?")
    .all(fromDate.toISOString(), toDate.toISOString()) as { kind: string; status: string; candidate_id: number | null; calendar_event_id: string | null }[];
  let meetings = meetRows.filter((m) => m.status !== "cancelled").length;
  if (gcal.googleConnected()) {
    try {
      const ours = new Set(meetRows.map((m) => m.calendar_event_id));
      const evs = await gcal.listEvents(fromDate, toDate);
      meetings += evs.filter((e) => !gcal.isAllDay(e) && !ours.has(e.id)).length;
    } catch (e) {
      console.warn("report: calendar unavailable", (e as Error).message);
    }
  }
  const confirmedInterviews = meetRows.filter((m) => m.kind === "interview" && m.status !== "cancelled").length;
  const cancelledMeetings = meetRows.filter((m) => m.status === "cancelled").length;

  const byDay: DayStat[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isWorkday(d)) continue;
    const dayTasks = tasks.filter((x) => x.shift_date === d);
    const c = dayTasks.filter((x) => x.status === "completed").length;
    byDay.push({ shift_date: d, total: dayTasks.length, completed: c, rate: pct(c, dayTasks.length) });
  }
  const bestDay =
    period === "day" ? null : byDay.filter((d) => d.total > 0).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || b.completed - a.completed)[0] ?? null;

  const completionRate = pct(completed.length, tasks.length);
  let growth: number | null = null;
  let previousRate: number | null = null;
  if (withPrevious) {
    const prev = await computeStats(period, addDays(from, -1), false).catch(() => null);
    previousRate = prev?.completionRate ?? null;
    if (previousRate && completionRate !== null) growth = Math.round(((completionRate - previousRate) / previousRate) * 1000) / 10;
  }

  return {
    period,
    from,
    to,
    total: tasks.length,
    completed: completed.length,
    pending: pending.length,
    overdue: overdue.length,
    postponed,
    completionRate,
    overdueRate: pct(overdue.length, tasks.length),
    meetings,
    confirmedInterviews,
    cancelledMeetings,
    byDay,
    bestDay,
    overdueItems: overdue.slice(0, 15).map((x) => ({ id: x.id, title: x.title, shift_date: x.shift_date, postponed: x.postponed_count })),
    growth,
    previousRate,
    topTasks: tasks.slice(0, 40).map((x) => `${x.status === "completed" ? "✓" : "·"} ${x.title}`),
  };
}

/** Short AI recommendations grounded only in the numbers (TZ §10: estimates are not facts). */
export async function recommendations(s: Stats, lang: Lang): Promise<string[]> {
  if (s.total === 0) return [];
  try {
    const r = await openai.chat.completions.create({
      model: config.openaiModel,
      ...modelOpts(0.3),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an HR productivity advisor. Using ONLY the JSON stats, write 3 short, concrete recommendations in ${LANG_NAME[lang]}. Mention recurring delays, workload balance, splitting big tasks or re-prioritising when the data supports it. Mark estimates as estimates. Answer as JSON: {"recommendations": ["…", "…", "…"]}, one sentence each, no markdown.`,
        },
        { role: "user", content: JSON.stringify(s) },
      ],
    });
    const parsed = JSON.parse(r.choices[0].message.content ?? "{}") as { recommendations?: unknown };
    return (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
      .filter((x): x is string => typeof x === "string" && !!x.trim())
      .map((x) => x.trim())
      .slice(0, 4);
  } catch (e) {
    console.warn("recommendations failed", (e as Error).message);
    return [];
  }
}

const fmtPct = (v: number | null, lang: Lang) => (v === null ? t(lang, "r_na") : `${v}%`);
const titleKey: Record<Period, string> = { day: "r_daily", week: "r_weekly", month: "r_monthly" };

export function periodLabel(s: Stats, lang: Lang) {
  return s.from === s.to ? fmtDay(s.from, lang, true) : `${fmtDay(s.from, lang)} — ${fmtDay(s.to, lang)}`;
}

/** Extra block appended to a report (e.g. recruiting numbers from the Google Sheet). */
export interface ReportSection {
  title: string;
  lines: string[];
}

export function reportText(s: Stats, lang: Lang, recs: string[] = [], extra: ReportSection[] = []): string {
  const L = (k: string) => t(lang, k);
  const lines = [
    `📊 <b>${L(titleKey[s.period])}</b> · ${periodLabel(s, lang)}`,
    "",
    `${L("r_total")}: <b>${s.total}</b>`,
    `${L("r_completed")}: <b>${s.completed}</b>`,
    `${L("r_pending")}: <b>${s.pending}</b>`,
    `${L("r_overdue")}: <b>${s.overdue}</b>`,
    `${L("r_rate")}: <b>${fmtPct(s.completionRate, lang)}</b>`,
    `${L("r_overdue_rate")}: ${fmtPct(s.overdueRate, lang)}`,
    `${L("r_meetings")}: ${s.meetings}`,
    `${L("r_interviews")}: ${s.confirmedInterviews}`,
    `${L("r_cancelled")}: ${s.cancelledMeetings}`,
    `${L("r_postponed")}: ${s.postponed}`,
  ];
  if (s.period !== "day") {
    if (s.bestDay) lines.push(`${L("r_best_day")}: ${fmtDay(s.bestDay.shift_date, lang, true)} (${fmtPct(s.bestDay.rate, lang)})`);
    lines.push(`${L("r_growth")}: ${s.growth === null ? L("r_na") : `${s.growth > 0 ? "+" : ""}${s.growth}%`}`);
    const bars = s.byDay.map((d) => `<code>${fmtDay(d.shift_date, lang).padEnd(12)}</code> ${bar(d.rate)} ${d.completed}/${d.total}`);
    if (bars.length) lines.push("", `<b>${L("r_by_day")}</b>`, ...bars);
  }
  if (s.overdueItems.length) lines.push("", `<b>${L("r_overdue_list")}</b>`, ...s.overdueItems.slice(0, 8).map((o) => `• #${o.id} ${esc(o.title)}`));
  for (const x of extra) lines.push("", `<b>${esc(x.title)}</b>`, ...x.lines.map((l) => `• ${esc(l)}`));
  if (recs.length) lines.push("", `<b>${L("r_recs")}</b>`, ...recs.map((r) => `• ${esc(r)}`));
  return lines.join("\n");
}

const bar = (rate: number | null) => {
  const n = rate === null ? 0 : Math.round(rate / 10);
  return "▰".repeat(n) + "▱".repeat(10 - n);
};

// ---------------- PDF ----------------

const require = createRequire(import.meta.url);
const fontDir = join(dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");
export const FONT = join(fontDir, "DejaVuSans.ttf");
export const FONT_BOLD = join(fontDir, "DejaVuSans-Bold.ttf");

export const C = { ink: "#1d1613", muted: "#6f625c", line: "#e7dfda", accent: "#ee6b2c", soft: "#fde9de", bg: "#15100e", track: "#efe7e2" };

export function reportPdf(s: Stats, lang: Lang, recs: string[] = [], extra: ReportSection[] = []): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 44, info: { Title: `Drenix ${t(lang, titleKey[s.period])}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("r", FONT);
    doc.registerFont("b", FONT_BOLD);
    const W = doc.page.width - 88;
    const L = (k: string) => t(lang, k);

    // header band
    doc.rect(0, 0, doc.page.width, 96).fill(C.bg);
    doc.fill(C.accent).font("b").fontSize(11).text("DRENIX", 44, 30, { characterSpacing: 3 });
    doc.fill("#f3ece8").font("b").fontSize(20).text(L(titleKey[s.period]), 44, 48);
    doc.fill("#bfb3ad").font("r").fontSize(10).text(periodLabel(s, lang), 44, 74);
    let y = 120;

    // KPI tiles
    const tiles: [string, string][] = [
      [L("r_total"), String(s.total)],
      [L("r_completed"), String(s.completed)],
      [L("r_pending"), String(s.pending)],
      [L("r_overdue"), String(s.overdue)],
      [L("r_rate"), fmtPct(s.completionRate, lang)],
      [L("r_meetings"), String(s.meetings)],
      [L("r_interviews"), String(s.confirmedInterviews)],
      [L("r_postponed"), String(s.postponed)],
    ];
    const tw = (W - 3 * 10) / 4;
    tiles.forEach(([label, value], i) => {
      const x = 44 + (i % 4) * (tw + 10);
      const ty = y + Math.floor(i / 4) * 70;
      doc.roundedRect(x, ty, tw, 60, 8).fill(i === 4 ? C.soft : "#f7f3f0");
      doc.fill(i === 4 ? C.accent : C.ink).font("b").fontSize(18).text(value, x + 12, ty + 12, { width: tw - 24 });
      doc.fill(C.muted).font("r").fontSize(8).text(label, x + 12, ty + 38, { width: tw - 24 });
    });
    y += 150;

    const line = (label: string, value: string) => {
      doc.fill(C.muted).font("r").fontSize(10).text(label, 44, y, { width: W * 0.6 });
      doc.fill(C.ink).font("b").fontSize(10).text(value, 44 + W * 0.6, y, { width: W * 0.4, align: "right" });
      y += 18;
    };
    line(L("r_overdue_rate"), fmtPct(s.overdueRate, lang));
    line(L("r_cancelled"), String(s.cancelledMeetings));
    if (s.period !== "day") {
      line(L("r_best_day"), s.bestDay ? `${fmtDay(s.bestDay.shift_date, lang, true)} · ${fmtPct(s.bestDay.rate, lang)}` : L("r_na"));
      line(L("r_growth"), s.growth === null ? L("r_na") : `${s.growth > 0 ? "+" : ""}${s.growth}%`);
    }
    y += 10;

    // chart: completed vs total per workday
    if (s.byDay.length > 1) {
      doc.fill(C.ink).font("b").fontSize(12).text(L("r_by_day"), 44, y);
      y += 22;
      const h = 150;
      const max = Math.max(1, ...s.byDay.map((d) => d.total));
      const slot = W / s.byDay.length;
      const bw = Math.min(26, slot * 0.6);
      doc.moveTo(44, y + h).lineTo(44 + W, y + h).lineWidth(0.5).stroke(C.line);
      s.byDay.forEach((d, i) => {
        const x = 44 + i * slot + (slot - bw) / 2;
        const th = (d.total / max) * (h - 16);
        const ch = (d.completed / max) * (h - 16);
        doc.roundedRect(x, y + h - th, bw, th, 3).fill(C.track);
        if (ch > 0) doc.roundedRect(x, y + h - ch, bw, ch, 3).fill(C.accent);
        if (d.total) doc.fill(C.muted).font("r").fontSize(7).text(`${d.completed}/${d.total}`, x - 8, y + h - th - 11, { width: bw + 16, align: "center" });
        if (s.byDay.length <= 14 || i % 3 === 0)
          doc.fill(C.muted).font("r").fontSize(7).text(d.shift_date.slice(5).replace("-", "."), x - 10, y + h + 4, { width: bw + 20, align: "center" });
      });
      y += h + 30;
    }

    const section = (title: string, items: string[]) => {
      if (!items.length) return;
      if (y > doc.page.height - 120) {
        doc.addPage();
        y = 50;
      }
      doc.fill(C.ink).font("b").fontSize(12).text(title, 44, y);
      y = doc.y + 6;
      for (const it of items) {
        doc.fill(C.accent).circle(48, y + 5, 2).fill();
        doc.fill(C.ink).font("r").fontSize(10).text(it, 58, y, { width: W - 14 });
        y = doc.y + 4;
      }
      y += 10;
    };
    section(L("r_overdue_list"), s.overdueItems.map((o) => `#${o.id} ${o.title}${o.postponed ? ` (↻${o.postponed})` : ""}`));
    for (const x of extra) section(x.title, x.lines);
    section(L("r_recs"), recs);

    // footer sits inside the bottom margin; without this pdfkit would start a new page
    doc.page.margins.bottom = 0;
    doc.fill(C.muted).font("r").fontSize(8).text(`Drenix Assistant · ${isoLocal(new Date()).slice(0, 16).replace("T", " ")} (Tashkent)`, 44, doc.page.height - 34, { width: W, align: "right", lineBreak: false });
    doc.end();
  });
}

export const reportFileName = (s: Stats) => `drenix-${s.period}-report-${s.to}.pdf`;
