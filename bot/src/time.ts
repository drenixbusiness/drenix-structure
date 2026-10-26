/**
 * Time helpers for Asia/Tashkent (UTC+5, no DST) and the overnight shift model:
 * a shift that starts at 17:00 on Oct 22 and ends at 02:00 on Oct 23 is "the Oct 22 workday".
 */
import { config } from "./config.js";
import type { Lang } from "./i18n.js";

export const TZ_OFFSET_MIN = 300;
export const TZ_NAME = "Asia/Tashkent";
const MS_MIN = 60_000;
const MS_DAY = 86_400_000;

export interface LocalParts {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  min: number;
  dow: number; // 0 = Sunday
}

export function local(date: Date): LocalParts {
  const t = new Date(date.getTime() + TZ_OFFSET_MIN * MS_MIN);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), min: t.getUTCMinutes(), dow: t.getUTCDay() };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the local calendar day */
export const ymdOf = (date: Date) => {
  const p = local(date);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
};

/** Date for local YYYY-MM-DD + minutes after midnight */
export function atLocal(ymd: string, minutes: number): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + (minutes - TZ_OFFSET_MIN) * MS_MIN);
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * MS_DAY);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export const dowOf = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

const overnight = () => config.shiftEnd <= config.shiftStart;

/** Which workday (shift date) a moment belongs to. 00:00–02:00 belongs to the previous date. */
export function shiftDateOf(date: Date): string {
  const p = local(date);
  const mins = p.h * 60 + p.min;
  const day = ymdOf(date);
  return overnight() && mins < config.shiftEnd ? addDays(day, -1) : day;
}

export function shiftBounds(shiftDate: string): { start: Date; end: Date } {
  const start = atLocal(shiftDate, config.shiftStart);
  const end = atLocal(overnight() ? addDays(shiftDate, 1) : shiftDate, config.shiftEnd);
  return { start, end };
}

export const isWorkday = (shiftDate: string) => !config.offDays.includes(dowOf(shiftDate));

/** The shift now in progress, or the next one to start. */
export function currentOrNextShift(now = new Date()): string {
  let sd = shiftDateOf(now);
  for (let i = 0; i < 8 && (!isWorkday(sd) || shiftBounds(sd).end <= now); i++) sd = addDays(sd, 1);
  return sd;
}

/** n workdays starting at (and including) `from` when it is a workday */
export function workdaysFrom(from: string, n: number): string[] {
  const out: string[] = [];
  let sd = from;
  for (let i = 0; out.length < n && i < n * 3 + 7; i++, sd = addDays(sd, 1)) if (isWorkday(sd)) out.push(sd);
  return out;
}

export const inShift = (date: Date) => {
  const sd = shiftDateOf(date);
  const { start, end } = shiftBounds(sd);
  return isWorkday(sd) && date >= start && date < end;
};

/** ISO with +05:00 offset — what the AI sees and returns */
export function isoLocal(date: Date): string {
  const p = local(date);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}:00+05:00`;
}

/** Parses ISO; a value without an offset is read as Tashkent time. */
export function parseIso(s: string): Date | null {
  if (!s) return null;
  const v = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.length === 10 ? `${s}T00:00:00` : s}+05:00`;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MONTHS: Record<Lang, string[]> = {
  uz: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"],
  ru: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};
const DOW: Record<Lang, string[]> = {
  uz: ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"],
  ru: ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

export const fmtTime = (date: Date) => {
  const p = local(date);
  return `${pad(p.h)}:${pad(p.min)}`;
};

export function fmtDay(ymd: string, lang: Lang, withDow = false): string {
  const [, m, d] = ymd.split("-").map(Number);
  const mon = MONTHS[lang][m - 1];
  const base = lang === "en" ? `${mon} ${d}` : lang === "uz" ? `${d}-${mon}` : `${d} ${mon}`;
  return withDow ? `${base}, ${DOW[lang][dowOf(ymd)]}` : base;
}

export const fmtDateTime = (date: Date, lang: Lang, withDow = false) => `${fmtDay(ymdOf(date), lang, withDow)}, ${fmtTime(date)}`;

export const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / MS_MIN);
export const addMinutes = (d: Date, n: number) => new Date(d.getTime() + n * MS_MIN);
