import { config } from "../config.js";
import { db } from "../db.js";
import * as gcal from "../google/calendar.js";
import { addMinutes, currentOrNextShift, shiftBounds, workdaysFrom } from "../time.js";
import { cancelPrefix, HR_CHAT, schedule } from "./notifications.js";

export interface Meeting {
  id: number;
  title: string;
  kind: "meeting" | "interview";
  start_at: string;
  end_at: string;
  format: "online" | "offline" | "none";
  meet_url: string | null;
  location: string | null;
  calendar_event_id: string | null;
  candidate_id: number | null;
  status: "scheduled" | "cancelled" | "completed";
  outcome: string | null;
  outcome_asked: number;
  reminders: string | null;
  created_at: string;
}

export const getMeeting = (id: number) => (db.prepare("SELECT * FROM meetings WHERE id = ?").get(id) as Meeting | undefined) ?? null;
export const meetingByEvent = (eventId: string) =>
  (db.prepare("SELECT * FROM meetings WHERE calendar_event_id = ?").get(eventId) as Meeting | undefined) ?? null;

export interface Interval {
  start: Date;
  end: Date;
  title?: string;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Busy intervals from Google (all events, incl. ones added by hand) + our own scheduled meetings. */
export async function busyBetween(from: Date, to: Date): Promise<Interval[]> {
  const busy: Interval[] = [];
  if (gcal.googleConnected()) busy.push(...(await gcal.freeBusy(from, to)));
  const own = db
    .prepare("SELECT start_at, end_at, title FROM meetings WHERE status = 'scheduled' AND start_at < ? AND end_at > ?")
    .all(to.toISOString(), from.toISOString()) as { start_at: string; end_at: string; title: string }[];
  busy.push(...own.map((m) => ({ start: new Date(m.start_at), end: new Date(m.end_at), title: m.title })));
  return busy;
}

/** Conflicting calendar events for a proposed interval (with titles when Google is connected). */
export async function conflictsFor(start: Date, end: Date, ignoreEventId?: string): Promise<Interval[]> {
  const out: Interval[] = [];
  if (gcal.googleConnected()) {
    const evs = await gcal.listEvents(addMinutes(start, -1), addMinutes(end, 1));
    for (const e of evs) {
      if (gcal.isAllDay(e) || e.id === ignoreEventId) continue;
      const iv = { start: gcal.eventStart(e), end: gcal.eventEnd(e), title: e.summary ?? "(busy)" };
      if (overlaps(iv, { start, end })) out.push(iv);
    }
  } else {
    for (const b of await busyBetween(start, end)) if (overlaps(b, { start, end })) out.push(b);
  }
  return out;
}

export interface SlotOptions {
  durationMin: number;
  fromShift?: string;
  days?: number;
  count?: number;
  leadMin?: number;
  stepMin?: number;
}

/** Free start times inside work shifts, spread across the days. */
export async function findSlots(o: SlotOptions): Promise<Date[]> {
  const days = workdaysFrom(o.fromShift ?? currentOrNextShift(), o.days ?? config.slotDays);
  if (!days.length) return [];
  const step = o.stepMin ?? 30;
  const earliest = addMinutes(new Date(), o.leadMin ?? 60);
  const busy = await busyBetween(shiftBounds(days[0]).start, shiftBounds(days[days.length - 1]).end);

  const perDay: Date[][] = days.map((sd) => {
    const { start, end } = shiftBounds(sd);
    const out: Date[] = [];
    let t = new Date(Math.max(start.getTime(), Math.ceil(earliest.getTime() / (step * 60_000)) * step * 60_000));
    for (; addMinutes(t, o.durationMin) <= end; t = addMinutes(t, step)) {
      const iv = { start: t, end: addMinutes(t, o.durationMin) };
      if (!busy.some((b) => overlaps(b, iv))) out.push(t);
    }
    return out;
  });

  const want = o.count ?? config.slotCount;
  const result: Date[] = [];
  // round-robin over days, picking evenly spaced options within each day
  const quota = Math.ceil(want / Math.max(1, perDay.filter((d) => d.length).length));
  for (const list of perDay) {
    if (!list.length) continue;
    const n = Math.min(quota, list.length);
    for (let i = 0; i < n; i++) result.push(list[Math.floor((i * list.length) / n)]);
  }
  return result.sort((a, b) => a.getTime() - b.getTime()).slice(0, want);
}

/** Free windows (merged) per day — for the AI to reason about. */
export async function freeWindows(fromShift: string, days: number): Promise<{ shift_date: string; free: Interval[] }[]> {
  const list = workdaysFrom(fromShift, days);
  if (!list.length) return [];
  const busy = (await busyBetween(shiftBounds(list[0]).start, shiftBounds(list[list.length - 1]).end)).sort((a, b) => +a.start - +b.start);
  const now = new Date();
  return list.map((sd) => {
    const { start, end } = shiftBounds(sd);
    let cur = new Date(Math.max(start.getTime(), now.getTime()));
    const free: Interval[] = [];
    for (const b of busy) {
      if (b.end <= cur || b.start >= end) continue;
      if (b.start > cur) free.push({ start: cur, end: b.start });
      if (b.end > cur) cur = b.end;
    }
    if (cur < end) free.push({ start: cur, end });
    return { shift_date: sd, free: free.filter((f) => +f.end - +f.start >= 10 * 60_000) };
  });
}

export interface CreateMeetingInput {
  title: string;
  start: Date;
  durationMin: number;
  format: "online" | "offline" | "none";
  attendees?: string[];
  description?: string;
  kind?: "meeting" | "interview";
  candidateId?: number | null;
  /** HR reminder offsets in minutes before start; omitted = config defaults */
  remindersMin?: number[];
}

/** Creates the Google Calendar event (+Meet when online) and our meeting row. Throws on API errors. */
export async function createMeeting(m: CreateMeetingInput): Promise<Meeting> {
  if (!gcal.googleConnected()) throw new gcal.GoogleError("Google Calendar is not connected");
  const end = addMinutes(m.start, m.durationMin);
  const location = m.format === "offline" ? [config.officeAddress, config.officeMapUrl].filter(Boolean).join(" · ") : undefined;
  const ev = await gcal.createEvent({
    title: m.title,
    start: m.start,
    end,
    description: m.description,
    location,
    meet: m.format === "online",
    attendees: m.attendees,
    tag: m.candidateId ? { candidate: String(m.candidateId) } : undefined,
  });
  const link = gcal.meetLink(ev);
  const info = db
    .prepare(
      `INSERT INTO meetings (title, kind, start_at, end_at, format, meet_url, location, calendar_event_id, candidate_id, reminders)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(m.title, m.kind ?? "meeting", m.start.toISOString(), end.toISOString(), m.format, link, location ?? null, ev.id, m.candidateId ?? null, m.remindersMin?.length ? JSON.stringify(m.remindersMin) : null);
  const meeting = getMeeting(Number(info.lastInsertRowid))!;
  scheduleMeetingReminders(meeting);
  return meeting;
}

export async function moveMeeting(id: number, start: Date, durationMin?: number): Promise<Meeting> {
  const m = getMeeting(id);
  if (!m) throw new Error(`Meeting ${id} not found`);
  const dur = durationMin ?? Math.round((+new Date(m.end_at) - +new Date(m.start_at)) / 60_000);
  const end = addMinutes(start, dur);
  if (m.calendar_event_id) await gcal.updateEvent(m.calendar_event_id, { start, end });
  db.prepare("UPDATE meetings SET start_at = ?, end_at = ?, status = 'scheduled', outcome_asked = 0 WHERE id = ?").run(start.toISOString(), end.toISOString(), id);
  const after = getMeeting(id)!;
  scheduleMeetingReminders(after);
  return after;
}

export async function cancelMeeting(id: number): Promise<Meeting | null> {
  const m = getMeeting(id);
  if (!m) return null;
  if (m.calendar_event_id) await gcal.deleteEvent(m.calendar_event_id);
  db.prepare("UPDATE meetings SET status = 'cancelled' WHERE id = ?").run(id);
  cancelPrefix(`mt:${id}:`);
  cancelPrefix(`mtc:${id}:`);
  return getMeeting(id);
}

export function scheduleMeetingReminders(m: Meeting) {
  cancelPrefix(`mt:${m.id}:`);
  cancelPrefix(`mtc:${m.id}:`);
  if (m.status !== "scheduled") return;
  const start = new Date(m.start_at);
  const now = Date.now();
  let offsets: readonly number[] = config.hrMeetingReminders;
  try {
    if (m.reminders) offsets = (JSON.parse(m.reminders) as number[]).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    /* keep defaults */
  }
  for (const off of offsets) {
    const at = addMinutes(start, -off);
    if (at.getTime() > now) schedule(`mt:${m.id}:${m.start_at}:${off}`, HR_CHAT, "meeting", at, { meetingId: m.id, offset: off });
  }
  if (m.candidate_id) {
    const cand = db.prepare("SELECT chat_id FROM candidates WHERE id = ?").get(m.candidate_id) as { chat_id: number | null } | undefined;
    if (cand?.chat_id) {
      for (const off of config.candidateReminders) {
        const at = addMinutes(start, -off);
        if (at.getTime() > now) schedule(`mtc:${m.id}:${m.start_at}:${off}`, cand.chat_id, "candidate_meeting", at, { meetingId: m.id, offset: off });
      }
    }
  }
}

export function meetingsBetween(from: Date, to: Date, statuses: Meeting["status"][] = ["scheduled", "completed"]): Meeting[] {
  return db
    .prepare(`SELECT * FROM meetings WHERE start_at >= ? AND start_at < ? AND status IN (${statuses.map(() => "?").join(",")}) ORDER BY start_at`)
    .all(from.toISOString(), to.toISOString(), ...statuses) as Meeting[];
}

/**
 * Keeps reminders in line with the real calendar: events added by hand get reminders,
 * our meetings moved/deleted in Google Calendar are updated here.
 */
export async function syncCalendar(hoursAhead = 26) {
  if (!gcal.googleConnected()) return;
  const from = new Date();
  const to = addMinutes(from, hoursAhead * 60);
  const events = await gcal.listEvents(from, to);
  const seen = new Set<string>();
  for (const e of events) {
    if (gcal.isAllDay(e)) continue;
    seen.add(e.id);
    const start = gcal.eventStart(e);
    const own = meetingByEvent(e.id);
    if (own) {
      if (own.status === "scheduled" && +new Date(own.start_at) !== +start) {
        db.prepare("UPDATE meetings SET start_at = ?, end_at = ? WHERE id = ?").run(start.toISOString(), gcal.eventEnd(e).toISOString(), own.id);
        scheduleMeetingReminders(getMeeting(own.id)!);
      }
      continue;
    }
    const startIso = start.toISOString();
    cancelPrefix(`ev:${e.id}:`); // re-added below for the current start time; sent ones are kept
    for (const off of config.hrMeetingReminders) {
      const at = addMinutes(start, -off);
      if (at.getTime() > Date.now())
        schedule(`ev:${e.id}:${startIso}:${off}`, HR_CHAT, "event", at, { eventId: e.id, title: e.summary ?? "", start: startIso, link: gcal.meetLink(e), offset: off });
    }
  }
  // reminders for hand-added events that were deleted (or moved out of the window) in Google
  const pendingEv = db.prepare("SELECT ref, payload FROM notifications WHERE kind = 'event' AND sent_at IS NULL AND cancelled = 0").all() as { ref: string; payload: string }[];
  for (const n of pendingEv) {
    const p = JSON.parse(n.payload) as { eventId?: string; start?: string };
    if (!p.eventId || seen.has(p.eventId) || !p.start || new Date(p.start) > to) continue;
    cancelPrefix(`ev:${p.eventId}:`);
  }
  // our meetings inside the window that vanished from Google → cancelled by hand
  const ours = meetingsBetween(from, to, ["scheduled"]);
  for (const m of ours) {
    if (!m.calendar_event_id || seen.has(m.calendar_event_id)) continue;
    try {
      const ev = await gcal.getEvent(m.calendar_event_id);
      if (ev.status === "cancelled") throw new Error("cancelled");
      db.prepare("UPDATE meetings SET start_at = ?, end_at = ? WHERE id = ?").run(gcal.eventStart(ev).toISOString(), gcal.eventEnd(ev).toISOString(), m.id);
      scheduleMeetingReminders(getMeeting(m.id)!);
    } catch {
      db.prepare("UPDATE meetings SET status = 'cancelled' WHERE id = ?").run(m.id);
      cancelPrefix(`mt:${m.id}:`);
      cancelPrefix(`mtc:${m.id}:`);
    }
  }
}
