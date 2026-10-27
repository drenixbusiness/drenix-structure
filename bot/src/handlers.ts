import type { Context } from "grammy";
import { InputFile } from "grammy";
import { runAgent } from "./ai/agent.js";
import { cancelPlan, executePlan } from "./ai/tools.js";
import { recruitingReportLines } from "./services/recruiting.js";
import { cancelSheetWrite, executeSheetWrite } from "./services/sheetWrites.js";
import { cancelForm, executeForm } from "./services/forms.js";
import { classify, friendly } from "./errors.js";
import { transcribe } from "./ai/voice.js";
import { isHr } from "./config.js";
import { audit, db } from "./db.js";
import { googleConnected, googleEmail } from "./google/calendar.js";
import { isLang, LANG_LABEL, LANGS, t, type Lang } from "./i18n.js";
import * as cands from "./services/candidates.js";
import { getJob, jobHtml } from "./services/jobs.js";
import { computeStats, recommendations, reportFileName, reportPdf, reportText, type Period } from "./services/reports.js";
import { getTask, updateTask } from "./services/tasks.js";
import { ensureUser, getUser, setLang, setPendingToken, type User } from "./services/users.js";
import { bot, describe, esc, InlineKeyboard, send, trackMessage } from "./tg.js";
import { addDays, currentOrNextShift, fmtDay, workdaysFrom } from "./time.js";

const NO_OFFER_ALL = `${t("uz", "no_offer")}\n${t("ru", "no_offer")}\n${t("en", "no_offer")}`;

const langKb = () => {
  const kb = new InlineKeyboard();
  LANGS.forEach((l) => kb.text(LANG_LABEL[l], `lang:${l}`));
  return kb;
};

/** Per-chat queue: the polling loop never waits for the AI, but one chat is handled in order. */
const queues = new Map<number, Promise<unknown>>();
function serial(chatId: number, job: () => Promise<unknown>) {
  const prev = queues.get(chatId) ?? Promise.resolve();
  const next = prev.then(job, job).catch((e) => console.error("job failed", e));
  queues.set(chatId, next);
  void next.finally(() => queues.get(chatId) === next && queues.delete(chatId));
}

function firstSeen(ctx: Context): boolean {
  const m = ctx.message;
  if (!m) return true;
  return db.prepare("INSERT OR IGNORE INTO processed_updates (chat_id, message_id) VALUES (?, ?)").run(m.chat.id, m.message_id).changes > 0;
}

async function withTyping<T>(chatId: number, fn: () => Promise<T>): Promise<T> {
  const ping = () => bot.api.sendChatAction(chatId, "typing").catch(() => null);
  void ping();
  const h = setInterval(ping, 4500);
  try {
    return await fn();
  } finally {
    clearInterval(h);
  }
}

async function hrAsk(user: User, text: string) {
  const lang = user.lang ?? "uz";
  try {
    const answer = await withTyping(user.id, () => runAgent(user.id, text, lang));
    if (answer) await send(user.id, answer);
  } catch (e) {
    console.error("agent failed", e);
    await send(user.id, friendly(e, lang)).catch(() => null);
  }
}

export function registerHandlers() {
  // private chats only; the jobs group is send-only
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== "private") return;
    if (!ctx.from) return;
    await next();
  });

  bot.command("start", async (ctx) => {
    const user = ensureUser(ctx.from!);
    const payload = ctx.match?.trim() ?? "";
    if (user.role !== "hr" && user.role !== "none") trackMessage(ctx.chat.id, ctx.message!.message_id);

    if (payload.startsWith("inv_")) {
      if (isHr(user.id)) return void (await ctx.reply("ℹ️ This is a candidate invite link — send it to the candidate."));
      const c = cands.claimToken(payload.slice(4), user.id);
      if (!c) return void (await ctx.reply(user.lang ? t(user.lang, "no_offer") : NO_OFFER_ALL));
      trackMessage(ctx.chat.id, ctx.message!.message_id);
      if (!user.lang) {
        setPendingToken(user.id, payload.slice(4));
        const m = await ctx.reply(t(null, "choose_lang"), { reply_markup: langKb() });
        trackMessage(ctx.chat.id, m.message_id);
        return;
      }
      return void serial(user.id, () => cands.showInvitation(c.id, user.lang!));
    }

    if (isHr(user.id)) {
      if (!user.lang) return void (await ctx.reply(t(null, "choose_lang"), { reply_markup: langKb() }));
      return void (await ctx.reply(t(user.lang, "hr_welcome", { name: esc(user.first_name ?? "") }), { parse_mode: "HTML" }));
    }
    const c = cands.candidateByChat(user.id);
    if (c && !["declined", "rejected", "closed", "draft"].includes(c.status)) {
      if (!user.lang) {
        setPendingToken(user.id, c.token);
        return void (await ctx.reply(t(null, "choose_lang"), { reply_markup: langKb() }));
      }
      return void serial(user.id, () => cands.showInvitation(c.id, user.lang!));
    }
    await ctx.reply(user.lang ? t(user.lang, "no_offer") : NO_OFFER_ALL);
  });

  bot.command("lang", async (ctx) => {
    ensureUser(ctx.from!);
    await ctx.reply(t(null, "choose_lang"), { reply_markup: langKb() });
  });

  bot.command(["today", "report", "google"], async (ctx) => {
    const user = ensureUser(ctx.from!);
    if (!isHr(user.id)) return void (await ctx.reply(user.lang ? t(user.lang, "no_offer") : NO_OFFER_ALL));
    const lang = user.lang ?? "uz";
    const cmd = ctx.message!.text!.split(/[\s@]/)[0].slice(1);
    if (cmd === "google") {
      return void (await ctx.reply(googleConnected() ? t(lang, "google_ok", { email: esc(googleEmail() ?? "") }) : t(lang, "google_missing"), { parse_mode: "HTML" }));
    }
    if (cmd === "report") return void serial(user.id, () => sendReport(user.id, lang, "day"));
    serial(user.id, () => hrAsk(user, "Show my plan for today: tasks (with ids, priority, status) and calendar meetings in time order, plus free windows."));
  });

  bot.on("message:voice", (ctx) => handleVoice(ctx, ctx.message.voice.file_id));
  bot.on("message:audio", (ctx) => handleVoice(ctx, ctx.message.audio.file_id));

  bot.on("message:text", async (ctx) => {
    if (!firstSeen(ctx)) return;
    const user = ensureUser(ctx.from);
    const text = ctx.message.text.trim();
    if (isHr(user.id)) {
      if (!user.lang) return void (await ctx.reply(t(null, "choose_lang"), { reply_markup: langKb() }));
      return void serial(user.id, () => hrAsk(user, text));
    }
    const c = cands.candidateByChat(user.id);
    if (c && !["declined", "rejected", "closed", "draft"].includes(c.status)) {
      trackMessage(ctx.chat.id, ctx.message.message_id);
      return void serial(user.id, () => cands.candidateText(c, text));
    }
    await ctx.reply(user.lang ? t(user.lang, "no_offer") : NO_OFFER_ALL);
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const user = ensureUser(ctx.from);
    const lang: Lang = user.lang ?? "uz";
    const [kind, a, b] = data.split(":");
    await ctx.answerCallbackQuery().catch(() => null);
    const done = (html?: string, keepKb = false) =>
      ctx
        .editMessageText(`${(ctx.callbackQuery.message as { text?: string } | undefined)?.text ? escapeOriginal(ctx) : ""}${html ? `\n\n${html}` : ""}`, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: keepKb ? undefined : { inline_keyboard: [] },
        })
        .catch(() => null);

    try {
      // ---- language (everyone) ----
      if (kind === "lang" && isLang(a)) {
        setLang(user.id, a);
        await ctx.editMessageText(t(a, "lang_set")).catch(() => null);
        const fresh = getUser(user.id)!;
        if (isHr(user.id)) return void (await send(user.id, t(a, "hr_welcome", { name: esc(fresh.first_name ?? "") })));
        if (fresh.pending_token) {
          const c = cands.claimToken(fresh.pending_token, user.id);
          setPendingToken(user.id, null);
          if (c) return void serial(user.id, () => cands.showInvitation(c.id, a));
        }
        const c = cands.candidateByChat(user.id);
        if (c && !["declined", "rejected", "closed", "draft"].includes(c.status)) return void serial(user.id, () => cands.showInvitation(c.id, a));
        return void (await send(user.id, t(a, "no_offer")));
      }

      // ---- candidate buttons ----
      if (kind === "cs") {
        await done();
        return void serial(user.id, () => cands.candidatePicks(Number(a), user.id, b));
      }
      if (kind === "cc") {
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => null);
        return void serial(user.id, () => cands.candidateAction(Number(a), user.id, b));
      }

      // ---- everything below is HR only ----
      if (!isHr(user.id)) return;
      const id = Number(a);
      switch (kind) {
        case "cp": {
          if (b === "ok") {
            const html = await cands.approveDraft(id, lang);
            await done();
            await send(user.id, html);
          } else {
            cands.cancelDraft(id);
            await done(t(lang, "cand_cancelled"));
          }
          return;
        }
        case "ca": {
          if (b === "ok") {
            await done();
            const html = await cands.hrApproveSlot(id, lang);
            if (html) await send(user.id, html);
          } else if (b === "other") {
            await done(t(lang, "cand_slots_resent"));
            await cands.resendSlots(id);
          } else if (b === "rej") {
            const c = cands.getCandidate(id);
            await done();
            await send(
              user.id,
              t(lang, "reject_confirm", { name: esc(c?.name ?? "") }),
              new InlineKeyboard().text(t(lang, "btn_send"), `cr:${id}:send`).text(t(lang, "btn_dont_send"), `cr:${id}:skip`),
            );
          }
          return;
        }
        case "cn": {
          await done(t(lang, "cand_slots_resent"));
          await cands.resendSlots(id);
          return;
        }
        case "co": {
          const r = cands.setOutcome(id, b, lang);
          await done();
          await send(user.id, r.html, r.kb);
          return;
        }
        case "cr": {
          if (b === "send") {
            const ok = await cands.rejectCandidate(id);
            await done(ok ? t(lang, "rejected_done") : t(lang, "already_done"));
          } else {
            cands.closeCandidate(id);
            await done(t(lang, "reject_skipped"));
          }
          return;
        }
        case "cm":
        case "cx": {
          if (b === "send") {
            if (kind === "cm") await cands.notifyCandidateMoved(id);
            else await cands.notifyCandidateCancelled(id);
            await done("✅");
          } else await done("—");
          return;
        }
        case "sw": {
          if (b === "ok") {
            await done();
            await send(user.id, await withTyping(user.id, () => executeSheetWrite(id, lang)));
          } else await done(cancelSheetWrite(id, lang));
          return;
        }
        case "fm": {
          if (b === "ok") {
            await done();
            await send(user.id, await withTyping(user.id, () => executeForm(id, lang)));
          } else await done(cancelForm(id, lang));
          return;
        }
        case "pl": {
          if (b === "ok") {
            await done();
            const html = await withTyping(user.id, () => executePlan(id, lang));
            await send(user.id, html);
          } else {
            cancelPlan(id);
            await done(t(lang, "plan_cancelled"));
          }
          return;
        }
        case "t": {
          const task = getTask(id);
          if (!task) return void (await done(t(lang, "already_done")));
          if (b === "done") updateTask(id, { status: "completed" });
          else if (b === "progress") updateTask(id, { status: "in_progress" });
          else if (b === "cancel") updateTask(id, { status: "cancelled" });
          else if (b === "tomorrow") {
            const base = task.shift_date && task.shift_date >= currentOrNextShift() ? task.shift_date : currentOrNextShift();
            const next = workdaysFrom(addDays(base, 1), 1)[0];
            updateTask(id, { shift_date: next, start_at: null });
            audit("hr", "task_moved", { id, to: next });
            return void (await done(t(lang, "moved_tomorrow", { day: fmtDay(next, lang, true) })));
          }
          const after = getTask(id)!;
          return void (await done(t(lang, "status_set", { status: t(lang, `status_${after.status}`) })));
        }
        case "b": {
          await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => null);
          const prompts: Record<string, string> = {
            all: "Show all my tasks for today's shift with ids, priority and status, and my meetings in time order.",
            prio: "Re-evaluate the priorities of today's open tasks (deadline, importance, urgency, duration, dependencies). Suggest a new order with P1–P4 and ask me to confirm before changing anything.",
            resched: "Re-plan the rest of today's shift: place open tasks into free windows around my fixed meetings, then call propose_schedule.",
          };
          if (a === "start") return void (await send(user.id, t(lang, "start_day")));
          if (prompts[a]) serial(user.id, () => hrAsk(user, prompts[a]));
          return;
        }
        case "rp": {
          return void serial(user.id, () => sendPdf(user.id, lang, a as Period, b));
        }
        case "jr": {
          const j = getJob(id);
          if (j) await send(user.id, jobHtml(j));
          return;
        }
      }
    } catch (e) {
      console.error("callback failed", data, e);
      await send(user.id, friendly(e, lang)).catch(() => null);
    }
  });

  bot.catch((err) => console.error("bot error", describe(err.error)));
}

/** Keeps the original message text (as plain escaped text) when appending a status line. */
function escapeOriginal(ctx: Context) {
  const m = ctx.callbackQuery?.message as { text?: string } | undefined;
  return esc(m?.text ?? "");
}

async function handleVoice(ctx: Context, fileId: string) {
  if (!firstSeen(ctx)) return;
  const user = ensureUser(ctx.from!);
  if (!isHr(user.id)) {
    const c = cands.candidateByChat(user.id);
    if (c) trackMessage(ctx.chat!.id, ctx.message!.message_id);
    return void (await ctx.reply(user.lang ? t(user.lang, "no_offer") : NO_OFFER_ALL));
  }
  const lang = user.lang ?? "uz";
  serial(user.id, async () => {
    let text = "";
    try {
      text = await withTyping(user.id, () => transcribe(fileId));
    } catch (e) {
      console.error("transcribe failed", e);
      if (classify(e) !== "unknown") return void (await send(user.id, friendly(e, lang)));
    }
    if (!text) return void (await send(user.id, t(lang, "voice_fail")));
    await send(user.id, t(lang, "voice_heard", { text: esc(text) }));
    await hrAsk(user, text);
  });
}

async function sendReport(chatId: number, lang: Lang, period: Period) {
  const s = await computeStats(period);
  const recs = period === "day" ? [] : await recommendations(s, lang);
  const extra = await recruitingReportLines(s.from, s.to, lang);
  await send(chatId, reportText(s, lang, recs, extra ? [extra] : []), new InlineKeyboard().text(t(lang, "btn_pdf"), `rp:${period}:${s.to}`));
}

async function sendPdf(chatId: number, lang: Lang, period: Period, anchor?: string) {
  const s = await computeStats(period, anchor);
  const recs = period === "day" ? [] : await recommendations(s, lang);
  const extra = await recruitingReportLines(s.from, s.to, lang);
  await bot.api.sendDocument(chatId, new InputFile(await reportPdf(s, lang, recs, extra ? [extra] : []), reportFileName(s)));
}

