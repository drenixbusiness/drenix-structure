/**
 * One lightweight interval loop (no Redis): due notifications, briefing, daily review,
 * interview follow-ups, calendar sync and automatic weekly/monthly reports.
 */
import { InputFile } from "grammy";
import { config } from "../config.js";
import { db, getSetting, setSetting } from "../db.js";
import * as gcal from "../google/calendar.js";
import { ct, t, type Lang } from "../i18n.js";
import { bot, describe, esc, InlineKeyboard, send, sendHr } from "../tg.js";
import { addDays, addMinutes, atLocal, currentOrNextShift, fmtDay, fmtTime, isWorkday, shiftBounds, shiftDateOf, workdaysFrom, ymdOf } from "../time.js";
import { askOutcome, getCandidate, placeText } from "./candidates.js";
import { getMeeting, syncCalendar, type Meeting } from "./meetings.js";
import { checkNewResponses } from "./forms.js";
import { due, HR_CHAT, markFailed, markSent, type Notification } from "./notifications.js";
import { recruitingReportLines } from "./recruiting.js";
import { computeStats, recommendations, reportFileName, reportPdf, reportText } from "./reports.js";
import { getTask, OPEN, spawnRecurring, tasksForShift, type Task } from "./tasks.js";
import { hrChats } from "./users.js";

let timer: NodeJS.Timeout | null = null;
let lastSync = 0;
let running = false;

export function startScheduler() {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processNotifications();
      await dailyRoutines();
      await interviewFollowUps();
      if (Date.now() - lastSync > 5 * 60_000) {
        lastSync = Date.now();
        await syncCalendar().catch((e) => console.warn("calendar sync:", (e as Error).message));
        await checkNewResponses();
      }
    } catch (e) {
      console.error("scheduler tick failed", e);
    } finally {
      running = false;
    }
  };
  void tick();
  timer = setInterval(tick, 30_000);
}

export const stopScheduler = () => timer && clearInterval(timer);

// ---------------- notifications ----------------

async function processNotifications() {
  for (const n of due()) {
    try {
      const delivered = await deliver(n);
      if (delivered !== false) markSent(n.id);
    } catch (e) {
      console.error("notification failed", n.ref, describe(e));
      markFailed(n.id);
    }
  }
}

/** "in 5 minutes" for the standard offsets, generic wording for custom ones. */
function inLabel(lang: Lang, o: number): string {
  const key = `in_${o}`;
  const fixed = t(lang, key);
  if (fixed !== key) return fixed;
  const [n, unit] = o % 1440 === 0 ? [o / 1440, 2] : o % 60 === 0 ? [o / 60, 1] : [o, 0];
  const words = { uz: ["daqiqadan", "soatdan", "kundan"], ru: ["мин.", "ч.", "дн."], en: ["minutes", "hours", "days"] }[lang];
  return lang === "uz" ? `${n} ${words[unit]} keyin` : lang === "ru" ? `Через ${n} ${words[unit]}` : `In ${n} ${words[unit]}`;
}

/** Returns false when the item is obsolete (still marked as handled). */
async function deliver(n: Notification): Promise<boolean | void> {
  const p = JSON.parse(n.payload) as Record<string, unknown>;
  const toHr = (build: (lang: Lang) => { html: string; kb?: InlineKeyboard }) => (n.chat_id === HR_CHAT ? sendHr(build) : send(n.chat_id, build("uz").html));

  switch (n.kind) {
    case "meeting": {
      const m = getMeeting(Number(p.meetingId));
      if (!m || m.status !== "scheduled") return;
      await toHr((l) => ({ html: t(l, "rem_meeting", { in: inLabel(l, Number(p.offset)), title: esc(m.title), time: fmtTime(new Date(m.start_at)), extra: meetingExtra(m) }) }));
      return;
    }
    case "event": {
      await toHr((l) => ({
        html: t(l, "rem_meeting", {
          in: inLabel(l, Number(p.offset)),
          title: esc(String(p.title || "—")),
          time: fmtTime(new Date(String(p.start))),
          extra: p.link ? `\n🔗 ${p.link}` : "",
        }),
      }));
      return;
    }
    case "candidate_meeting": {
      const m = getMeeting(Number(p.meetingId));
      const c = m?.candidate_id ? getCandidate(m.candidate_id) : null;
      if (!m || m.status !== "scheduled" || !c?.chat_id || ["declined", "rejected", "closed"].includes(c.status)) return;
      const lang = c.lang ?? "uz";
      const start = new Date(m.start_at);
      await send(c.chat_id, ct(lang, `reminder_${p.offset}`, { date: fmtDay(ymdOf(start), lang), time: fmtTime(start), place: placeText(c, lang, m) }), undefined, { track: true });
      return;
    }
    case "task_start":
    case "task_deadline":
    case "task_overdue": {
      const task = getTask(Number(p.taskId));
      if (!task || !OPEN.includes(task.status)) return;
      const key = n.kind === "task_start" ? "rem_task" : n.kind === "task_deadline" ? "rem_deadline" : "rem_overdue";
      const when = n.kind === "task_start" ? task.start_at : task.deadline_at;
      await toHr((l) => ({ html: t(l, key, { title: esc(task.title), time: when ? fmtTime(new Date(when)) : "" }), kb: taskKb(task, l) }));
      return;
    }
    case "delete_message": {
      await bot.api.deleteMessage(n.chat_id, Number(p.messageId)).catch(() => null);
      return;
    }
  }
}

function meetingExtra(m: Meeting) {
  if (m.meet_url) return `\n🔗 ${m.meet_url}`;
  if (m.format === "offline") return `\n🏢 ${esc(config.officeAddress)}`;
  return "";
}

export function taskKb(task: Task, lang: Lang) {
  return new InlineKeyboard()
    .text(t(lang, "btn_done"), `t:${task.id}:done`)
    .text(t(lang, "btn_progress"), `t:${task.id}:progress`)
    .row()
    .text(t(lang, "btn_tomorrow"), `t:${task.id}:tomorrow`)
    .text(t(lang, "btn_drop"), `t:${task.id}:cancel`);
}

// ---------------- briefing & review ----------------

async function dailyRoutines() {
  const now = new Date();
  const sd = currentOrNextShift(now);
  const { end } = shiftBounds(sd);

  // briefing: from BRIEFING_TIME until the shift ends (so a late restart still sends it)
  const briefAt = atLocal(sd, config.briefingTime);
  if (now >= briefAt && now < end && getSetting("briefing_sent") !== sd) {
    setSetting("briefing_sent", sd);
    spawnRecurring(sd);
    await sendBriefing(sd);
  }

  // review for the shift that started most recently (REVIEW_TIME is after midnight)
  const reviewSd = shiftDateOf(now);
  if (isWorkday(reviewSd)) {
    const rs = shiftBounds(reviewSd);
    const reviewAt = config.reviewTime < config.shiftStart ? atLocal(addDays(reviewSd, 1), config.reviewTime) : atLocal(reviewSd, config.reviewTime);
    if (now >= reviewAt && now < addMinutes(rs.end, 8 * 60) && getSetting("review_sent") !== reviewSd) {
      setSetting("review_sent", reviewSd);
      await sendReview(reviewSd);
      await periodicReports(reviewSd);
    }
  }
}

export async function sendBriefing(sd: string) {
  const tasks = tasksForShift(sd).filter((x) => OPEN.includes(x.status));
  const { start, end } = shiftBounds(sd);
  let meetings: { title: string; start: Date }[] = [];
  if (gcal.googleConnected()) {
    try {
      meetings = (await gcal.listEvents(start, end)).filter((e) => !gcal.isAllDay(e)).map((e) => ({ title: e.summary ?? "", start: gcal.eventStart(e) }));
    } catch (e) {
      console.warn("briefing calendar:", (e as Error).message);
    }
  }
  const top = [...tasks].sort((a, b) => a.priority - b.priority).slice(0, 3);
  await sendHr((l) => ({
    html: t(l, "briefing", {
      day: fmtDay(sd, l, true),
      tasks: tasks.length,
      meetings: meetings.length,
      first: meetings[0] ? t(l, "briefing_first", { time: fmtTime(meetings[0].start) }) : "",
      top: top.length ? t(l, "briefing_top", { list: top.map((x) => `• P${x.priority} ${esc(x.title)}`).join("\n") }) : t(l, "briefing_empty"),
    }),
    kb: new InlineKeyboard()
      .text(t(l, "btn_all_tasks"), "b:all")
      .text(t(l, "btn_priorities"), "b:prio")
      .row()
      .text(t(l, "btn_reschedule"), "b:resched")
      .text(t(l, "btn_start_day"), "b:start"),
  }));
}

export async function sendReview(sd: string) {
  const all = tasksForShift(sd).filter((x) => x.status !== "cancelled");
  const done = all.filter((x) => x.status === "completed").length;
  const progress = all.filter((x) => x.status === "in_progress").length;
  const left = all.filter((x) => x.status !== "completed");
  const rate = all.length ? `${Math.round((done / all.length) * 100)}%` : "—";
  await sendHr((l) => ({ html: t(l, "review", { day: fmtDay(sd, l, true), total: all.length, done, progress, left: left.length - progress, rate }) }));
  if (!left.length) {
    if (all.length) await sendHr((l) => ({ html: t(l, "review_clean") }));
    return;
  }
  await sendHr((l) => ({ html: t(l, "review_ask") }));
  for (const task of left.slice(0, 15)) {
    await sendHr((l) => ({ html: `▫️ <b>#${task.id}</b> ${esc(task.title)} <i>(${t(l, `status_${task.status}`)})</i>`, kb: taskKb(task, l) }));
  }
}

/** Saturday review → weekly report; last workday of the month → monthly report (both with PDF). */
async function periodicReports(sd: string) {
  const nextWork = workdaysFrom(addDays(sd, 1), 1)[0];
  const weekEnd = new Date(`${sd}T12:00:00Z`).getUTCDay() === 6;
  const monthEnd = nextWork && nextWork.slice(0, 7) !== sd.slice(0, 7);
  const periods = [...(weekEnd ? (["week"] as const) : []), ...(monthEnd ? (["month"] as const) : [])];
  for (const period of periods) {
    const s = await computeStats(period, sd);
    for (const c of hrChats()) {
      const recs = await recommendations(s, c.lang);
      const extra = await recruitingReportLines(s.from, s.to, c.lang);
      await send(c.id, reportText(s, c.lang, recs, extra ? [extra] : []));
      await bot.api.sendDocument(c.id, new InputFile(await reportPdf(s, c.lang, recs, extra ? [extra] : []), reportFileName(s)));
    }
  }
}

// ---------------- interviews ----------------

async function interviewFollowUps() {
  const past = db
    .prepare("SELECT * FROM meetings WHERE status = 'scheduled' AND end_at < ? ORDER BY end_at LIMIT 20")
    .all(addMinutes(new Date(), -5).toISOString()) as Meeting[];
  for (const m of past) {
    if (m.kind === "interview" && m.candidate_id && !m.outcome_asked) await askOutcome(m);
    else if (m.kind !== "interview") db.prepare("UPDATE meetings SET status = 'completed' WHERE id = ?").run(m.id);
  }
}
