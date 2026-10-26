/**
 * Analytics for Google Form responses: per-question statistics, an AI read of the answers
 * (summary, themes of open answers, per-respondent assessment) and charts, exported as PDF, Word and Excel.
 * Charts are SVG rendered to PNG once and embedded in both PDF and Word.
 */
import { dirname } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { modelOpts, openai } from "../ai/client.js";
import { config } from "../config.js";
import * as gforms from "../google/forms.js";
import { LANG_NAME, type Lang } from "../i18n.js";
import { esc } from "../tg.js";
import { fmtDay, isoLocal, ymdOf } from "../time.js";
import { markSeen, type StoredForm } from "./forms.js";
import { C, FONT, FONT_BOLD } from "./reports.js";

export type QuestionKind = "choice" | "multi" | "scale" | "text" | "date" | "other";

export interface QuestionStat {
  index: number; // 1-based, as shown in the report
  title: string;
  kind: QuestionKind;
  answered: number;
  counts?: [string, number][];
  avg?: number;
  low?: number;
  high?: number;
  texts?: string[];
  theme?: string; // AI summary of open answers
  identity?: "name" | "phone" | "email";
}

export interface Respondent {
  n: number;
  name: string;
  at: Date;
  answers: Record<number, string>; // question index → answer
}

export interface Assessment {
  n: number;
  score: number;
  verdict: "strong" | "maybe" | "weak";
  note: string;
}

export interface FormAnalysis {
  formId: string;
  title: string;
  purpose: string | null;
  responderUri: string;
  from?: string;
  to?: string;
  total: number;
  first?: Date;
  last?: Date;
  completion: number | null; // avg % of questions answered
  byDay: [string, number][];
  questions: QuestionStat[];
  respondents: Respondent[];
  ai: { summary: string[]; recommendations: string[]; scores: Assessment[] } | null;
}

export type ReportFormat = "pdf" | "docx" | "xlsx";

const LBL: Record<Lang, Record<string, string>> = {
  uz: {
    title: "Forma javoblari tahlili", responses: "Javoblar", questions: "Savollar", completion: "To'ldirilganlik", avgScore: "O'rtacha baho",
    summary: "Asosiy xulosalar", byDay: "Kunlar bo'yicha javoblar", answered: "javob berdi", avg: "o'rtacha", themes: "Javoblar mazmuni", samples: "Javoblardan namunalar",
    ranking: "Kandidatlar bahosi (AI)", rankingNote: "AI baho faqat javoblar mazmuni bo'yicha; yakuniy qaror HR'niki.", name: "Kandidat", score: "Baho", verdict: "Xulosa", note: "Izoh",
    recs: "Tavsiyalar", strong: "kuchli", maybe: "o'ylab ko'rish", weak: "zaif", none: "Hali javob yo'q.", all: "Barcha vaqt", appendix: "Barcha javoblar", submitted: "Yuborilgan",
    type: "Tur", top: "Eng ko'p javob", sheetResp: "Javoblar", sheetQ: "Savollar", sheetAi: "AI xulosa", period: "Davr", link: "Forma havolasi", other: "Boshqa",
    kind_choice: "bitta tanlov", kind_multi: "bir nechta tanlov", kind_scale: "shkala", kind_text: "matn", kind_date: "sana", kind_other: "boshqa",
  },
  ru: {
    title: "Анализ ответов формы", responses: "Ответы", questions: "Вопросы", completion: "Заполненность", avgScore: "Средняя оценка",
    summary: "Главные выводы", byDay: "Ответы по дням", answered: "ответили", avg: "среднее", themes: "Содержание ответов", samples: "Примеры ответов",
    ranking: "Оценка кандидатов (AI)", rankingNote: "AI оценивает только содержание ответов; окончательное решение за HR.", name: "Кандидат", score: "Оценка", verdict: "Вывод", note: "Комментарий",
    recs: "Рекомендации", strong: "сильный", maybe: "подумать", weak: "слабый", none: "Ответов пока нет.", all: "За всё время", appendix: "Все ответы", submitted: "Отправлено",
    type: "Тип", top: "Чаще всего", sheetResp: "Ответы", sheetQ: "Вопросы", sheetAi: "Выводы AI", period: "Период", link: "Ссылка на форму", other: "Другое",
    kind_choice: "один вариант", kind_multi: "несколько вариантов", kind_scale: "шкала", kind_text: "текст", kind_date: "дата", kind_other: "другое",
  },
  en: {
    title: "Form responses analysis", responses: "Responses", questions: "Questions", completion: "Completion", avgScore: "Average score",
    summary: "Key findings", byDay: "Responses by day", answered: "answered", avg: "average", themes: "What people said", samples: "Sample answers",
    ranking: "Candidate assessment (AI)", rankingNote: "The AI score looks only at the content of the answers; the final decision is HR's.", name: "Candidate", score: "Score", verdict: "Verdict", note: "Note",
    recs: "Recommendations", strong: "strong", maybe: "maybe", weak: "weak", none: "No responses yet.", all: "All time", appendix: "All responses", submitted: "Submitted",
    type: "Type", top: "Most common", sheetResp: "Responses", sheetQ: "Questions", sheetAi: "AI summary", period: "Period", link: "Form link", other: "Other",
    kind_choice: "single choice", kind_multi: "multiple choice", kind_scale: "scale", kind_text: "text", kind_date: "date", kind_other: "other",
  },
};

// ---------------- analysis ----------------

const IDENTITY: [QuestionStat["identity"], RegExp][] = [
  ["name", /(^|\s)(ism|исм|familiya|фамилия|f\.?\s?i\.?\s?sh|ф\.?\s?и\.?\s?о|фио|имя|name|full name)/i],
  ["phone", /(telefon|телефон|phone|тел\.|raqam)/i],
  ["email", /(e-?mail|почта|pochta)/i],
];

function kindOf(q: NonNullable<gforms.FormItem["questionItem"]>["question"]): Pick<QuestionStat, "kind" | "low" | "high"> {
  if (q.choiceQuestion) return { kind: q.choiceQuestion.type === "CHECKBOX" ? "multi" : "choice" };
  if (q.scaleQuestion) return { kind: "scale", low: q.scaleQuestion.low ?? 0, high: q.scaleQuestion.high };
  if (q.ratingQuestion) return { kind: "scale", low: 1, high: q.ratingQuestion.ratingScaleLevel };
  if (q.textQuestion) return { kind: "text" };
  if (q.dateQuestion || q.timeQuestion) return { kind: "date" };
  return { kind: "other" };
}

/**
 * Options keep the form's order (it is often meaningful: "<1 year", "1–3 years", …). When there are
 * more than `max` (free "Other" answers), the top ones are kept and the rest folded into "Other".
 */
function topCounts(m: Map<string, number>, max: number, other: string): [string, number][] {
  const all = [...m.entries()];
  if (all.length <= max) return all;
  const sorted = all.sort((a, b) => b[1] - a[1]);
  const rest = sorted.slice(max - 1).reduce((s, x) => s + x[1], 0);
  return [...sorted.slice(0, max - 1), [other, rest]];
}

type AnalyzeOpts = { from?: string; to?: string; ai?: boolean };

export async function analyzeForm(f: StoredForm, lang: Lang, opt: AnalyzeOpts = {}): Promise<FormAnalysis> {
  const [form, all] = await Promise.all([gforms.getForm(f.form_id), gforms.listResponses(f.form_id)]);
  markSeen(f, all.length);
  return analyzeResponses(f, form, all, lang, opt);
}

export async function analyzeResponses(f: Pick<StoredForm, "form_id" | "title" | "purpose">, form: gforms.Form, all: gforms.FormResponse[], lang: Lang, opt: AnalyzeOpts = {}): Promise<FormAnalysis> {
  const responses = all.filter((r) => {
    const d = ymdOf(new Date(r.lastSubmittedTime));
    return (!opt.from || d >= opt.from) && (!opt.to || d <= opt.to);
  });
  const items = (form.items ?? []).filter((i) => i.questionItem);
  const questions: QuestionStat[] = items.map((it, i) => {
    const title = (it.title ?? "").trim() || `#${i + 1}`;
    const k = kindOf(it.questionItem!.question);
    const identity = k.kind === "text" ? IDENTITY.find(([, re]) => re.test(title))?.[0] : undefined;
    return { index: i + 1, title, ...k, answered: 0, ...(identity ? { identity } : {}) };
  });
  const qid = items.map((it) => it.questionItem!.question.questionId);

  const respondents: Respondent[] = responses.map((r, i) => {
    const answers: Record<number, string> = {};
    qid.forEach((id, qi) => {
      const v = r.answers?.[id]?.textAnswers?.answers.map((a) => a.value).filter(Boolean) ?? [];
      if (v.length) answers[qi + 1] = v.join("; ");
    });
    const nameQ = questions.find((q) => q.identity === "name");
    const name = (nameQ && answers[nameQ.index]) || r.respondentEmail || `#${i + 1}`;
    return { n: i + 1, name: name.slice(0, 60), at: new Date(r.lastSubmittedTime), answers };
  });

  for (const [qi, q] of questions.entries()) {
    const raw = responses.map((r) => r.answers?.[qid[qi]]?.textAnswers?.answers.map((a) => a.value.trim()).filter(Boolean) ?? []);
    q.answered = raw.filter((v) => v.length).length;
    if (q.kind === "choice" || q.kind === "multi") {
      const m = new Map<string, number>();
      const opts = items[qi].questionItem!.question.choiceQuestion?.options.map((o) => o.value).filter((v): v is string => !!v) ?? [];
      for (const o of opts) m.set(o, 0);
      for (const v of raw.flat()) m.set(v, (m.get(v) ?? 0) + 1);
      q.counts = topCounts(m, 12, LBL[lang].other);
    } else if (q.kind === "scale") {
      const nums = raw.flat().map(Number).filter((n) => Number.isFinite(n));
      const low = q.low ?? 1, high = q.high ?? 5;
      q.counts = Array.from({ length: high - low + 1 }, (_, j) => [String(low + j), nums.filter((n) => n === low + j).length]);
      q.avg = nums.length ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10 : undefined;
    } else if (!q.identity) {
      q.texts = raw.map((v) => v.join("; ")).filter(Boolean);
    }
  }

  const byDayMap = new Map<string, number>();
  for (const r of respondents) byDayMap.set(ymdOf(r.at), (byDayMap.get(ymdOf(r.at)) ?? 0) + 1);
  const a: FormAnalysis = {
    formId: f.form_id,
    title: form.info.title || f.title,
    purpose: f.purpose,
    responderUri: form.responderUri,
    from: opt.from,
    to: opt.to,
    total: respondents.length,
    first: respondents[0]?.at,
    last: respondents[respondents.length - 1]?.at,
    completion: respondents.length && questions.length ? Math.round((questions.reduce((s, q) => s + q.answered, 0) / (questions.length * respondents.length)) * 100) : null,
    byDay: [...byDayMap.entries()].sort((x, y) => x[0].localeCompare(y[0])),
    questions,
    respondents,
    ai: null,
  };
  if (opt.ai !== false && respondents.length) a.ai = await aiInsights(a, lang).catch((e) => (console.warn("form AI insights:", (e as Error).message), null));
  return a;
}

const MAX_AI_RESPONDENTS = 80;

/**
 * Contact answers (name/phone/email) never go to the model: respondents are just numbers there,
 * which also keeps the assessment about the answers and not about the person.
 */
async function aiInsights(a: FormAnalysis, lang: Lang): Promise<FormAnalysis["ai"]> {
  const qs = a.questions.filter((q) => !q.identity);
  const data = {
    form: a.title,
    total_respondents: a.total,
    purpose: a.purpose ?? "",
    questions: qs.map((q) => ({ q: q.index, title: q.title, kind: q.kind, ...(q.counts ? { counts: Object.fromEntries(q.counts) } : {}), ...(q.avg !== undefined ? { avg: q.avg } : {}) })),
    respondents: a.respondents.slice(-MAX_AI_RESPONDENTS).map((r) => ({ n: r.n, answers: Object.fromEntries(qs.filter((q) => r.answers[q.index]).map((q) => [q.index, r.answers[q.index].slice(0, 600)])) })),
  };
  const r = await openai.chat.completions.create({
    model: config.openaiModel,
    response_format: { type: "json_object" },
    ...modelOpts(0.3),
    messages: [
      {
        role: "system",
        content: `You are an HR analyst for a company (Drenix). You get a Google Form and its responses as JSON. Return JSON:
{"summary": [4-7 short findings with numbers], "themes": {"<q>": "2-3 sentence summary of the open answers to question q (text questions only)"}, "scores": [{"n": respondent number, "score": 0-10, "verdict": "strong"|"maybe"|"weak", "note": "<= 25 words: why"}], "recommendations": [3-5 concrete next steps for HR]}
Scores: only when the form assesses individual people (candidates, tests, interviews); for surveys/feedback return "scores": []. Judge ONLY the content and quality of the answers against the purpose/role (relevance, depth, concrete experience, correctness). Ignore age, gender, nationality, religion, family status, appearance and any other personal traits. Do not invent facts that are not in the answers.
Numbers: copy them exactly from total_respondents, counts and avg — never count answers yourself.
Whenever you mention a respondent in any text, write "#n" (e.g. "#3"), never "3-nomzod" or "respondent 3".
Write all text in ${LANG_NAME[lang]}.`,
      },
      { role: "user", content: JSON.stringify(data) },
    ],
  });
  const j = JSON.parse(r.choices[0].message.content ?? "{}") as { summary?: unknown; themes?: Record<string, unknown>; scores?: unknown; recommendations?: unknown };
  // the model only knows numbers; put the names back for the reader
  const named = (s: string) => s.replace(/#(\d+)\b/g, (m, n) => a.respondents.find((r) => r.n === Number(n))?.name ?? m);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 8).map(named) : []);
  for (const [k, v] of Object.entries(j.themes ?? {})) {
    const q = a.questions.find((x) => x.index === Number(k));
    if (q && typeof v === "string") q.theme = named(v);
  }
  const known = new Set(a.respondents.map((x) => x.n));
  const scores = (Array.isArray(j.scores) ? j.scores : [])
    .map((s) => s as Partial<Assessment>)
    .filter((s) => typeof s.n === "number" && known.has(s.n) && typeof s.score === "number")
    .map((s) => ({ n: s.n!, score: Math.max(0, Math.min(10, Math.round(s.score! * 10) / 10)), verdict: (["strong", "maybe", "weak"].includes(s.verdict as string) ? s.verdict : "maybe") as Assessment["verdict"], note: named(String(s.note ?? "")).slice(0, 220) }))
    .sort((x, y) => y.score - x.score);
  return { summary: strs(j.summary), recommendations: strs(j.recommendations), scores };
}

// ---------------- text ----------------

const periodLabel = (a: FormAnalysis, lang: Lang) =>
  a.from || a.to ? `${a.from ? fmtDay(a.from, lang) : "…"} — ${a.to ? fmtDay(a.to, lang) : "…"}` : LBL[lang].all;
const nameOf = (a: FormAnalysis, n: number) => a.respondents.find((r) => r.n === n)?.name ?? `#${n}`;
const avgScore = (a: FormAnalysis) => (a.ai?.scores.length ? Math.round((a.ai.scores.reduce((s, x) => s + x.score, 0) / a.ai.scores.length) * 10) / 10 : null);

export function formSummaryText(a: FormAnalysis, lang: Lang): string {
  const L = LBL[lang];
  const out = [`📋 <b>${esc(a.title)}</b> · ${L.title}`, `${L.period}: ${esc(periodLabel(a, lang))}`, "", `• ${L.responses}: <b>${a.total}</b>`, `• ${L.questions}: ${a.questions.length}`];
  if (a.completion !== null) out.push(`• ${L.completion}: ${a.completion}%`);
  if (!a.total) return [...out, "", L.none, "", `🔗 ${a.responderUri}`].join("\n");
  if (a.ai?.summary.length) out.push("", `<b>${L.summary}</b>`, ...a.ai.summary.slice(0, 5).map((s) => `• ${esc(s)}`));
  if (a.ai?.scores.length) {
    out.push("", `<b>${L.ranking}</b>`);
    for (const s of a.ai.scores.slice(0, 5)) out.push(`• <b>${esc(nameOf(a, s.n))}</b> — ${s.score}/10 (${L[s.verdict]}): ${esc(s.note)}`);
  }
  return out.join("\n");
}

// ---------------- charts (SVG → PNG) ----------------

const FONT_DIR = dirname(FONT);
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface Chart {
  png: Buffer;
  w: number;
  h: number;
}

function render(svg: string, w: number, h: number): Chart {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: w * 2 }, font: { fontDirs: [FONT_DIR], loadSystemFonts: false, defaultFontFamily: "DejaVu Sans" } }).render().asPng();
  return { png: Buffer.from(png), w, h };
}

/** Horizontal bars: label, track, bar, "n · p%". One series → one hue; values in ink. */
export function hbarChart(items: [string, number][], base: number): Chart {
  const w = 520, row = 26, h = items.length * row + 6;
  const lw = 190, vw = 70, bw = w - lw - vw;
  const max = Math.max(1, ...items.map((i) => i[1]));
  const rows = items
    .map(([label, n], i) => {
      const y = i * row + 4;
      const len = Math.max(n ? 4 : 0, (bw * n) / max);
      const pct = base ? `${Math.round((n / base) * 100)}%` : "";
      return `<text x="0" y="${y + 13}" font-size="11" fill="${C.ink}">${xml(cut(label, 30))}</text>
<rect x="${lw}" y="${y + 3}" width="${bw}" height="12" rx="4" fill="${C.track}"/>
${len ? `<rect x="${lw}" y="${y + 3}" width="${len}" height="12" rx="4" fill="${C.accent}"/>` : ""}
<text x="${w}" y="${y + 13}" font-size="11" font-weight="bold" fill="${C.ink}" text-anchor="end">${n}${pct ? ` <tspan font-weight="normal" fill="${C.muted}">· ${pct}</tspan>` : ""}</text>`;
    })
    .join("\n");
  return render(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="DejaVu Sans">${rows}</svg>`, w, h);
}

/** Columns with a value on top of each and the category below (dates, scale points). */
export function columnChart(items: [string, number][]): Chart {
  const w = 520, h = 140, top = 16, bottom = 26, ch = h - top - bottom;
  const max = Math.max(1, ...items.map((i) => i[1]));
  const slot = w / Math.max(1, items.length);
  const bw = Math.min(34, slot * 0.62);
  const every = Math.ceil(items.length / 12);
  const cols = items
    .map(([label, n], i) => {
      const x = i * slot + (slot - bw) / 2;
      const bh = n ? Math.max(3, (n / max) * ch) : 0;
      const y = top + ch - bh;
      return `${bh ? `<path d="M${x},${top + ch} V${y + 4} a4,4 0 0 1 4,-4 H${x + bw - 4} a4,4 0 0 1 4,4 V${top + ch} Z" fill="${C.accent}"/>` : ""}
<text x="${x + bw / 2}" y="${y - 4}" font-size="10" fill="${C.ink}" text-anchor="middle">${n || ""}</text>
${i % every === 0 ? `<text x="${x + bw / 2}" y="${h - 8}" font-size="10" fill="${C.muted}" text-anchor="middle">${xml(cut(label, 10))}</text>` : ""}`;
    })
    .join("\n");
  return render(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="DejaVu Sans"><line x1="0" y1="${top + ch}" x2="${w}" y2="${top + ch}" stroke="${C.line}" stroke-width="1"/>${cols}</svg>`,
    w,
    h,
  );
}

const dayLabel = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;

interface Charts {
  byDay: Chart | null;
  q: Map<number, Chart>;
  scores: Chart | null;
}

function buildCharts(a: FormAnalysis): Charts {
  const q = new Map<number, Chart>();
  for (const s of a.questions) {
    if (!s.counts?.length || !s.answered) continue;
    q.set(s.index, s.kind === "scale" ? columnChart(s.counts) : hbarChart(s.counts, s.answered));
  }
  const top = a.ai?.scores.slice(0, 15) ?? [];
  return {
    byDay: a.byDay.length > 1 ? columnChart(a.byDay.slice(-31).map(([d, n]) => [dayLabel(d), n])) : null,
    q,
    scores: top.length ? hbarChartScores(top.map((s) => [nameOf(a, s.n), s.score])) : null,
  };
}

/** Score bars on a fixed 0–10 axis, so two reports are comparable. */
function hbarChartScores(items: [string, number][]): Chart {
  const w = 520, row = 26, h = items.length * row + 6, lw = 190, vw = 50, bw = w - lw - vw;
  const rows = items
    .map(([label, n], i) => {
      const y = i * row + 4;
      return `<text x="0" y="${y + 13}" font-size="11" fill="${C.ink}">${xml(cut(label, 30))}</text>
<rect x="${lw}" y="${y + 3}" width="${bw}" height="12" rx="4" fill="${C.track}"/>
<rect x="${lw}" y="${y + 3}" width="${Math.max(4, (bw * n) / 10)}" height="12" rx="4" fill="${C.accent}"/>
<text x="${w}" y="${y + 13}" font-size="11" font-weight="bold" fill="${C.ink}" text-anchor="end">${n}/10</text>`;
    })
    .join("\n");
  return render(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="DejaVu Sans">${rows}</svg>`, w, h);
}

// ---------------- PDF ----------------

function kpis(a: FormAnalysis, lang: Lang): [string, string][] {
  const L = LBL[lang];
  const out: [string, string][] = [[L.responses, String(a.total)], [L.questions, String(a.questions.length)], [L.completion, a.completion === null ? "—" : `${a.completion}%`]];
  const avg = avgScore(a);
  if (avg !== null) out.push([L.avgScore, `${avg}/10`]);
  return out;
}

const samplesOf = (s: QuestionStat, n: number) => (s.texts ?? []).slice(-n).reverse();

export function formReportPdf(a: FormAnalysis, lang: Lang, charts = buildCharts(a)): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const L = LBL[lang];
    const doc = new PDFDocument({ size: "A4", margin: 44, info: { Title: `${a.title} · ${L.title}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("r", FONT);
    doc.registerFont("b", FONT_BOLD);
    const W = doc.page.width - 88;
    let y = 0;
    const footer = () => {
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fill(C.muted).font("r").fontSize(8).text(`Drenix Assistant · ${a.title} · ${isoLocal(new Date()).slice(0, 16).replace("T", " ")} (Tashkent)`, 44, doc.page.height - 34, { width: W, align: "right", lineBreak: false });
      doc.page.margins.bottom = bottom;
    };
    const room = (h: number) => {
      if (y + h > doc.page.height - 60) {
        footer();
        doc.addPage();
        y = 50;
      }
    };
    const heading = (t: string, sub?: string) => {
      room(70);
      doc.fill(C.ink).font("b").fontSize(12).text(t, 44, y, { width: W });
      y = doc.y + 2;
      if (sub) {
        doc.fill(C.muted).font("r").fontSize(8.5).text(sub, 44, y, { width: W });
        y = doc.y + 2;
      }
      y += 6;
    };
    const para = (t: string, opts: { size?: number; color?: string; indent?: number; bold?: boolean } = {}) => {
      doc.font(opts.bold ? "b" : "r").fontSize(opts.size ?? 9.5);
      const h = doc.heightOfString(t, { width: W - (opts.indent ?? 0) });
      room(h + 4);
      doc.fill(opts.color ?? C.ink).text(t, 44 + (opts.indent ?? 0), y, { width: W - (opts.indent ?? 0) });
      y = doc.y + 4;
    };
    const image = (c: Chart) => {
      const h = (c.h * W) / c.w;
      room(h + 8);
      doc.image(c.png, 44, y, { width: W });
      y += h + 12;
    };

    doc.rect(0, 0, doc.page.width, 96).fill(C.bg);
    doc.fill(C.accent).font("b").fontSize(11).text("DRENIX", 44, 26, { characterSpacing: 3 });
    let size = 18;
    doc.font("b");
    while (size > 11 && doc.fontSize(size).widthOfString(a.title) > W) size--;
    doc.fill("#f3ece8").fontSize(size).text(a.title, 44, 46 + (18 - size) / 2, { width: W, height: size + 4, ellipsis: true, lineBreak: false });
    doc.fill("#bfb3ad").font("r").fontSize(10).text(`${L.title} · ${periodLabel(a, lang)}`, 44, 72);
    y = 118;

    const tiles = kpis(a, lang);
    const tw = (W - (tiles.length - 1) * 10) / tiles.length;
    tiles.forEach(([label, value], i) => {
      const x = 44 + i * (tw + 10);
      doc.roundedRect(x, y, tw, 60, 8).fill(i === 0 ? C.soft : "#f7f3f0");
      doc.fill(i === 0 ? C.accent : C.ink).font("b").fontSize(18).text(value, x + 12, y + 12, { width: tw - 24 });
      doc.fill(C.muted).font("r").fontSize(8).text(label, x + 12, y + 38, { width: tw - 24 });
    });
    y += 78;

    if (!a.total) {
      para(L.none, { size: 11 });
      para(`${L.link}: ${a.responderUri}`, { color: C.muted });
      footer();
      doc.end();
      return;
    }

    if (a.ai?.summary.length) {
      heading(L.summary);
      for (const s of a.ai.summary) para(`•  ${s}`, { indent: 4 });
      y += 6;
    }
    if (charts.byDay) {
      heading(L.byDay);
      image(charts.byDay);
    }

    for (const s of a.questions) {
      if (s.identity) continue;
      const sub = `${s.answered}/${a.total} ${L.answered}${s.avg !== undefined ? ` · ${L.avg}: ${s.avg} (${s.low}–${s.high})` : ""} · ${L[`kind_${s.kind}`]}`;
      heading(`${s.index}. ${s.title}`, sub);
      const c = charts.q.get(s.index);
      if (c) image(c);
      if (s.theme) para(s.theme);
      const samples = samplesOf(s, 4);
      if (samples.length) for (const t of samples) para(`“${cut(t, 300)}”`, { color: C.muted, indent: 10, size: 9 });
      y += 6;
    }

    if (a.ai?.scores.length) {
      heading(L.ranking, L.rankingNote);
      if (charts.scores) image(charts.scores);
      for (const s of a.ai.scores.slice(0, 40)) {
        para(`${nameOf(a, s.n)} — ${s.score}/10 · ${L[s.verdict]}`, { bold: true, size: 9.5 });
        if (s.note) para(s.note, { color: C.muted, indent: 10, size: 9 });
      }
      y += 6;
    }
    if (a.ai?.recommendations.length) {
      heading(L.recs);
      a.ai.recommendations.forEach((r, i) => para(`${i + 1}.  ${r}`, { indent: 4 }));
    }
    para(`${L.link}: ${a.responderUri}`, { color: C.muted, size: 8.5 });
    footer();
    doc.end();
  });
}

// ---------------- Word ----------------

const DOCX_W = 600; // px, fits A4 with default margins

export async function formReportDocx(a: FormAnalysis, lang: Lang, charts = buildCharts(a)): Promise<Buffer> {
  const L = LBL[lang];
  const img = (c: Chart) => new Paragraph({ spacing: { after: 160 }, children: [new ImageRun({ type: "png", data: c.png, transformation: { width: DOCX_W, height: Math.round((c.h * DOCX_W) / c.w) } })] });
  const p = (text: string, o: { color?: string; bold?: boolean; italics?: boolean; size?: number; bullet?: boolean; keepNext?: boolean } = {}) =>
    new Paragraph({ ...(o.bullet ? { bullet: { level: 0 } } : {}), keepNext: o.keepNext, spacing: { after: 80 }, children: [new TextRun({ text, color: o.color?.replace("#", ""), bold: o.bold, italics: o.italics, size: o.size })] });
  const h = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2) => new Paragraph({ heading: level, keepNext: true, spacing: { before: 280, after: 100 }, children: [new TextRun({ text })] });
  const border = { style: BorderStyle.SINGLE, size: 4, color: C.line.replace("#", "") };
  const cell = (text: string, o: { head?: boolean; width?: number } = {}) =>
    new TableCell({
      width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
      shading: o.head ? { type: ShadingType.CLEAR, color: "auto", fill: C.soft.replace("#", "") } : undefined,
      borders: { top: border, bottom: border, left: border, right: border },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: o.head, size: 19 })] })],
    });
  const table = (head: string[], rows: string[][], widths: number[]) =>
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, { head: true, width: widths[i] })) }), ...rows.map((r) => new TableRow({ children: r.map((t, i) => cell(t, { width: widths[i] })) }))] });

  const body: (Paragraph | Table)[] = [
    new Paragraph({ children: [new TextRun({ text: "DRENIX", bold: true, color: C.accent.replace("#", ""), characterSpacing: 60, size: 20 })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: a.title })] }),
    p(`${L.title} · ${periodLabel(a, lang)}`, { color: C.muted }),
    table(kpis(a, lang).map((k) => k[0]), [kpis(a, lang).map((k) => k[1])], kpis(a, lang).map(() => Math.floor(100 / kpis(a, lang).length))),
  ];
  if (!a.total) body.push(p(L.none), p(`${L.link}: ${a.responderUri}`, { color: C.muted }));
  else {
    if (a.ai?.summary.length) body.push(h(L.summary), ...a.ai.summary.map((s) => p(s, { bullet: true })));
    if (charts.byDay) body.push(h(L.byDay), img(charts.byDay));
    for (const s of a.questions) {
      if (s.identity) continue;
      body.push(h(`${s.index}. ${s.title}`, HeadingLevel.HEADING_3), p(`${s.answered}/${a.total} ${L.answered}${s.avg !== undefined ? ` · ${L.avg}: ${s.avg} (${s.low}–${s.high})` : ""} · ${L[`kind_${s.kind}`]}`, { color: C.muted, size: 18, keepNext: true }));
      const c = charts.q.get(s.index);
      if (c) body.push(img(c));
      if (s.theme) body.push(p(s.theme));
      for (const t of samplesOf(s, 4)) body.push(p(`“${cut(t, 400)}”`, { italics: true, color: C.muted, size: 19 }));
    }
    if (a.ai?.scores.length) {
      body.push(h(L.ranking), p(L.rankingNote, { color: C.muted, size: 18, keepNext: true }));
      if (charts.scores) body.push(img(charts.scores));
      body.push(table(["#", L.name, L.score, L.verdict, L.note], a.ai.scores.map((s, i) => [String(i + 1), nameOf(a, s.n), `${s.score}/10`, L[s.verdict], s.note]), [5, 25, 10, 14, 46]));
    }
    if (a.ai?.recommendations.length) body.push(h(L.recs), ...a.ai.recommendations.map((r) => p(r, { bullet: true })));
    body.push(h(L.appendix));
    const qs = a.questions;
    for (const r of a.respondents.slice(-100)) {
      body.push(p(`${r.name} · ${isoLocal(r.at).slice(0, 16).replace("T", " ")}`, { bold: true }));
      for (const q of qs) if (r.answers[q.index]) body.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: `${q.title}: `, color: C.muted.replace("#", ""), size: 19 }), new TextRun({ text: r.answers[q.index], size: 19 })] }));
    }
    body.push(p(`${L.link}: ${a.responderUri}`, { color: C.muted, size: 18 }));
  }

  const doc = new Document({
    creator: "Drenix Assistant",
    title: `${a.title} · ${L.title}`,
    styles: {
      default: { document: { run: { font: "Arial", size: 21, color: C.ink.replace("#", "") } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { size: 40, bold: true } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { size: 26, bold: true } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", run: { size: 22, bold: true } },
      ],
    },
    sections: [
      {
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `Drenix Assistant · ${a.title} · `, color: C.muted.replace("#", ""), size: 16 }), new TextRun({ children: [PageNumber.CURRENT], color: C.muted.replace("#", ""), size: 16 })] })] }) },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

// ---------------- Excel ----------------

export async function formReportXlsx(a: FormAnalysis, lang: Lang): Promise<Buffer> {
  const L = LBL[lang];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Drenix Assistant";
  const headStyle = (ws: ExcelJS.Worksheet) => {
    const r = ws.getRow(1);
    r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${C.accent.slice(1)}` } };
    r.alignment = { vertical: "middle", wrapText: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  const scores = new Map(a.ai?.scores.map((s) => [s.n, s]) ?? []);
  const resp = wb.addWorksheet(L.sheetResp);
  resp.columns = [
    { header: "#", key: "n", width: 5 },
    { header: L.submitted, key: "at", width: 17 },
    ...a.questions.map((q) => ({ header: q.title, key: `q${q.index}`, width: q.kind === "text" && !q.identity ? 40 : 20 })),
    ...(scores.size ? [{ header: `AI ${L.score}`, key: "score", width: 9 }, { header: L.verdict, key: "verdict", width: 14 }, { header: L.note, key: "note", width: 50 }] : []),
  ];
  for (const r of a.respondents) {
    const s = scores.get(r.n);
    resp.addRow({ n: r.n, at: isoLocal(r.at).slice(0, 16).replace("T", " "), ...Object.fromEntries(a.questions.map((q) => [`q${q.index}`, r.answers[q.index] ?? ""])), ...(s ? { score: s.score, verdict: L[s.verdict], note: s.note } : {}) });
  }
  resp.eachRow((row, i) => i > 1 && (row.alignment = { vertical: "top", wrapText: true }));
  headStyle(resp);
  if (a.respondents.length) resp.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: resp.columns.length } };

  const qs = wb.addWorksheet(L.sheetQ);
  qs.columns = [
    { header: "#", key: "i", width: 5 },
    { header: L.questions, key: "t", width: 45 },
    { header: L.type, key: "k", width: 18 },
    { header: L.answered, key: "a", width: 12 },
    { header: L.top, key: "top", width: 30 },
    { header: L.avg, key: "avg", width: 10 },
    { header: L.themes, key: "theme", width: 70 },
  ];
  for (const q of a.questions) {
    const top = q.counts?.length && q.kind !== "scale" ? [...q.counts].sort((x, y) => y[1] - x[1])[0] : null;
    qs.addRow({ i: q.index, t: q.title, k: L[`kind_${q.kind}`], a: q.answered, top: top && top[1] ? `${top[0]} (${top[1]})` : "", avg: q.avg ?? "", theme: q.theme ?? "" });
    for (const [label, n] of q.counts ?? []) qs.addRow({ t: `   ${label}`, a: n });
  }
  qs.eachRow((row, i) => i > 1 && (row.alignment = { vertical: "top", wrapText: true }));
  headStyle(qs);

  if (a.ai) {
    const ai = wb.addWorksheet(L.sheetAi);
    ai.columns = [{ header: L.summary, key: "s", width: 110 }];
    for (const s of a.ai.summary) ai.addRow({ s: `• ${s}` });
    if (a.ai.recommendations.length) {
      ai.addRow({});
      ai.addRow({ s: L.recs }).font = { bold: true };
      a.ai.recommendations.forEach((r, i) => ai.addRow({ s: `${i + 1}. ${r}` }));
    }
    ai.addRow({});
    ai.addRow({ s: `${L.link}: ${a.responderUri}` });
    ai.eachRow((row) => (row.alignment = { wrapText: true, vertical: "top" }));
    headStyle(ai);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------- export ----------------

export function formReportFileName(a: FormAnalysis, ext: ReportFormat): string {
  const slug = a.title.replace(/^\s*drenix\b/i, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "form";
  return `Drenix-${slug}-${ymdOf(new Date())}.${ext}`;
}

export async function formReportFiles(a: FormAnalysis, lang: Lang, formats: ReportFormat[]): Promise<{ name: string; data: Buffer }[]> {
  const charts = formats.some((f) => f !== "xlsx") ? buildCharts(a) : undefined;
  const out: { name: string; data: Buffer }[] = [];
  for (const f of formats) {
    const data = f === "pdf" ? await formReportPdf(a, lang, charts) : f === "docx" ? await formReportDocx(a, lang, charts) : await formReportXlsx(a, lang);
    out.push({ name: formReportFileName(a, f), data });
  }
  return out;
}
