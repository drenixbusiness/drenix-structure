/**
 * Turns technical failures (OpenAI, Google, Telegram, network) into a short explanation in plain words:
 * what happened, whether it fixes itself, and who has to do what.
 */
import { GrammyError, HttpError } from "grammy";
import OpenAI from "openai";
import { getSetting, setSetting } from "./db.js";
import { GoogleError } from "./google/calendar.js";
import type { Lang } from "./i18n.js";
import { esc, sendHr } from "./tg.js";

export type Problem =
  | "openai_key"
  | "openai_quota"
  | "openai_rate"
  | "openai_model"
  | "openai_down"
  | "google_reconnect"
  | "google_api_off"
  | "google_no_access"
  | "google_rate"
  | "google_down"
  | "network"
  | "unknown";

const MSG: Record<Problem, Record<Lang, string>> = {
  openai_key: {
    uz: "🔑 OpenAI kaliti ishlamayapti (noto'g'ri yoki bekor qilingan). Admin serverdagi <code>.env</code> faylida <code>OPENAI_API_KEY</code> ni yangilab, botni qayta ishga tushirishi kerak.",
    ru: "🔑 Ключ OpenAI не работает (неверный или отозван). Админу нужно обновить <code>OPENAI_API_KEY</code> в <code>.env</code> на сервере и перезапустить бота.",
    en: "🔑 The OpenAI key does not work (wrong or revoked). An admin must update <code>OPENAI_API_KEY</code> in the server's <code>.env</code> and restart the bot.",
  },
  openai_quota: {
    uz: "💳 OpenAI hisobida mablag' tugadi yoki limitga yetildi. platform.openai.com → Billing bo'limida balansni to'ldirish kerak. To'ldirilgach, bot o'zi ishlab ketadi.",
    ru: "💳 На счёте OpenAI закончились средства или достигнут лимит. Пополните баланс на platform.openai.com → Billing — после этого бот заработает сам.",
    en: "💳 The OpenAI account is out of credit or hit its limit. Top up at platform.openai.com → Billing; the bot works again by itself afterwards.",
  },
  openai_rate: {
    uz: "⏳ OpenAI'ga hozir juda ko'p so'rov ketdi. 1 daqiqadan keyin qayta yozing.",
    ru: "⏳ Сейчас слишком много запросов к OpenAI. Напишите ещё раз через минуту.",
    en: "⏳ Too many requests to OpenAI right now. Try again in a minute.",
  },
  openai_model: {
    uz: "🤖 Sozlamadagi AI modeli mavjud emas yoki bu hisobga ochiq emas. Admin <code>.env</code> dagi <code>OPENAI_MODEL</code> ni tekshirishi kerak.",
    ru: "🤖 Модель AI из настроек недоступна для этого аккаунта. Админу нужно проверить <code>OPENAI_MODEL</code> в <code>.env</code>.",
    en: "🤖 The configured AI model is not available for this account. An admin must check <code>OPENAI_MODEL</code> in <code>.env</code>.",
  },
  openai_down: {
    uz: "🌐 OpenAI vaqtincha javob bermayapti. Bu ularning tomonidagi muammo, odatda bir necha daqiqada o'tib ketadi. Birozdan keyin qayta yozing.",
    ru: "🌐 OpenAI временно не отвечает. Это проблема на их стороне, обычно проходит за несколько минут. Напишите чуть позже.",
    en: "🌐 OpenAI is not responding right now. It is on their side and usually passes in a few minutes. Try again shortly.",
  },
  google_reconnect: {
    uz: "🔌 Google ulanishi uzildi (ruxsat bekor qilingan yoki muddati tugagan). Kalendar, jadval va formalar ishlamaydi. Admin serverda <code>npm run google:auth:prod</code> ni ishga tushirib, qayta ruxsat berishi kerak.",
    ru: "🔌 Подключение к Google потеряно (доступ отозван или истёк). Календарь, таблица и формы не работают. Админу нужно запустить на сервере <code>npm run google:auth:prod</code> и снова дать доступ.",
    en: "🔌 The Google connection is lost (access revoked or expired). Calendar, sheet and forms don't work. An admin must run <code>npm run google:auth:prod</code> on the server and allow access again.",
  },
  google_api_off: {
    uz: "⚙️ Google Cloud loyihasida kerakli API yoqilmagan (Calendar, Sheets yoki Forms). Admin console.cloud.google.com → APIs & Services bo'limida uni yoqishi kerak.",
    ru: "⚙️ В проекте Google Cloud не включён нужный API (Calendar, Sheets или Forms). Админу нужно включить его в console.cloud.google.com → APIs & Services.",
    en: "⚙️ A required API (Calendar, Sheets or Forms) is not enabled in the Google Cloud project. An admin must enable it in console.cloud.google.com → APIs & Services.",
  },
  google_no_access: {
    uz: "🚫 Bu Google fayliga ruxsat yo'q. Fayl drenixit@gmail.com akkauntiga tahrirlash huquqi bilan ulashilgan bo'lishi kerak.",
    ru: "🚫 Нет доступа к этому файлу Google. Его нужно открыть для drenixit@gmail.com с правом редактирования.",
    en: "🚫 No access to this Google file. It must be shared with drenixit@gmail.com with edit rights.",
  },
  google_rate: {
    uz: "⏳ Google so'rovlar limitiga yetildi. 1–2 daqiqadan keyin qayta urinib ko'ring.",
    ru: "⏳ Достигнут лимит запросов Google. Попробуйте через 1–2 минуты.",
    en: "⏳ Google's request limit was reached. Try again in 1–2 minutes.",
  },
  google_down: {
    uz: "🌐 Google vaqtincha javob bermayapti. Birozdan keyin qayta urinib ko'ring.",
    ru: "🌐 Google временно не отвечает. Попробуйте чуть позже.",
    en: "🌐 Google is not responding right now. Try again shortly.",
  },
  network: {
    uz: "📡 Serverda internet bilan muammo bor, tashqi xizmatlarga ulanib bo'lmadi. Internet tiklanganda bot o'zi ishlab ketadi.",
    ru: "📡 На сервере проблемы с интернетом — внешние сервисы недоступны. Бот заработает сам, когда связь восстановится.",
    en: "📡 The server has internet trouble and can't reach outside services. The bot recovers by itself when the connection is back.",
  },
  unknown: {
    uz: "Kechirasiz, kutilmagan xatolik yuz berdi. Qayta urinib ko'ring. Takrorlansa, quyidagi matnni adminga yuboring.",
    ru: "Извините, произошла непредвиденная ошибка. Попробуйте ещё раз; если повторится — перешлите текст ниже админу.",
    en: "Sorry, something unexpected went wrong. Try again; if it repeats, forward the text below to the admin.",
  },
};

const NET = /fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network|timeout|timed out|aborted/i;

export function classify(e: unknown): Problem {
  if (e instanceof OpenAI.APIError) {
    const code = String(e.code ?? (e.error as { code?: string } | undefined)?.code ?? "");
    if (e instanceof OpenAI.APIConnectionError) return NET.test(String((e.cause as Error | undefined)?.message ?? e.message)) ? "network" : "openai_down";
    if (e.status === 401 || code === "invalid_api_key") return "openai_key";
    if (code === "insufficient_quota" || /quota|billing/i.test(e.message)) return "openai_quota";
    if (e.status === 429) return "openai_rate";
    if (e.status === 404 || code === "model_not_found") return "openai_model";
    if (!e.status || e.status >= 500) return "openai_down";
    return "unknown";
  }
  if (e instanceof GoogleError) {
    const m = e.message;
    if (/invalid_grant|token refresh failed|not connected|NOT connected|tick the|has been expired or revoked/i.test(m)) return "google_reconnect";
    if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(m)) return "google_api_off";
    if (e.status === 429 || /rate limit|quota/i.test(m)) return "google_rate";
    if (e.status === 403 || e.status === 404 || /permission|not have access|not found/i.test(m)) return "google_no_access";
    if (!e.status || e.status >= 500) return NET.test(m) ? "network" : "google_down";
    return "unknown";
  }
  if (e instanceof HttpError) return "network";
  if (e instanceof GrammyError) return "unknown";
  const msg = e instanceof Error ? `${e.message} ${(e.cause as Error | undefined)?.message ?? ""}` : String(e);
  if (NET.test(msg)) return "network";
  return "unknown";
}

const detail = (e: unknown) => (e instanceof GrammyError ? `${e.error_code} ${e.description}` : e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Telegram HTML for the user. Unknown errors carry the technical text so it can be forwarded. */
export function friendly(e: unknown, lang: Lang): string {
  const p = classify(e);
  return p === "unknown" ? `${MSG.unknown[lang]}\n<code>${esc(detail(e))}</code>` : MSG[p][lang];
}

/** Plain English hint for the AI model, so it explains a failed tool the same way. */
export function hintFor(e: unknown): string | undefined {
  const p = classify(e);
  return p === "unknown" ? undefined : MSG[p].en.replace(/<\/?code>/g, "");
}

/** Problems that need a person to act; background jobs report them to HR (at most every 6 hours). */
const NEEDS_ADMIN: Problem[] = ["openai_key", "openai_quota", "openai_model", "google_reconnect", "google_api_off"];

export async function alertHr(e: unknown, where: string): Promise<void> {
  const p = classify(e);
  if (!NEEDS_ADMIN.includes(p)) return;
  const key = `alert_${p}`;
  const last = Number(getSetting(key) ?? 0);
  if (Date.now() - last < 6 * 3600_000) return;
  setSetting(key, String(Date.now()));
  const head: Record<Lang, string> = { uz: "⚠️ <b>Bot muammosi</b>", ru: "⚠️ <b>Проблема бота</b>", en: "⚠️ <b>Bot problem</b>" };
  await sendHr((lang) => ({ html: `${head[lang]} (${esc(where)})\n${MSG[p][lang]}` })).catch(() => false);
}
