/**
 * Minimal Google Sheets REST client, same OAuth token as Calendar.
 * Rows are addressed by their real sheet row number (header = row 1) so the model can
 * read a row and later update exactly that row.
 */
import { config } from "../config.js";
import { accessToken, GoogleError, sheetsGranted } from "./calendar.js";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const NOT_GRANTED = "Google Sheets is not connected: an admin must run `npm run google:auth` again and tick the Sheets checkbox.";

interface Ref {
  id: string;
  gid?: number;
}

/** Accepts a full URL, a bare spreadsheet id, or nothing (→ GOOGLE_SHEET_URL). */
export function parseSheetRef(v?: string): Ref {
  const s = v?.trim() || config.googleSheetUrl;
  if (!s) throw new GoogleError("No spreadsheet configured (GOOGLE_SHEET_URL is empty)");
  const id = s.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] ?? (/^[\w-]{20,}$/.test(s) ? s : null);
  if (!id) throw new GoogleError(`Not a spreadsheet link: ${s}`);
  const gid = s.match(/[#&?]gid=(\d+)/)?.[1];
  return { id, gid: gid ? Number(gid) : undefined };
}

async function call<T>(method: string, path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
  if (!sheetsGranted()) throw new GoogleError(NOT_GRANTED);
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    signal: AbortSignal.timeout(30_000),
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error?.message ?? text;
    } catch {
      /* raw */
    }
    if (res.status === 403 && /scope/i.test(msg)) msg = NOT_GRANTED;
    throw new GoogleError(`Google Sheets: ${msg}`, res.status);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface Tab {
  title: string;
  gid: number;
  rows: number;
  cols: number;
}

export async function spreadsheetInfo(ref: Ref): Promise<{ title: string; tabs: Tab[] }> {
  const r = await call<{ properties: { title: string }; sheets: { properties: { title: string; sheetId: number; gridProperties?: { rowCount: number; columnCount: number } } }[] }>(
    "GET",
    `/${ref.id}`,
    { fields: "properties.title,sheets.properties(title,sheetId,gridProperties)" },
  );
  return {
    title: r.properties.title,
    tabs: r.sheets.map((s) => ({ title: s.properties.title, gid: s.properties.sheetId, rows: s.properties.gridProperties?.rowCount ?? 0, cols: s.properties.gridProperties?.columnCount ?? 0 })),
  };
}

/** Tab by (fuzzy) name, else the one in the link's #gid, else the first. */
export async function resolveTab(ref: Ref, name?: string): Promise<Tab> {
  const { tabs } = await spreadsheetInfo(ref);
  if (name?.trim()) {
    const n = name.trim().toLowerCase();
    const t = tabs.find((x) => x.title.trim().toLowerCase() === n) ?? tabs.find((x) => x.title.toLowerCase().includes(n));
    if (!t) throw new GoogleError(`Tab "${name}" not found. Tabs: ${tabs.map((x) => x.title).join(", ")}`);
    return t;
  }
  return tabs.find((x) => x.gid === ref.gid) ?? tabs[0];
}

const quote = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

export function colLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * All values of a tab: header row + data rows, formatted as shown in the sheet.
 * A cell that is a link with other text (e.g. "CV" → Drive file) becomes "CV (https://…)".
 */
export async function readTab(ref: Ref, tab: string): Promise<{ headers: string[]; rows: string[][] }> {
  const r = await call<{ sheets?: { data?: { rowData?: { values?: { formattedValue?: string; hyperlink?: string }[] }[] }[] }[] }>("GET", `/${ref.id}`, {
    ranges: quote(tab),
    fields: "sheets.data.rowData.values(formattedValue,hyperlink)",
  });
  const all = (r.sheets?.[0]?.data?.[0]?.rowData ?? []).map((row) =>
    (row.values ?? []).map((c) => {
      const v = c.formattedValue ?? "";
      return c.hyperlink && c.hyperlink !== v.trim() ? (v.trim() ? `${v} (${c.hyperlink})` : c.hyperlink) : v;
    }),
  );
  const [headers = [], ...rows] = all;
  return { headers: headers.map((h) => String(h).trim()), rows };
}

export async function writeCells(ref: Ref, cells: { range: string; value: string }[]): Promise<number> {
  const r = await call<{ totalUpdatedCells?: number }>("POST", `/${ref.id}/values:batchUpdate`, {}, {
    valueInputOption: "USER_ENTERED",
    data: cells.map((c) => ({ range: c.range, values: [[c.value]] })),
  });
  return r.totalUpdatedCells ?? 0;
}

export async function appendRow(ref: Ref, tab: string, row: string[]): Promise<number | null> {
  const r = await call<{ updates?: { updatedRange?: string } }>(
    "POST",
    `/${ref.id}/values/${encodeURIComponent(`${quote(tab)}!A1`)}:append`,
    { valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" },
    { values: [row] },
  );
  const m = r.updates?.updatedRange?.match(/![A-Z]+(\d+)/);
  return m ? Number(m[1]) : null;
}

export { quote as quoteTab };
