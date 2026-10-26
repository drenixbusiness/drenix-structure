/**
 * Every write to Google Sheets goes through a preview with Confirm/Cancel buttons.
 * On confirm the tab is read again: a cell that changed in the meantime is not overwritten.
 */
import { audit, db } from "../db.js";
import * as sheets from "../google/sheets.js";
import { t, type Lang } from "../i18n.js";
import { esc, InlineKeyboard, send } from "../tg.js";

export interface CellChange {
  col: number;
  column: string;
  old: string;
  value: string;
}
export interface RowChange {
  row: number;
  label: string;
  cells: CellChange[];
}
export interface SheetWrite {
  spreadsheetId: string;
  tab: string;
  title: string; // what the change is, e.g. "Reject"
  updates: RowChange[];
  append?: { column: string; value: string }[];
  appendRow?: string[];
}

const TXT: Record<Lang, Record<string, string>> = {
  uz: { head: "📝 <b>Jadvalga o'zgartirish</b>", add: "➕ Yangi qator", empty: "bo'sh", confirm: "Tasdiqlansinmi?", done: "✅ Jadvalga yozildi", skipped: "⚠️ O'tkazib yuborildi (jadvalda boshqa qiymat paydo bo'lgan)", cancelled: "Bekor qilindi, jadvalga hech narsa yozilmadi." },
  ru: { head: "📝 <b>Изменение в таблице</b>", add: "➕ Новая строка", empty: "пусто", confirm: "Подтвердить?", done: "✅ Записано в таблицу", skipped: "⚠️ Пропущено (в таблице уже другое значение)", cancelled: "Отменено, в таблицу ничего не записано." },
  en: { head: "📝 <b>Sheet change</b>", add: "➕ New row", empty: "empty", confirm: "Confirm?", done: "✅ Written to the sheet", skipped: "⚠️ Skipped (the cell changed in the sheet meanwhile)", cancelled: "Cancelled, nothing was written." },
};

const short = (v: string, n = 120) => (v.length > n ? `${v.slice(0, n)}…` : v);

function previewHtml(w: SheetWrite, lang: Lang): string {
  const L = TXT[lang];
  const out = [`${L.head} · ${esc(w.tab)}${w.title ? ` · ${esc(w.title)}` : ""}`];
  for (const u of w.updates.slice(0, 30)) {
    out.push("", `<b>#${u.row}${u.label ? ` · ${esc(u.label)}` : ""}</b>`);
    for (const c of u.cells) out.push(`• ${esc(c.column)}: <i>${esc(short(c.old)) || L.empty}</i> → <b>${esc(short(c.value)) || L.empty}</b>`);
  }
  if (w.updates.length > 30) out.push("", `… +${w.updates.length - 30}`);
  if (w.append) out.push("", `<b>${L.add}</b>`, ...w.append.filter((c) => c.value).map((c) => `• ${esc(c.column)}: <b>${esc(short(c.value))}</b>`));
  out.push("", L.confirm);
  return out.join("\n");
}

export async function proposeSheetWrite(chatId: number, lang: Lang, w: SheetWrite): Promise<number> {
  const id = Number(db.prepare("INSERT INTO pending_actions (kind, payload) VALUES ('sheet', ?)").run(JSON.stringify(w)).lastInsertRowid);
  await send(chatId, previewHtml(w, lang), new InlineKeyboard().text(t(lang, "btn_confirm"), `sw:${id}:ok`).text(t(lang, "btn_cancel"), `sw:${id}:no`));
  return id;
}

export async function executeSheetWrite(id: number, lang: Lang): Promise<string> {
  const row = db.prepare("SELECT * FROM pending_actions WHERE id = ? AND kind = 'sheet'").get(id) as { payload: string; status: string } | undefined;
  if (!row || row.status !== "pending") return t(lang, "already_done");
  db.prepare("UPDATE pending_actions SET status = 'done' WHERE id = ?").run(id);
  const w = JSON.parse(row.payload) as SheetWrite;
  const L = TXT[lang];
  const ref = { id: w.spreadsheetId };
  try {
    const lines: string[] = [];
    if (w.updates.length) {
      const { rows } = await sheets.readTab(ref, w.tab);
      const cells: { range: string; value: string }[] = [];
      const skipped: string[] = [];
      for (const u of w.updates) {
        for (const c of u.cells) {
          const now = String(rows[u.row - 2]?.[c.col] ?? "");
          if (now.trim() !== c.old.trim()) skipped.push(`#${u.row} ${esc(c.column)}`);
          else cells.push({ range: `${sheets.quoteTab(w.tab)}!${sheets.colLetter(c.col)}${u.row}`, value: c.value });
        }
      }
      if (cells.length) await sheets.writeCells(ref, cells);
      lines.push(`${L.done}: ${w.updates.filter((u) => u.cells.length).map((u) => `#${u.row}${u.label ? ` ${esc(u.label)}` : ""}`).join(", ")}`);
      if (skipped.length) lines.push(`${L.skipped}: ${skipped.join(", ")}`);
    }
    if (w.appendRow) {
      const r = await sheets.appendRow(ref, w.tab, w.appendRow);
      lines.push(`${L.done}${r ? `: #${r}` : ""}`);
    }
    audit("hr", "sheet_write", { id, tab: w.tab, title: w.title, rows: w.updates.map((u) => u.row), cells: w.updates.flatMap((u) => u.cells.map((c) => ({ row: u.row, column: c.column, old: c.old, value: c.value }))), appended: !!w.appendRow });
    return lines.join("\n");
  } catch (e) {
    db.prepare("UPDATE pending_actions SET status = 'pending' WHERE id = ?").run(id); // allow retry
    return `❌ ${esc((e as Error).message)}`;
  }
}

export function cancelSheetWrite(id: number, lang: Lang): string {
  db.prepare("UPDATE pending_actions SET status = 'cancelled' WHERE id = ? AND kind = 'sheet' AND status = 'pending'").run(id);
  return TXT[lang].cancelled;
}
