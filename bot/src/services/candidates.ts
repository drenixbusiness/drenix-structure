/**
 * Candidate interview flow.
 *  HR asks → preview (HR confirms) → invite link → candidate opens, picks language
 *  → picks a free slot → HR approves → Calendar event (+Meet) → reminders
 *  → after the interview HR sets the outcome → optional rejection + chat cleanup.
 * Nothing is sent to a candidate without an explicit HR action.
 */
import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { audit, db } from "../db.js";
import { ct, t, type Lang } from "../i18n.js";
import { bot, cleanupChat, describe, esc, InlineKeyboard, send, sendHr } from "../tg.js";
import { addMinutes, fmtDateTime, fmtDay, fmtTime, isoLocal, ymdOf } from "../time.js";
import { cancelMeeting, conflictsFor, createMeeting, findSlots, getMeeting, moveMeeting, scheduleMeetingReminders, type Meeting } from "./meetings.js";
import { cancelPrefix, schedule } from "./notifications.js";
import { setRole } from "./users.js";

export type CandStatus =
  | "draft"
  | "invited"
  | "opened"
  | "slot_selected"
  | "scheduled"
  | "confirmed"
  | "reschedule"
  | "declined"
  | "passed"
  | "rejected"
  | "no_show"
  | "closed";

export interface Candidate {
  id: number;
  name: string;
  username: string | null;
  phone: string | null;
  email: string | null;
  position: string | null;
  job_request_id: number | null;
  token: string;
  chat_id: number | null;
  lang: Lang | null;
  duration_min: number;
  format: "online" | "offline";
  fixed_start: string | null;
  offered_slots: string | null;
  selected_start: string | null;
  meeting_id: number | null;
  status: CandStatus;
  outcome: string | null;
  created_at: string;
  closed_at: string | null;
}

const CLOSED: CandStatus[] = ["declined", "rejected", "closed"];

export const getCandidate = (id: number) => (db.prepare("SELECT * FROM candidates WHERE id = ?").get(id) as Candidate | undefined) ?? null;
const byToken = (token: string) => (db.prepare("SELECT * FROM candidates WHERE token = ?").get(token) as Candidate | undefined) ?? null;
export const candidateByChat = (chatId: number) =>
  (db.prepare("SELECT * FROM candidates WHERE chat_id = ? ORDER BY id DESC LIMIT 1").get(chatId) as Candidate | undefined) ?? null;

function update(id: number, cols: Partial<Record<keyof Candidate, unknown>>) {
  const keys = Object.keys(cols);
  db.prepare(`UPDATE candidates SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => cols[k as keyof Candidate] as never), id);
}

export function listCandidates(f: { status?: CandStatus[]; query?: string; limit?: number } = {}): Candidate[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.status?.length) {
    where.push(`status IN (${f.status.map(() => "?").join(",")})`);
    args.push(...f.status);
  }
  if (f.query) {
    where.push("(name LIKE ? OR IFNULL(username,'') LIKE ? OR IFNULL(position,'') LIKE ? OR IFNULL(email,'') LIKE ? OR IFNULL(phone,'') LIKE ?)");
    const q = `%${f.query.replace(/^@/, "")}%`;
    args.push(q, q, q, q, q);
  }
  return db.prepare(`SELECT * FROM candidates ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`).all(...args, f.limit ?? 30) as Candidate[];
}

// ---------------- HR side ----------------

export interface DraftInput {
  name: string;
  username?: string | null;
  phone?: string | null;
  email?: string | null;
  position?: string | null;
  job_request_id?: number | null;
  duration_min: number;
  format: "online" | "offline";
  fixed_start?: Date | null;
}

export function createDraft(d: DraftInput): Candidate {
  const token = randomBytes(9).toString("base64url");
  const info = db
    .prepare(
      `INSERT INTO candidates (name, username, phone, email, position, job_request_id, token, duration_min, format, fixed_start)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      d.name.trim(),
      d.username?.replace(/^@/, "").trim() || null,
      d.phone ?? null,
      d.email?.trim() || null,
      d.position ?? null,
      d.job_request_id ?? null,
      token,
      Math.max(10, Math.min(240, Math.round(d.duration_min))),
      d.format,
      d.fixed_start?.toISOString() ?? null,
    );
  return getCandidate(Number(info.lastInsertRowid))!;
}

const fmtLabel = (lang: Lang, f: string) => t(lang, f === "offline" ? "fmt_offline" : "fmt_online");
const who = (c: Candidate) => (c.username ? `@${c.username}` : c.name);

export async function sendPreview(c: Candidate) {
  await sendHr((lang) => {
    const contacts = [c.username && `💬 @${esc(c.username)}`, c.phone && `📞 ${esc(c.phone)}`, c.email && `✉️ ${esc(c.email)}`].filter(Boolean).join("\n");
    return {
      html: t(lang, "cand_preview", {
        name: esc(c.name),
        position: esc(c.position ?? "—"),
        duration: c.duration_min,
        format: fmtLabel(lang, c.format),
        when: c.fixed_start ? fmtDateTime(new Date(c.fixed_start), lang, true) : t(lang, "cand_when_pick", { n: config.slotCount }),
        contacts: contacts ? `${contacts}\n` : "",
      }),
      kb: new InlineKeyboard().text(t(lang, "btn_confirm"), `cp:${c.id}:ok`).text(t(lang, "btn_cancel"), `cp:${c.id}:no`),
    };
  });
}

export const inviteLink = (c: Candidate) => `https://t.me/${bot.botInfo.username}?start=inv_${c.token}`;

/** HR pressed ✅ on the preview. */
export async function approveDraft(id: number, lang: Lang): Promise<string> {
  const c = getCandidate(id);
  if (!c || c.status !== "draft") return t(lang, "already_done");
  if (c.fixed_start) {
    const start = new Date(c.fixed_start);
    const clash = await conflictsFor(start, addMinutes(start, c.duration_min));
    if (clash.length) {
      return `⚠️ ${fmtDateTime(start, lang)}: ${clash.map((x) => esc(x.title ?? "busy")).join(", ")}`;
    }
    const m = await createMeeting({
      title: interviewTitle(c),
      start,
      durationMin: c.duration_min,
      format: c.format,
      attendees: c.email ? [c.email] : undefined,
      kind: "interview",
      candidateId: c.id,
      description: interviewDescription(c),
    });
    update(id, { status: "invited", meeting_id: m.id, selected_start: c.fixed_start });
  } else update(id, { status: "invited" });
  audit("hr", "candidate_invited", { id });
  const link = inviteLink(c);
  return `${t(lang, "cand_link", { who: esc(who(c)) })}\n\n<code>${esc(t(lang, "cand_forward", { link }))}</code>`;
}

export function cancelDraft(id: number) {
  const c = getCandidate(id);
  if (c?.status === "draft") update(id, { status: "closed", closed_at: new Date().toISOString() });
}

const interviewTitle = (c: Candidate) => `Interview: ${c.name}${c.position ? ` — ${c.position}` : ""}`;
const interviewDescription = (c: Candidate) =>
  [c.position && `Position: ${c.position}`, c.username && `Telegram: @${c.username}`, c.phone && `Phone: ${c.phone}`, c.email && `Email: ${c.email}`, "Scheduled by Drenix Assistant"]
    .filter(Boolean)
    .join("\n");

// ---------------- candidate side ----------------

/** /start inv_<token>. Returns the candidate if the link is valid for this Telegram user. */
export function claimToken(token: string, chatId: number): Candidate | null {
  const c = byToken(token);
  if (!c || c.status === "draft" || CLOSED.includes(c.status)) return null;
  if (c.chat_id && c.chat_id !== chatId) return null; // link already used by someone else
  if (!c.chat_id) update(c.id, { chat_id: chatId });
  setRole(chatId, "candidate");
  return getCandidate(c.id);
}

function placeText(c: Candidate, lang: Lang, m?: Meeting | null) {
  if (c.format === "offline") return ct(lang, "place_offline", { address: esc(config.officeAddress), map: config.officeMapUrl });
  return m?.meet_url ? ct(lang, "place_online", { link: m.meet_url }) : ct(lang, "place_online_nolink");
}

const sendCand = (c: Candidate, html: string, kb?: InlineKeyboard) => send(c.chat_id!, html, kb, { track: true });

/** First screen after the language choice. */
export async function showInvitation(id: number, lang: Lang) {
  let c = getCandidate(id)!;
  update(id, { lang });
  c = getCandidate(id)!;
  if (c.status === "invited") {
    update(id, { status: "opened" });
    await sendHr((l) => ({ html: t(l, "cand_opened", { name: esc(c.name) }) }));
  }
  const m = c.meeting_id ? getMeeting(c.meeting_id) : null;
  if (m && m.status === "scheduled") {
    // HR fixed the time: TZ invitation template with Confirm / Reschedule / Decline
    scheduleMeetingReminders(m); // candidate chat is known now → candidate reminders
    const start = new Date(m.start_at);
    await sendCand(
      c,
      ct(lang, c.meeting_id && c.status !== "scheduled" && c.status !== "confirmed" ? "fixed" : "scheduled", {
        position: c.position ? ct(lang, "intro_position", { position: esc(c.position) }) : "",
        date: fmtDay(ymdOf(start), lang, true),
        time: fmtTime(start),
        duration: c.duration_min,
        place: placeText(c, lang, m),
      }),
      afterScheduleKb(c, lang, c.status !== "scheduled" && c.status !== "confirmed"),
    );
    return;
  }
  await offerSlots(c, lang, "intro");
}

function afterScheduleKb(c: Candidate, lang: Lang, withConfirm: boolean) {
  const kb = new InlineKeyboard();
  if (withConfirm) kb.text(ct(lang, "confirm"), `cc:${c.id}:confirm`).row();
  return kb.text(ct(lang, "reschedule"), `cc:${c.id}:resched`).row().text(ct(lang, "decline"), `cc:${c.id}:decline`);
}

async function offerSlots(c: Candidate, lang: Lang, mode: "intro" | "choose_again" | "slot_gone") {
  const slots = await findSlots({ durationMin: c.duration_min });
  if (!slots.length) {
    await sendCand(c, ct(lang, "no_slots"));
    await sendHr((l) => ({ html: t(l, "cand_no_slots_hr", { days: config.slotDays, duration: c.duration_min }) }));
    return;
  }
  update(c.id, { offered_slots: JSON.stringify(slots.map((s) => s.toISOString())) });
  const kb = new InlineKeyboard();
  slots.forEach((s, i) => kb.text(fmtDateTime(s, lang, true), `cs:${c.id}:${i}`).row());
  kb.text(ct(lang, "none_fit"), `cs:${c.id}:none`);
  const html =
    mode === "intro"
      ? ct(lang, "intro", {
          position: c.position ? ct(lang, "intro_position", { position: esc(c.position) }) : "",
          format: fmtLabel(lang, c.format),
          duration: c.duration_min,
        })
      : ct(lang, mode);
  await sendCand(c, html, kb);
}

export async function candidatePicks(id: number, chatId: number, pick: string) {
  const c = getCandidate(id);
  if (!c || c.chat_id !== chatId || CLOSED.includes(c.status)) return;
  const lang = c.lang ?? "uz";
  if (pick === "none") {
    await sendCand(c, ct(lang, "none_fit_ack"));
    await sendHr((l) => ({ html: t(l, "cand_none_fit_hr", { name: esc(c.name) }) }));
    return;
  }
  const slots: string[] = JSON.parse(c.offered_slots ?? "[]");
  const iso = slots[Number(pick)];
  if (!iso) return;
  const start = new Date(iso);
  const clash = await conflictsFor(start, addMinutes(start, c.duration_min), meetingEventId(c));
  if (clash.length) return offerSlots(c, lang, "slot_gone");
  update(id, { status: "slot_selected", selected_start: iso });
  await sendCand(c, ct(lang, "picked", { time: fmtDateTime(start, lang, true) }));
  await sendHr((l) => ({
    html: t(l, "cand_picked", { name: esc(c.name), time: fmtDateTime(start, l, true), duration: c.duration_min, format: fmtLabel(l, c.format) }),
    kb: new InlineKeyboard()
      .text(t(l, "btn_confirm"), `ca:${c.id}:ok`)
      .row()
      .text(t(l, "btn_other_slots"), `ca:${c.id}:other`)
      .text(t(l, "btn_reject"), `ca:${c.id}:rej`),
  }));
}

const meetingEventId = (c: Candidate) => (c.meeting_id ? (getMeeting(c.meeting_id)?.calendar_event_id ?? undefined) : undefined);

/** HR approved the slot the candidate picked. */
export async function hrApproveSlot(id: number, lang: Lang): Promise<string> {
  const c = getCandidate(id);
  if (!c || c.status !== "slot_selected" || !c.selected_start) return t(lang, "already_done");
  const start = new Date(c.selected_start);
  const clash = await conflictsFor(start, addMinutes(start, c.duration_min), meetingEventId(c));
  if (clash.length) {
    await sendHr((l) => ({
      html: t(l, "cand_slot_taken", { time: fmtDateTime(start, l) }),
      kb: new InlineKeyboard().text(t(l, "btn_send"), `cn:${c.id}`),
    }));
    return "";
  }
  const existing = c.meeting_id ? getMeeting(c.meeting_id) : null;
  const m =
    existing && existing.status === "scheduled"
      ? await moveMeeting(existing.id, start, c.duration_min)
      : await createMeeting({
          title: interviewTitle(c),
          start,
          durationMin: c.duration_min,
          format: c.format,
          attendees: c.email ? [c.email] : undefined,
          kind: "interview",
          candidateId: c.id,
          description: interviewDescription(c),
        });
  update(id, { status: "scheduled", meeting_id: m.id });
  const fresh = getCandidate(id)!;
  scheduleMeetingReminders(m);
  const cl = fresh.lang ?? "uz";
  await sendCand(
    fresh,
    ct(cl, "scheduled", { date: fmtDay(ymdOf(start), cl, true), time: fmtTime(start), duration: c.duration_min, place: placeText(fresh, cl, m) }),
    afterScheduleKb(fresh, cl, false),
  );
  audit("hr", "interview_scheduled", { candidate: id, meeting: m.id, start: isoLocal(start) });
  return t(lang, "cand_scheduled_hr", { name: esc(c.name), time: fmtDateTime(start, lang, true), link: m.meet_url ? `\n🔗 ${m.meet_url}` : "" });
}

export async function resendSlots(id: number) {
  const c = getCandidate(id);
  if (!c?.chat_id || CLOSED.includes(c.status)) return;
  update(id, { status: "reschedule" });
  await offerSlots(c, c.lang ?? "uz", "choose_again");
}

export async function candidateAction(id: number, chatId: number, action: string) {
  const c = getCandidate(id);
  if (!c || c.chat_id !== chatId || CLOSED.includes(c.status)) return;
  const lang = c.lang ?? "uz";
  const m = c.meeting_id ? getMeeting(c.meeting_id) : null;
  if (action === "confirm") {
    update(id, { status: "confirmed" });
    await sendCand(c, ct(lang, "confirmed"));
    await sendHr((l) => ({ html: t(l, "cand_confirmed_hr", { name: esc(c.name), time: m ? fmtDateTime(new Date(m.start_at), l) : "—" }) }));
  } else if (action === "resched") {
    update(id, { status: "reschedule" });
    await offerSlots(c, lang, "choose_again");
    await sendHr((l) => ({ html: t(l, "cand_resched_hr", { name: esc(c.name) }) }));
  } else if (action === "decline") {
    if (m && m.status === "scheduled") await cancelMeeting(m.id);
    update(id, { status: "declined", closed_at: new Date().toISOString() });
    await sendCand(c, ct(lang, "declined"));
    await sendHr((l) => ({ html: t(l, "cand_declined_hr", { name: esc(c.name), time: m ? fmtDateTime(new Date(m.start_at), l) : "—" }) }));
  }
}

/** Free text from a candidate → forwarded to HR. */
export async function candidateText(c: Candidate, text: string) {
  await sendCand(c, ct(c.lang, "text_ack"));
  await sendHr((l) => ({ html: t(l, "cand_msg_hr", { name: esc(c.name), text: esc(text.slice(0, 1500)) }) }));
}

// ---------------- after the interview ----------------

export async function askOutcome(m: Meeting) {
  const c = m.candidate_id ? getCandidate(m.candidate_id) : null;
  if (!c) return;
  db.prepare("UPDATE meetings SET outcome_asked = 1 WHERE id = ?").run(m.id);
  await sendHr((l) => ({
    html: t(l, "outcome_ask", { name: esc(c.name), time: fmtDateTime(new Date(m.start_at), l) }),
    kb: new InlineKeyboard()
      .text(t(l, "btn_passed"), `co:${m.id}:passed`)
      .text(t(l, "btn_failed"), `co:${m.id}:failed`)
      .row()
      .text(t(l, "btn_noshow"), `co:${m.id}:noshow`)
      .text(t(l, "btn_followup"), `co:${m.id}:followup`),
  }));
}

// failed keeps the candidate open until HR decides about the rejection message
const OUTCOME: Record<string, { meeting: string; cand: CandStatus | null }> = {
  passed: { meeting: "accepted", cand: "passed" },
  failed: { meeting: "rejected", cand: null },
  noshow: { meeting: "no_show", cand: "no_show" },
  followup: { meeting: "follow_up_required", cand: "opened" },
};

/** Returns the HR reply and, for failed / no-show, a follow-up confirmation keyboard. */
export function setOutcome(meetingId: number, key: string, lang: Lang): { html: string; kb?: InlineKeyboard } {
  const m = getMeeting(meetingId);
  const o = OUTCOME[key];
  if (!m || !o) return { html: t(lang, "already_done") };
  db.prepare("UPDATE meetings SET outcome = ?, status = 'completed' WHERE id = ?").run(o.meeting, m.id);
  const c = m.candidate_id ? getCandidate(m.candidate_id) : null;
  if (!c) return { html: t(lang, "outcome_saved", { name: m.title, outcome: o.meeting }) };
  update(c.id, { outcome: o.meeting, status: o.cand ?? c.status });
  audit("hr", "interview_outcome", { candidate: c.id, outcome: o.meeting });
  if (key === "failed" || key === "noshow") {
    return {
      html: t(lang, "reject_confirm", { name: esc(c.name) }),
      kb: new InlineKeyboard().text(t(lang, "btn_send"), `cr:${c.id}:send`).text(t(lang, "btn_dont_send"), `cr:${c.id}:skip`),
    };
  }
  return { html: t(lang, "outcome_saved", { name: esc(c.name), outcome: o.meeting }) };
}

/** Sends the rejection, removes what Telegram allows and closes the link. */
export async function rejectCandidate(id: number): Promise<boolean> {
  const c = getCandidate(id);
  if (!c || c.status === "rejected" || c.status === "closed") return false;
  if (c.meeting_id) {
    const m = getMeeting(c.meeting_id);
    if (m?.status === "scheduled" && new Date(m.start_at) > new Date()) await cancelMeeting(m.id).catch(() => null);
  }
  update(id, { status: "rejected", closed_at: new Date().toISOString() });
  cancelPrefix(`mtc:${c.meeting_id}:`);
  if (c.chat_id) {
    try {
      const msg = await send(c.chat_id, ct(c.lang, "rejected"));
      await cleanupChat(c.chat_id, [msg.message_id]);
      // the rejection itself disappears just before Telegram's 48h limit
      schedule(`crm:${c.id}`, c.chat_id, "delete_message", addMinutes(new Date(), 47 * 60), { messageId: msg.message_id });
    } catch (e) {
      console.error("rejection delivery failed", describe(e));
    }
  }
  audit("hr", "candidate_rejected", { id });
  return true;
}

/** HR cancelled / moved an interview through the assistant: optional candidate notice. */
export async function notifyCandidateCancelled(id: number) {
  const c = getCandidate(id);
  if (!c?.chat_id) return;
  const m = c.meeting_id ? getMeeting(c.meeting_id) : null;
  const lang = c.lang ?? "uz";
  const start = m ? new Date(m.start_at) : new Date();
  update(id, { status: "closed", closed_at: new Date().toISOString() });
  await sendCand(c, ct(lang, "cancelled_by_hr", { date: fmtDay(ymdOf(start), lang), time: fmtTime(start) }));
}

export async function notifyCandidateMoved(id: number) {
  const c = getCandidate(id);
  if (!c?.chat_id || !c.meeting_id) return;
  const m = getMeeting(c.meeting_id)!;
  const lang = c.lang ?? "uz";
  const start = new Date(m.start_at);
  update(id, { status: "scheduled", selected_start: m.start_at });
  await sendCand(
    c,
    ct(lang, "scheduled", { date: fmtDay(ymdOf(start), lang, true), time: fmtTime(start), duration: c.duration_min, place: placeText(c, lang, m) }),
    afterScheduleKb(c, lang, false),
  );
}

export { placeText };

/** HR chose not to send a rejection: just close the link silently. */
export function closeCandidate(id: number) {
  const c = getCandidate(id);
  if (!c || CLOSED.includes(c.status)) return;
  update(id, { status: "closed", closed_at: new Date().toISOString() });
}
