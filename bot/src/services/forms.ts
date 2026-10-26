/**
 * Candidate questionnaires as Google Forms: the AI drafts the questions, HR sees a preview and
 * presses ✅, the bot creates + publishes the form and sends the links. New responses are announced.
 */
import { audit, db } from "../db.js";
import { formsGranted, GoogleError } from "../google/calendar.js";
import * as gforms from "../google/forms.js";
import { t, type Lang } from "../i18n.js";
import { esc, InlineKeyboard, send, sendHr } from "../tg.js";

export interface FormDraft {
  title: string;
  description: string;
  purpose: string; // what/whom the form is for, used later for the analysis
  questions: gforms.QuestionDraft[];
}

export interface StoredForm {
  id: number;
  form_id: string;
  title: string;
  purpose: string | null;
  responder_uri: string | null;
  questions: number;
  seen_responses: number;
  accepting: number;
  watch: number;
  created_at: string;
}

const TXT: Record<Lang, Record<string, string>> = {
  uz: {
    head: "📋 <b>Google Forma loyihasi</b>",
    q: "savol",
    req: "majburiy",
    confirm: "Shu savollar bilan forma yaratilsinmi? O'zgartirish kerak bo'lsa, yozing.",
    created: "✅ <b>Forma yaratildi va javob qabul qilyapti</b>",
    send: "🔗 Kandidatlarga yuboriladigan havola",
    edit: "✏️ Tahrirlash (faqat siz uchun)",
    note: "Yangi javoblar kelganda xabar beraman. Hisobot uchun: «formaning javoblari bo'yicha hisobot».",
    cancelled: "Bekor qilindi, forma yaratilmadi.",
    newResp: "📥 <b>{title}</b>: {n} ta yangi javob (jami {total}).",
    newHint: "Hisobot kerak bo'lsa yozing: «{title} bo'yicha hisobot».",
  },
  ru: {
    head: "📋 <b>Черновик Google Формы</b>",
    q: "вопросов",
    req: "обязательный",
    confirm: "Создать форму с этими вопросами? Если нужно что-то поменять — напишите.",
    created: "✅ <b>Форма создана и принимает ответы</b>",
    send: "🔗 Ссылка для кандидатов",
    edit: "✏️ Редактирование (только для вас)",
    note: "Сообщу о новых ответах. Для отчёта: «отчёт по ответам формы».",
    cancelled: "Отменено, форма не создана.",
    newResp: "📥 <b>{title}</b>: новых ответов — {n} (всего {total}).",
    newHint: "Нужен отчёт — напишите: «отчёт по {title}».",
  },
  en: {
    head: "📋 <b>Google Form draft</b>",
    q: "questions",
    req: "required",
    confirm: "Create the form with these questions? Tell me if something should change.",
    created: "✅ <b>Form created and accepting responses</b>",
    send: "🔗 Link for candidates",
    edit: "✏️ Edit (only for you)",
    note: "I'll tell you when new responses arrive. For a report: “report on the form responses”.",
    cancelled: "Cancelled, no form was created.",
    newResp: "📥 <b>{title}</b>: {n} new response(s) ({total} in total).",
    newHint: "Need a report? Write: “report on {title}”.",
  },
};
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

const TYPE_ICON: Record<gforms.QuestionType, string> = { short: "✍️", paragraph: "📝", choice: "🔘", checkboxes: "☑️", dropdown: "🔽", scale: "📊", date: "📅" };

function previewHtml(d: FormDraft, lang: Lang): string {
  const L = TXT[lang];
  const out = [`${L.head} · ${d.questions.length} ${L.q}`, "", `<b>${esc(d.title)}</b>`];
  if (d.description) out.push(`<i>${esc(d.description)}</i>`);
  d.questions.forEach((q, i) => {
    out.push("", `${i + 1}. ${TYPE_ICON[q.type] ?? "✍️"} <b>${esc(q.title)}</b>${q.required === false ? "" : " *"}`);
    if (q.options?.length && ["choice", "checkboxes", "dropdown"].includes(q.type)) out.push(`   ${q.options.map((o) => `▫️ ${esc(o)}`).join("  ")}`);
    if (q.type === "scale") out.push(`   ${q.low === 0 ? 0 : 1} ${esc(q.lowLabel ?? "")} … ${q.high ?? 5} ${esc(q.highLabel ?? "")}`.trimEnd());
  });
  out.push("", `* — ${L.req}`, "", L.confirm);
  return out.join("\n");
}

export async function proposeForm(chatId: number, lang: Lang, d: FormDraft): Promise<number> {
  const id = Number(db.prepare("INSERT INTO pending_actions (kind, payload) VALUES ('form', ?)").run(JSON.stringify(d)).lastInsertRowid);
  await send(chatId, previewHtml(d, lang), new InlineKeyboard().text(t(lang, "btn_confirm"), `fm:${id}:ok`).text(t(lang, "btn_cancel"), `fm:${id}:no`));
  return id;
}

export async function executeForm(id: number, lang: Lang): Promise<string> {
  const row = db.prepare("SELECT * FROM pending_actions WHERE id = ? AND kind = 'form'").get(id) as { payload: string; status: string } | undefined;
  if (!row || row.status !== "pending") return t(lang, "already_done");
  db.prepare("UPDATE pending_actions SET status = 'done' WHERE id = ?").run(id);
  const d = JSON.parse(row.payload) as FormDraft;
  const L = TXT[lang];
  try {
    const f = await gforms.createForm(d.title, d.description, d.questions);
    db.prepare("INSERT INTO forms (form_id, title, purpose, responder_uri, questions) VALUES (?, ?, ?, ?, ?)").run(f.formId, d.title, d.purpose || null, f.responderUri, d.questions.length);
    audit("hr", "form_created", { formId: f.formId, title: d.title, questions: d.questions.length });
    return [L.created, `<b>${esc(d.title)}</b>`, "", `${L.send}:`, f.responderUri, "", `${L.edit}: <a href="${gforms.editUrl(f.formId)}">Google Forms</a>`, "", L.note].join("\n");
  } catch (e) {
    db.prepare("UPDATE pending_actions SET status = 'pending' WHERE id = ?").run(id); // allow retry
    return `❌ ${esc((e as Error).message)}`;
  }
}

export function cancelForm(id: number, lang: Lang): string {
  db.prepare("UPDATE pending_actions SET status = 'cancelled' WHERE id = ? AND kind = 'form' AND status = 'pending'").run(id);
  return TXT[lang].cancelled;
}

export const listForms = (limit = 20) => db.prepare("SELECT * FROM forms ORDER BY id DESC LIMIT ?").all(limit) as StoredForm[];

/**
 * A form by edit link / id, by (part of) its title among stored forms, or the newest one.
 * A form given by link that the bot didn't create is registered so it can be watched and reported on.
 */
export async function resolveForm(ref?: string): Promise<StoredForm> {
  const s = ref?.trim();
  if (!s) {
    const f = listForms(1)[0];
    if (!f) throw new GoogleError("No forms yet. Create one first or give a Google Forms edit link.");
    return f;
  }
  const id = gforms.parseFormId(s);
  if (id) {
    const known = db.prepare("SELECT * FROM forms WHERE form_id = ?").get(id) as StoredForm | undefined;
    if (known) return known;
    const f = await gforms.getForm(id);
    const n = (f.items ?? []).filter((i) => i.questionItem).length;
    db.prepare("INSERT INTO forms (form_id, title, responder_uri, questions, seen_responses, watch) VALUES (?, ?, ?, ?, ?, 0)").run(id, f.info.title, f.responderUri, n, (await gforms.listResponses(id)).length);
    return db.prepare("SELECT * FROM forms WHERE form_id = ?").get(id) as StoredForm;
  }
  if (/\/forms\/d\/e\//.test(s)) throw new GoogleError("That is the responder link; send the edit link (…/forms/d/<id>/edit) instead.");
  const q = s.toLowerCase();
  const f = listForms(200).find((x) => x.title.toLowerCase() === q) ?? listForms(200).find((x) => x.title.toLowerCase().includes(q) || (x.purpose ?? "").toLowerCase().includes(q));
  if (!f) throw new GoogleError(`No form matches "${s}". Forms: ${listForms(10).map((x) => x.title).join("; ") || "none"}`);
  return f;
}

export function setFormAccepting(f: StoredForm, accepting: boolean) {
  db.prepare("UPDATE forms SET accepting = ? WHERE id = ?").run(accepting ? 1 : 0, f.id);
  return gforms.setAccepting(f.form_id, accepting);
}

export const markSeen = (f: StoredForm, n: number) => db.prepare("UPDATE forms SET seen_responses = MAX(seen_responses, ?) WHERE id = ?").run(n, f.id);

/** Scheduler: tells HR about new responses to forms the bot created (open, last 60 days). */
export async function checkNewResponses(): Promise<void> {
  if (!formsGranted()) return;
  const forms = db.prepare("SELECT * FROM forms WHERE watch = 1 AND accepting = 1 AND created_at > datetime('now', '-60 days')").all() as StoredForm[];
  for (const f of forms) {
    try {
      const total = (await gforms.listResponses(f.form_id)).length;
      if (total <= f.seen_responses) continue;
      const n = total - f.seen_responses;
      markSeen(f, total);
      await sendHr((lang) => ({ html: `${fill(TXT[lang].newResp, { title: esc(f.title), n, total })}\n${fill(TXT[lang].newHint, { title: esc(f.title) })}` }));
    } catch (e) {
      console.warn("form responses check:", f.form_id, (e as Error).message);
    }
  }
}
