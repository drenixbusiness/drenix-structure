/**
 * Recruiting numbers from the Google Sheet ("Рекрутинг и отчёт"): dashboard (text + PDF)
 * and the recruiting block of the daily/weekly/monthly report.
 * Tabs and columns are found by their headers, so renamed/reordered tabs keep working;
 * a missing tab only drops its section.
 */
import PDFDocument from "pdfkit";
import * as sheets from "../google/sheets.js";
import { sheetsGranted } from "../google/calendar.js";
import type { Lang } from "../i18n.js";
import { esc } from "../tg.js";
import { fmtDay, isoLocal, ymdOf } from "../time.js";
import { C, FONT, FONT_BOLD } from "./reports.js";

type Count = [string, number][];

export interface RecruitingStats {
  title: string;
  from?: string;
  to?: string;
  apps: {
    total: number;
    byDay: Count;
    byPosition: Count;
    bySource: Count;
    reasons: Count;
    withCv: number;
    under18: number;
    avgAge: number | null;
    funnel: { reviewed: number; step1Passed: number; step2Passed: number; approved: number; rejected: number; awaiting: number; inProgress: number };
  } | null;
  candidates: { total: number; byStatus: Count; byInterviewer: Count; byPosition: Count; started: number; left: number; retention: number | null } | null;
  vacancies: { open: number; remaining: number; items: { position: string; company: string; remaining: number; recruiter: string }[]; byRecruiter: Count } | null;
  expenses: { total: number; count: number; byReason: Count } | null;
}

// ---------------- parsing helpers ----------------

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const col = (headers: string[], ...pats: RegExp[]) => {
  for (const p of pats) {
    const i = headers.findIndex((h) => p.test(norm(h)));
    if (i >= 0) return i;
  }
  return -1;
};
const cell = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
const nonEmpty = (rows: string[][]) => rows.filter((r) => r.some((c) => String(c).trim()));

/** "22.10.2026 7:07:51" / "22.10.2026" / "2026-10-22" → "2026-10-22" */
export function sheetDate(v: string): string | null {
  const m = v.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const iso = v.match(/(\d{4})-(\d\d)-(\d\d)/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}
const amount = (v: string) => {
  const n = Number(v.replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const tally = (vals: string[], limit = 12): Count => {
  const m = new Map<string, number>();
  for (const v of vals) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  const all = [...m.entries()].sort((a, b) => b[1] - a[1]);
  if (all.length <= limit) return all;
  const rest = all.slice(limit - 1).reduce((s, [, n]) => s + n, 0);
  return [...all.slice(0, limit - 1), ["…", rest]];
};
/** Display form of a cell: links from readTab ("H (https://…)") dropped, spaces collapsed, first letter capital. */
const title = (s: string) =>
  s
    .replace(/\s*\(https?:\/\/[^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());

/** Free-text positions from the form → a few groups ("Hr driver recruiter" → "Driver recruiter"). */
function positionGroup(v: string): string {
  const s = norm(v);
  if (!s) return "";
  if (/driver/.test(s)) return "Driver recruiter";
  if (/recruit|hr\b|^hr|кадр/.test(s)) return "HR / Recruiter";
  if (/updat/.test(s)) return "Updater";
  if (/fleet/.test(s)) return "Fleet";
  if (/dispatch/.test(s)) return "Dispatcher";
  if (/safety/.test(s)) return "Safety";
  if (/account|бухгал/.test(s)) return "Accounting";
  return title(v.split(",")[0]);
}
function sourceGroup(v: string): string {
  const s = norm(title(v));
  if (!s) return "—";
  if (/nvl|new vacancy/.test(s)) return "NVL";
  if (/\bdh\b|dispatch hunter|\blj\b|logistics jobs/.test(s)) return "DH | LJ";
  if (/telegram/.test(s)) return "Telegram";
  if (/hh/.test(s)) return "hh.uz";
  return title(v);
}
const inRange = (d: string | null, from?: string, to?: string) => !from || !to || (!!d && d >= from && d <= to);

// ---------------- stats ----------------

export async function recruitingStats(from?: string, to?: string, spreadsheet?: string): Promise<RecruitingStats> {
  const ref = sheets.parseSheetRef(spreadsheet);
  const info = await sheets.spreadsheetInfo(ref);
  const tabs = await Promise.all(info.tabs.slice(0, 12).map(async (tb) => ({ tab: tb, ...(await sheets.readTab(ref, tb.title)) })));
  const has = (t: (typeof tabs)[number], ...pats: RegExp[]) => pats.every((p) => col(t.headers, p) >= 0);
  const out: RecruitingStats = { title: info.title.trim(), from, to, apps: null, candidates: null, vacancies: null, expenses: null };

  // application form answers
  const form = tabs.find((t) => has(t, /full name|ф\.?и\.?о/, /position|должност/, /step 1/)) ?? tabs.find((t) => t.tab.gid === ref.gid);
  if (form) {
    const h = form.headers;
    const iTs = 0, iBirth = col(h, /birth|рожд/), iPos = col(h, /position|должност/), iCv = col(h, /^cv|резюме/), iSrc = col(h, /hear|source|откуда/);
    const i1 = col(h, /step 1/), i2 = col(h, /step 2/), iF = col(h, /final|decision|desicion|решени/), iR = col(h, /comment|reason|причин/);
    const rows = nonEmpty(form.rows).filter((r) => inRange(sheetDate(cell(r, iTs)), from, to));
    const today = ymdOf(new Date());
    const ages = rows
      .map((r) => sheetDate(cell(r, iBirth)))
      .filter((d): d is string => !!d)
      .map((d) => {
        const [y, m, dd] = d.split("-").map(Number);
        const [ty, tm, td] = today.split("-").map(Number);
        return ty - y - (tm < m || (tm === m && td < dd) ? 1 : 0);
      })
      .filter((a) => a > 10 && a < 80);
    const rej = (r: string[]) => [i1, i2, iF].some((i) => /reject|rad|отказ/i.test(cell(r, i)));
    const ok = (v: string) => /done|pass|approv|aprov|accept|hired|o'?tdi|qabul|принят|одобр/i.test(v);
    const f = { reviewed: 0, step1Passed: 0, step2Passed: 0, approved: 0, rejected: 0, awaiting: 0, inProgress: 0 };
    for (const r of rows) {
      const s1 = cell(r, i1), s2 = cell(r, i2), fin = cell(r, iF);
      if (s1) f.reviewed++;
      if (ok(s1)) f.step1Passed++;
      if (ok(s2)) f.step2Passed++;
      if (rej(r)) f.rejected++;
      else if (ok(fin)) f.approved++;
      else if (!s1) f.awaiting++;
      else f.inProgress++;
    }
    out.apps = {
      total: rows.length,
      byDay: tally(rows.map((r) => sheetDate(cell(r, iTs)) ?? ""), 400).sort((a, b) => a[0].localeCompare(b[0])),
      byPosition: tally(rows.map((r) => positionGroup(cell(r, iPos)))),
      bySource: tally(rows.map((r) => sourceGroup(cell(r, iSrc)))),
      reasons: tally(rows.filter(rej).map((r) => title(cell(r, iR))), 8),
      withCv: rows.filter((r) => /https?:\/\//.test(cell(r, iCv))).length,
      under18: ages.filter((a) => a < 18).length,
      avgAge: ages.length ? Math.round((ages.reduce((s, a) => s + a, 0) / ages.length) * 10) / 10 : null,
      funnel: f,
    };
  }

  // interviewed candidates
  const cand = tabs.find((t) => t !== form && has(t, /ф\.?и\.?о|full name|name/, /статус|status/) && col(t.headers, /интервьюер|interviewer/) >= 0);
  if (cand) {
    const h = cand.headers;
    const iSt = col(h, /^статус|^status/), iInt = col(h, /интервьюер|interviewer/), iPos = col(h, /должност|position/), iDate = col(h, /дата|date/);
    const rows = nonEmpty(cand.rows).filter((r) => cell(r, 0) && inRange(sheetDate(cell(r, iDate)), from, to));
    const started = rows.filter((r) => /start|work|ishga|вышел|работ/i.test(cell(r, iSt))).length;
    const left = rows.filter((r) => /left|ушел|ушёл|ketdi/i.test(cell(r, iSt))).length;
    out.candidates = {
      total: rows.length,
      byStatus: tally(rows.map((r) => title(cell(r, iSt)) || "—")),
      byInterviewer: tally(rows.map((r) => title(cell(r, iInt)) || "—")),
      byPosition: tally(rows.map((r) => title(cell(r, iPos)))),
      started,
      left,
      retention: started + left ? Math.round((started / (started + left)) * 100) : null,
    };
  }

  // open vacancies (always a snapshot)
  const vac = tabs.find((t) => /vacanc|ваканс/i.test(t.tab.title) || has(t, /вакансия лавозими|vacancy|position/, /колдик|remaining|остат/));
  if (vac) {
    const h = vac.headers;
    const iPos = col(h, /лавозими|position|должност/), iSt = col(h, /^статус|^status/), iRem = col(h, /колдик|remaining|остат/), iCnt = col(h, /вакансия сони|count|количеств/);
    const iDep = col(h, /компания|company/, /булими|болими|department|отдел/), iRec = col(h, /жавобгар|recruiter|ответствен/);
    const items = nonEmpty(vac.rows)
      .filter((r) => cell(r, iPos) && !/закр|close|yopil|ёпил/i.test(cell(r, iSt)))
      .map((r) => ({ position: title(cell(r, iPos)), company: cell(r, iDep), remaining: iRem >= 0 ? amount(cell(r, iRem)) : amount(cell(r, iCnt)), recruiter: title(cell(r, iRec)) }))
      .filter((v) => v.remaining > 0);
    // identical vacancies (same position + company) are listed once with the summed seats
    const merged = new Map<string, (typeof items)[number]>();
    for (const it of items) {
      const k = `${norm(it.position)}|${norm(it.company)}`;
      const m = merged.get(k);
      if (m) m.remaining += it.remaining;
      else merged.set(k, { ...it, company: title(it.company) });
    }
    out.vacancies = {
      open: items.length,
      remaining: items.reduce((s, v) => s + v.remaining, 0),
      items: [...merged.values()].sort((a, b) => b.remaining - a.remaining),
      byRecruiter: tally(items.map((v) => v.recruiter || "—")),
    };
  }

  // expenses
  const exp = tabs.find((t) => /soqqa|xarajat|расход|expense/i.test(t.tab.title) || has(t, /amount|сумма|summa/, /reason|причин|sabab/));
  if (exp) {
    const h = exp.headers;
    const iAm = col(h, /amount|сумма|summa/), iRe = col(h, /reason|причин|sabab/), iD = col(h, /date|дата|sana/);
    const rows = nonEmpty(exp.rows).filter((r) => cell(r, iAm) && inRange(sheetDate(cell(r, iD)), from, to));
    const by = new Map<string, number>();
    for (const r of rows) by.set(title(cell(r, iRe)) || "—", (by.get(title(cell(r, iRe)) || "—") ?? 0) + amount(cell(r, iAm)));
    out.expenses = { total: rows.reduce((s, r) => s + amount(cell(r, iAm)), 0), count: rows.length, byReason: [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8) };
  }
  return out;
}

// ---------------- applicant lists ----------------

export type ApplicantStatus = "not_reviewed" | "in_progress" | "rejected" | "approved" | "all";
export interface Applicant {
  row: number;
  name: string;
  phone: string;
  position: string;
  date: string;
  cv: string | null;
  status: Exclude<ApplicantStatus, "all">;
}

/** Applicants of the form tab with a computed pipeline status, newest first. */
export async function listApplicants(o: { status?: ApplicantStatus; position?: string; query?: string; from?: string; to?: string; spreadsheet?: string }) {
  const ref = sheets.parseSheetRef(o.spreadsheet);
  const { tabs } = await sheets.spreadsheetInfo(ref);
  let tab = tabs.find((x) => x.gid === ref.gid) ?? tabs[0];
  let data = await sheets.readTab(ref, tab.title);
  if (col(data.headers, /step 1/) < 0) {
    for (const tb of tabs) {
      const d = await sheets.readTab(ref, tb.title);
      if (col(d.headers, /full name/) >= 0 && col(d.headers, /step 1/) >= 0) {
        tab = tb;
        data = d;
        break;
      }
    }
  }
  const h = data.headers;
  const iName = col(h, /full name|ф\.?и\.?о/), iPhone = col(h, /phone|телефон/), iPos = col(h, /position|должност/), iCv = col(h, /^cv|резюме/);
  const i1 = col(h, /step 1/), i2 = col(h, /step 2/), iF = col(h, /final|decision|desicion|решени/);
  const ok = (v: string) => /done|pass|approv|aprov|accept|hired|qabul|принят|одобр/i.test(v);
  const q = o.query?.toLowerCase().trim();
  const all: Applicant[] = data.rows
    .map((r, i) => ({ r, row: i + 2 }))
    .filter(({ r }) => r.some((c) => String(c).trim()))
    .map(({ r, row }) => {
      const rejected = [i1, i2, iF].some((i) => /reject|rad|отказ/i.test(cell(r, i)));
      const status: Applicant["status"] = rejected ? "rejected" : ok(cell(r, iF)) ? "approved" : !cell(r, i1) ? "not_reviewed" : "in_progress";
      return {
        row,
        name: title(cell(r, iName)),
        phone: cell(r, iPhone),
        position: title(cell(r, iPos)),
        date: sheetDate(cell(r, 0)) ?? "",
        cv: cell(r, iCv).match(/https?:\/\/\S+?(?=\)|$)/)?.[0] ?? null,
        status,
        _all: r.join(" ").toLowerCase(),
      };
    })
    .filter((a) => !o.status || o.status === "all" || a.status === o.status)
    .filter((a) => !o.position || positionGroup(a.position) === positionGroup(o.position) || a.position.toLowerCase().includes(o.position.toLowerCase()))
    .filter((a) => !q || a._all.includes(q))
    .filter((a) => inRange(a.date || null, o.from, o.to))
    .map(({ _all, ...a }) => a)
    .reverse();
  return { tab: tab.title, applicants: all };
}

const STATUS_LBL: Record<Lang, Record<ApplicantStatus, string>> = {
  uz: { not_reviewed: "Ko'rib chiqilmagan arizalar", in_progress: "Jarayondagi arizalar", rejected: "Rad etilgan arizalar", approved: "Tasdiqlangan arizalar", all: "Arizalar" },
  ru: { not_reviewed: "Не рассмотренные заявки", in_progress: "Заявки в процессе", rejected: "Отклонённые заявки", approved: "Одобренные заявки", all: "Заявки" },
  en: { not_reviewed: "Not reviewed applications", in_progress: "Applications in progress", rejected: "Rejected applications", approved: "Approved applications", all: "Applications" },
};

export function applicantsText(list: Applicant[], total: number, status: ApplicantStatus, lang: Lang): string {
  const shown = list.length < total ? { uz: ` · jami ${total}, oxirgi ${list.length} ta`, ru: ` · всего ${total}, последние ${list.length}`, en: ` · ${total} total, latest ${list.length}` }[lang] : ` · ${total}`;
  if (!total) return `📋 <b>${STATUS_LBL[lang][status]}</b> · 0`;
  const lines = list.map(
    (a) => `<code>#${a.row}</code> <b>${esc(a.name || "—")}</b> — ${esc(a.position.length > 40 ? `${a.position.slice(0, 40)}…` : a.position || "—")}${a.date ? ` · ${a.date.slice(8)}.${a.date.slice(5, 7)}` : ""}${a.cv ? ` · <a href="${esc(a.cv)}">CV</a>` : ""}`,
  );
  return `📋 <b>${STATUS_LBL[lang][status]}</b>${shown}\n\n${lines.join("\n")}`;
}

// ---------------- labels ----------------

const LBL: Record<Lang, Record<string, string>> = {
  uz: {
    dash: "Recruiting dashboard", all: "Barcha vaqt", apps: "Arizalar", awaiting: "Ko'rib chiqilmagan", progress: "Jarayonda", approved: "Tasdiqlangan", rejected: "Rad etilgan",
    vacOpen: "Ochiq vakansiyalar", seats: "o'rin", started: "Ishga chiqqan", left: "Stajirovkadan ketgan", retention: "Saqlanish", byDay: "Kunlar bo'yicha arizalar", positions: "Lavozimlar",
    sources: "Manbalar", reasons: "Rad etish sabablari", funnel: "Voronka", f_applied: "Ariza", f_reviewed: "Ko'rib chiqilgan", f_s1: "Online intervyu o'tdi", f_s2: "Offline intervyu o'tdi",
    f_ok: "Tasdiqlangan", cands: "Intervyu o'tganlar (Кандидаты)", interviewers: "Intervyuerlar", statuses: "Statuslar", vacs: "Ochiq vakansiyalar (qolgan o'rin)", recruiters: "Mas'ul recruiterlar",
    expenses: "Xarajatlar", cv: "CV fayli bor", age: "O'rtacha yosh", under18: "18 yoshgacha", total: "Jami", rep: "Recruiting", newApps: "Yangi arizalar", now: "hozirgi holat",
    interviews: "Intervyular (Кандидаты)", none: "Ma'lumot yo'q",
  },
  ru: {
    dash: "Recruiting дашборд", all: "За всё время", apps: "Заявки", awaiting: "Не рассмотрены", progress: "В процессе", approved: "Одобрены", rejected: "Отказ",
    vacOpen: "Открытые вакансии", seats: "мест", started: "Вышли на работу", left: "Ушли со стажировки", retention: "Удержание", byDay: "Заявки по дням", positions: "Должности",
    sources: "Источники", reasons: "Причины отказа", funnel: "Воронка", f_applied: "Заявка", f_reviewed: "Рассмотрено", f_s1: "Онлайн интервью пройдено", f_s2: "Офлайн интервью пройдено",
    f_ok: "Одобрено", cands: "Прошли интервью (Кандидаты)", interviewers: "Интервьюеры", statuses: "Статусы", vacs: "Открытые вакансии (осталось мест)", recruiters: "Ответственные рекрутеры",
    expenses: "Расходы", cv: "С файлом CV", age: "Средний возраст", under18: "Младше 18", total: "Итого", rep: "Рекрутинг", newApps: "Новые заявки", now: "текущее состояние",
    interviews: "Интервью (Кандидаты)", none: "Нет данных",
  },
  en: {
    dash: "Recruiting dashboard", all: "All time", apps: "Applications", awaiting: "Not reviewed", progress: "In progress", approved: "Approved", rejected: "Rejected",
    vacOpen: "Open vacancies", seats: "seats", started: "Started work", left: "Left internship", retention: "Retention", byDay: "Applications by day", positions: "Positions",
    sources: "Sources", reasons: "Rejection reasons", funnel: "Funnel", f_applied: "Applied", f_reviewed: "Reviewed", f_s1: "Passed online interview", f_s2: "Passed offline interview",
    f_ok: "Approved", cands: "Interviewed (Кандидаты)", interviewers: "Interviewers", statuses: "Statuses", vacs: "Open vacancies (seats left)", recruiters: "Responsible recruiters",
    expenses: "Expenses", cv: "With CV file", age: "Average age", under18: "Under 18", total: "Total", rep: "Recruiting", newApps: "New applications", now: "current state",
    interviews: "Interviews (Кандидаты)", none: "No data",
  },
};

const periodText = (s: RecruitingStats, lang: Lang) =>
  !s.from || !s.to ? LBL[lang].all : s.from === s.to ? fmtDay(s.from, lang, true) : `${fmtDay(s.from, lang)} — ${fmtDay(s.to, lang)}`;
const money = (n: number) => Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
const list = (c: Count, n = 6) => c.slice(0, n).map(([k, v]) => `${esc(k)} ${v}`).join(" · ");

// ---------------- dashboard text ----------------

export function dashboardText(s: RecruitingStats, lang: Lang): string {
  const L = LBL[lang];
  const o = [`📊 <b>${L.dash}</b> · ${periodText(s, lang)}`];
  const a = s.apps;
  if (a) {
    o.push(
      "",
      `<b>${L.apps}: ${a.total}</b>`,
      `• ${L.awaiting}: <b>${a.funnel.awaiting}</b> · ${L.progress}: <b>${a.funnel.inProgress}</b>`,
      `• ${L.approved}: <b>${a.funnel.approved}</b> · ${L.rejected}: <b>${a.funnel.rejected}</b>`,
      `• ${L.funnel}: ${a.total} → ${a.funnel.reviewed} → ${a.funnel.step1Passed} → ${a.funnel.step2Passed} → ${a.funnel.approved}`,
      `  <i>${L.f_applied} → ${L.f_reviewed} → ${L.f_s1} → ${L.f_s2} → ${L.f_ok}</i>`,
    );
    if (a.byPosition.length) o.push(`• ${L.positions}: ${list(a.byPosition)}`);
    if (a.bySource.length) o.push(`• ${L.sources}: ${list(a.bySource)}`);
    if (a.reasons.length) o.push(`• ${L.reasons}: ${list(a.reasons, 4)}`);
    o.push(`• ${L.cv}: ${a.withCv}/${a.total}${a.avgAge !== null ? ` · ${L.age}: ${a.avgAge}` : ""}${a.under18 ? ` · ${L.under18}: ${a.under18}` : ""}`);
  }
  const c = s.candidates;
  if (c?.total) {
    o.push("", `<b>${L.cands}: ${c.total}</b>`, `• ${L.started}: <b>${c.started}</b> · ${L.left}: <b>${c.left}</b>${c.retention !== null ? ` · ${L.retention}: <b>${c.retention}%</b>` : ""}`);
    o.push(`• ${L.interviewers}: ${list(c.byInterviewer)}`);
  }
  const v = s.vacancies;
  if (v) {
    o.push("", `<b>${L.vacOpen}: ${v.open} · ${v.remaining} ${L.seats}</b>`, ...v.items.slice(0, 10).map((x) => `• ${esc(x.position)}${x.company ? ` (${esc(x.company)})` : ""} — ${x.remaining}`));
    if (v.items.length > 10) o.push(`• … +${v.items.length - 10}`);
  }
  if (s.expenses?.count) o.push("", `<b>${L.expenses}: ${money(s.expenses.total)}</b>`, `• ${s.expenses.byReason.slice(0, 5).map(([k, n]) => `${esc(k)} ${money(n)}`).join(" · ")}`);
  if (!a && !c && !v) o.push("", L.none);
  return o.join("\n");
}

/** Recruiting block for the regular report: new applications in the period + current pipeline state. */
export async function recruitingReportLines(from: string, to: string, lang: Lang): Promise<{ title: string; lines: string[] } | null> {
  if (!sheetsGranted()) return null;
  try {
    const [p, now] = await Promise.all([recruitingStats(from, to), recruitingStats()]);
    const L = LBL[lang];
    const lines: string[] = [];
    if (p.apps) lines.push(`${L.newApps}: ${p.apps.total}${p.apps.byPosition.length ? ` (${p.apps.byPosition.slice(0, 4).map(([k, n]) => `${k} ${n}`).join(", ")})` : ""}`);
    if (p.candidates) lines.push(`${L.interviews}: ${p.candidates.total}`);
    if (now.apps) lines.push(`${L.awaiting}: ${now.apps.funnel.awaiting} · ${L.progress}: ${now.apps.funnel.inProgress} (${L.now})`);
    if (now.vacancies) lines.push(`${L.vacOpen}: ${now.vacancies.open} · ${now.vacancies.remaining} ${L.seats}`);
    return lines.length ? { title: L.rep, lines } : null;
  } catch (e) {
    console.error("recruiting report block failed:", (e as Error).message);
    return null;
  }
}

// ---------------- dashboard PDF ----------------

export function dashboardPdf(s: RecruitingStats, lang: Lang): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const L = LBL[lang];
    const doc = new PDFDocument({ size: "A4", margin: 44, info: { Title: `Drenix ${L.dash}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("r", FONT);
    doc.registerFont("b", FONT_BOLD);
    const W = doc.page.width - 88;
    const footer = () => {
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fill(C.muted).font("r").fontSize(8).text(`Drenix Assistant · ${s.title} · ${isoLocal(new Date()).slice(0, 16).replace("T", " ")} (Tashkent)`, 44, doc.page.height - 34, { width: W, align: "right", lineBreak: false });
      doc.page.margins.bottom = bottom;
    };
    const room = (h: number) => {
      if (y + h > doc.page.height - 60) {
        footer();
        doc.addPage();
        y = 50;
      }
    };

    doc.rect(0, 0, doc.page.width, 96).fill(C.bg);
    doc.fill(C.accent).font("b").fontSize(11).text("DRENIX", 44, 30, { characterSpacing: 3 });
    doc.fill("#f3ece8").font("b").fontSize(20).text(L.dash, 44, 48);
    doc.fill("#bfb3ad").font("r").fontSize(10).text(`${periodText(s, lang)} · ${s.title}`, 44, 74);
    let y = 120;

    const a = s.apps, c = s.candidates, v = s.vacancies;
    const tiles: [string, string][] = [];
    if (a) tiles.push([L.apps, String(a.total)], [L.awaiting, String(a.funnel.awaiting)], [L.progress, String(a.funnel.inProgress)], [L.rejected, String(a.funnel.rejected)]);
    if (v) tiles.push([`${L.vacOpen} / ${L.seats}`, `${v.open} / ${v.remaining}`]);
    if (c) tiles.push([L.started, String(c.started)], [L.left, String(c.left)], [L.retention, c.retention === null ? "—" : `${c.retention}%`]);
    const tw = (W - 3 * 10) / 4;
    tiles.forEach(([label, value], i) => {
      const x = 44 + (i % 4) * (tw + 10);
      const ty = y + Math.floor(i / 4) * 70;
      doc.roundedRect(x, ty, tw, 60, 8).fill(i === 1 ? C.soft : "#f7f3f0");
      doc.fill(i === 1 ? C.accent : C.ink).font("b").fontSize(18).text(value, x + 12, ty + 12, { width: tw - 24 });
      doc.fill(C.muted).font("r").fontSize(8).text(label, x + 12, ty + 38, { width: tw - 24 });
    });
    y += Math.ceil(tiles.length / 4) * 70 + 14;

    const heading = (t: string) => {
      room(60);
      doc.fill(C.ink).font("b").fontSize(12).text(t, 44, y);
      y += 22;
    };
    const hbars = (t: string, items: [string, number, string?][]) => {
      if (!items.length) return;
      heading(t);
      const max = Math.max(1, ...items.map((i) => i[1]));
      const lw = W * 0.38;
      for (const [label, n, shown] of items) {
        room(18);
        doc.fill(C.ink).font("r").fontSize(9).text(label, 44, y + 1, { width: lw - 8, height: 12, ellipsis: true, lineBreak: false });
        const bw = Math.max(2, ((W - lw - 70) * n) / max);
        doc.roundedRect(44 + lw, y + 1, W - lw - 70, 10, 3).fill(C.track);
        doc.roundedRect(44 + lw, y + 1, bw, 10, 3).fill(C.accent);
        doc.fill(C.muted).font("b").fontSize(9).text(shown ?? String(n), 44 + W - 62, y + 1, { width: 62, align: "right", lineBreak: false });
        y += 17;
      }
      y += 12;
    };

    if (a && a.byDay.length > 1) {
      heading(L.byDay);
      const days = a.byDay.slice(-31);
      const h = 120;
      const max = Math.max(1, ...days.map((d) => d[1]));
      const slot = W / days.length;
      const bw = Math.min(26, slot * 0.6);
      doc.moveTo(44, y + h).lineTo(44 + W, y + h).lineWidth(0.5).stroke(C.line);
      days.forEach(([d, n], i) => {
        const x = 44 + i * slot + (slot - bw) / 2;
        const bh = (n / max) * (h - 16);
        doc.roundedRect(x, y + h - bh, bw, bh, 3).fill(C.accent);
        doc.fill(C.muted).font("r").fontSize(7).text(String(n), x - 8, y + h - bh - 11, { width: bw + 16, align: "center" });
        if (days.length <= 16 || i % 2 === 0) doc.fill(C.muted).font("r").fontSize(7).text(`${d.slice(8)}.${d.slice(5, 7)}`, x - 10, y + h + 4, { width: bw + 20, align: "center" });
      });
      y += h + 30;
    }
    if (a) {
      hbars(L.funnel, [
        [L.f_applied, a.total],
        [L.f_reviewed, a.funnel.reviewed],
        [L.f_s1, a.funnel.step1Passed],
        [L.f_s2, a.funnel.step2Passed],
        [L.f_ok, a.funnel.approved],
      ]);
      hbars(L.positions, a.byPosition);
      hbars(L.sources, a.bySource);
      hbars(L.reasons, a.reasons);
    }
    if (v) hbars(L.vacs, v.items.slice(0, 20).map((x) => [`${x.position}${x.company ? ` · ${x.company}` : ""}`, x.remaining]));
    if (v) hbars(L.recruiters, v.byRecruiter);
    if (c?.total) {
      hbars(L.statuses, c.byStatus);
      hbars(L.interviewers, c.byInterviewer);
    }
    if (s.expenses?.count) hbars(`${L.expenses} · ${L.total} ${money(s.expenses.total)}`, s.expenses.byReason.map(([k, n]) => [k, n, money(n)]));
    footer();
    doc.end();
  });
}

export const dashboardFileName = (s: RecruitingStats) => `drenix-recruiting-dashboard-${s.to ?? ymdOf(new Date())}.pdf`;
