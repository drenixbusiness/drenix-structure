/**
 * Function-calling tools. The model decides; these functions do the real work and
 * report back honestly (errors are returned, never hidden).
 */
import type OpenAI from "openai";
import { InputFile } from "grammy";
import { audit, db } from "../db.js";
import * as gcal from "../google/calendar.js";
import * as sheets from "../google/sheets.js";
import { applicantsText, dashboardFileName, dashboardPdf, dashboardText, listApplicants, recruitingReportLines, recruitingStats, type ApplicantStatus } from "../services/recruiting.js";
import { proposeSheetWrite, type RowChange } from "../services/sheetWrites.js";
import * as gforms from "../google/forms.js";
import { listForms, proposeForm, resolveForm, setFormAccepting } from "../services/forms.js";
import { analyzeForm, formReportFiles, formSummaryText, type ReportFormat } from "../services/formReport.js";
import { t, type Lang } from "../i18n.js";
import * as cands from "../services/candidates.js";
import { getJob, jobPipeline, listJobs, setJobStatus } from "../services/jobs.js";
import { cancelMeeting, conflictsFor, createMeeting, findSlots, freeWindows, getMeeting, meetingByEvent, moveMeeting, type Meeting } from "../services/meetings.js";
import { computeStats, recommendations, reportFileName, reportPdf, reportText, type Period } from "../services/reports.js";
import { backlog, createTask, deleteTask, getTask, listTasks, STATUSES, updateTask, type Status, type Task, type TaskPatch } from "../services/tasks.js";
import { bot, esc, InlineKeyboard, send } from "../tg.js";
import { ymdOf } from "../time.js";
import { addMinutes, currentOrNextShift, fmtDateTime, fmtTime, inShift, isoLocal, parseIso, shiftBounds, workdaysFrom } from "../time.js";

export interface ToolCtx {
  chatId: number;
  lang: Lang;
}

type Args = Record<string, unknown>;
type Impl = (a: Args, ctx: ToolCtx) => Promise<unknown> | unknown;

const S = (description: string) => ({ type: "string", description });
const N = (description: string) => ({ type: "number", description });
const B = (description: string) => ({ type: "boolean", description });
const fmtEnum = { type: "string", enum: ["online", "offline", "none"], description: "online = Google Meet link, offline = office, none = no location" };

const taskProps = {
  title: S("Short task title in the user's language"),
  description: S("Optional details"),
  shift_date: S("Workday YYYY-MM-DD; omit for undated backlog"),
  start: S("Planned start, ISO +05:00 (optional)"),
  duration_min: N("Estimated duration in minutes (optional)"),
  deadline: S("Deadline, ISO +05:00 (optional)"),
  priority: { type: "integer", enum: [1, 2, 3, 4], description: "1 Critical, 2 High, 3 Medium, 4 Low" },
};

export const TOOL_DEFS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  fn("get_agenda", "Tasks, calendar events and free windows for one or more workdays.", {
    shift_date: S("First workday YYYY-MM-DD (default: today's shift)"),
    days: N("Number of workdays (default 1, max 7)"),
  }),
  fn(
    "create_tasks",
    "Create one or more tasks at once (split multi-job messages).",
    {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ...taskProps,
            recurrence: S("Optional repeat rule: daily | weekdays | weekly:1,3 (0=Sun) | monthly:15"),
            depends_on_task_id: N("Existing task id that must be completed first"),
            depends_on_index: N("0-based index of another task in THIS batch that must be completed first"),
            job_request_id: N("Related job request id"),
          },
          required: ["title", "priority"],
        },
      },
    },
    ["tasks"],
  ),
  fn(
    "update_task",
    "Change a task: status, title, day (move/postpone), time, priority, result/notes.",
    {
      task_id: N("Task id"),
      ...taskProps,
      status: { type: "string", enum: [...STATUSES] },
      result: S("Outcome / reason (e.g. why not done)"),
      notes: S("Notes"),
      depends_on_task_id: N("Dependency task id, 0 to clear"),
    },
    ["task_id"],
  ),
  fn("delete_task", "Delete a task permanently (prefer status cancelled unless the user asks to delete).", { task_id: N("Task id") }, ["task_id"]),
  fn("search_tasks", "Search tasks / history by text, status or date range.", {
    query: S("Text to search"),
    status: { type: "array", items: { type: "string", enum: [...STATUSES] } },
    from_date: S("YYYY-MM-DD"),
    to_date: S("YYYY-MM-DD"),
  }),
  fn(
    "find_free_slots",
    "Free time inside work shifts (checks Google Calendar).",
    { duration_min: N("Needed minutes"), from_date: S("First workday YYYY-MM-DD"), days: N("Workdays to scan (default 3)") },
    ["duration_min"],
  ),
  fn(
    "create_meeting",
    "Create a Google Calendar event now (with a Google Meet link when online). Checks conflicts first.",
    {
      title: S("Event title"),
      start: S("ISO +05:00"),
      duration_min: N("Minutes"),
      format: fmtEnum,
      attendee_emails: { type: "array", items: { type: "string" }, description: "Guests to invite by email (optional)" },
      description: S("Optional description"),
      ignore_conflicts: B("true only if the user explicitly accepted the overlap"),
      remind_before_min: { type: "array", items: { type: "number" }, description: "Reminders to the user, minutes before start (e.g. [5]). Only when the user asked for specific reminders; omit for the defaults (1 day, 1 h, 15 min, 5 min)." },
    },
    ["title", "start", "duration_min", "format"],
  ),
  fn("list_events", "Calendar events between two moments.", { from: S("ISO +05:00"), to: S("ISO +05:00") }, ["from", "to"]),
  fn("move_meeting", "Move/resize a calendar event (ours or added by hand).", {
    meeting_id: N("Our meeting id (from list_events)"),
    event_id: S("Google event id (from list_events)"),
    new_start: S("ISO +05:00"),
    duration_min: N("New duration (optional)"),
  }, ["new_start"]),
  fn("cancel_meeting", "Cancel/delete a calendar event.", { meeting_id: N("Our meeting id"), event_id: S("Google event id") }),
  fn(
    "propose_schedule",
    "Show the user a plan with concrete times and Confirm/Cancel buttons. Meetings become calendar events, tasks get time blocks — only after the user confirms.",
    {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: S("Title"),
            start: S("ISO +05:00"),
            duration_min: N("Minutes"),
            type: { type: "string", enum: ["meeting", "task"] },
            format: fmtEnum,
            task_id: N("Existing task id when scheduling an existing task"),
            remind_before_min: { type: "array", items: { type: "number" }, description: "Custom reminder offsets in minutes (meetings only, optional)" },
          },
          required: ["title", "start", "duration_min", "type"],
        },
      },
      note: S("One-line comment shown above the plan"),
    },
    ["items"],
  ),
  fn(
    "invite_candidate",
    "Prepare an interview invitation. The user gets a preview with Confirm, then an invite link to forward. Ask for duration and format first.",
    {
      name: S("Candidate name (or the username if no name given)"),
      telegram_username: S("@username if known"),
      phone: S("Phone if known"),
      email: S("Email if known (Google invite will be emailed)"),
      position: S("Position / vacancy"),
      job_request_id: N("Related job request id"),
      duration_min: N("Interview length in minutes"),
      format: { type: "string", enum: ["online", "offline"] },
      fixed_start: S("Exact time if the user set one (ISO +05:00); omit to let the candidate pick a free slot"),
    },
    ["name", "duration_min", "format"],
  ),
  fn("list_candidates", "Candidates and their interview status.", {
    query: S("Name, @username, position…"),
    status: { type: "array", items: { type: "string" } },
  }),
  fn("list_job_requests", "Job requests from the website with candidate pipeline.", { status: { type: "string", enum: ["open", "closed"] } }),
  fn("update_job_request", "Open or close a job request.", { id: N("Job request id"), status: { type: "string", enum: ["open", "closed"] } }, ["id", "status"]),
  fn("save_contact", "Save or update a contact.", {
    name: S("Name"),
    username: S("Telegram @username"),
    phone: S("Phone"),
    email: S("Email"),
    position: S("Position"),
    company: S("Company"),
    notes: S("Notes"),
  }, ["name"]),
  fn("find_contacts", "Search contacts (and candidates).", { query: S("Text") }, ["query"]),
  fn(
    "sheet_info",
    "Google Sheets: list the tabs of the recruiting spreadsheet (or another spreadsheet link) with their column headers and row counts.",
    { spreadsheet: S("Spreadsheet link or id; omit for the default recruiting sheet") },
  ),
  fn(
    "sheet_read",
    "Google Sheets: read rows. Every row comes with its sheet row number (use it for sheet_update). Without filters returns the newest rows.",
    {
      spreadsheet: S("Spreadsheet link or id; omit for the default recruiting sheet"),
      tab: S("Tab name; omit for the default tab"),
      query: S("Text to search in any cell (name, phone, position…), case-insensitive"),
      filters: { type: "object", additionalProperties: { type: "string" }, description: 'Column → text the cell must contain, e.g. {"For which position are you applying": "dispatcher"}. Use "" to match empty cells.' },
      limit: N("Max rows to return (default 60, max 150)"),
      oldest_first: B("Return oldest matches first instead of newest"),
    },
  ),
  fn(
    "sheet_update",
    "Google Sheets: change cells of one or more existing rows. Nothing is written yet: the user gets a preview with Confirm/Cancel buttons. Column names are matched to the header row.",
    {
      spreadsheet: S("Spreadsheet link or id; omit for the default recruiting sheet"),
      tab: S("Tab name; omit for the default tab"),
      row: N("Sheet row number from sheet_read (single-row change)"),
      values: { type: "object", additionalProperties: { type: "string" }, description: 'Column → new value, e.g. {"Step 1. Online Interview": "Done"}' },
      rows: {
        type: "array",
        description: "Several rows at once (instead of row/values)",
        items: { type: "object", properties: { row: N("Sheet row number"), values: { type: "object", additionalProperties: { type: "string" } } }, required: ["row", "values"] },
      },
    },
  ),
  fn(
    "show_applicants",
    "Sends the user a ready list of applicants from the form tab (\"#row Name — position · date · CV link\") and returns the rows. Use it whenever the user should see/choose applicants: before rejecting when nobody is named, \"who is waiting\", \"who applied today\", \"show HR applicants\".",
    {
      status: { type: "string", enum: ["not_reviewed", "in_progress", "rejected", "approved", "all"], description: "Default not_reviewed (Step 1 empty, not rejected)" },
      position: S("Position filter, e.g. HR, Dispatcher (optional)"),
      query: S("Text in any cell: name, phone… (optional)"),
      from: S("Applied on/after YYYY-MM-DD (optional)"),
      to: S("Applied on/before YYYY-MM-DD (optional)"),
      limit: N("Max rows (default 15, max 50)"),
    },
  ),
  fn(
    "sheet_reject",
    'Reject applicants in the application-form tab using the sheet convention: every EMPTY step column gets the reject value ("Rejected by Daniel" / "Reject by Daniel"), Final decision = "Rejected by Daniel", Comment = reason. Cells that already say Done/approved are kept; already rejected rows are skipped. Shows a preview; written only after the user confirms. ONLY for applicants the user identified in their message (name, phone, a #row / number from a list you showed, or an explicit rule like "everyone under 18"). Never pass a whole list just because the user said "reject".',
    {
      rows: { type: "array", items: { type: "number" }, description: "Sheet row numbers (#) from sheet_read" },
      reason: S('Reason for the Comment column in English, like existing ones (e.g. "Age does not meet our requirements", "CV does not meet our requirements"); omit if the user gave none'),
      by: S('Who rejects (default "Daniel")'),
      spreadsheet: S("Spreadsheet link or id; omit for the default recruiting sheet"),
    },
    ["rows"],
  ),
  fn(
    "recruiting_dashboard",
    "Builds a recruiting dashboard from ALL tabs of the recruiting Google Sheet (applications funnel, positions, sources, rejection reasons, ages, interviewed candidates & retention, open vacancies, expenses) and sends it to the chat as text + PDF with charts.",
    {
      from: S("First date YYYY-MM-DD (optional; omit both for all time)"),
      to: S("Last date YYYY-MM-DD (optional)"),
      pdf: B("Send the PDF (default true)"),
      spreadsheet: S("Spreadsheet link or id; omit for the default recruiting sheet"),
    },
  ),
  fn(
    "sheet_append",
    "Google Sheets: add a new row at the bottom (preview + Confirm button first). Only when the user asked for it.",
    {
      spreadsheet: S("Spreadsheet link or id; omit for the default recruiting sheet"),
      tab: S("Tab name; omit for the default tab"),
      values: { type: "object", additionalProperties: { type: "string" }, description: "Column → value; missing columns stay empty" },
    },
    ["values"],
  ),
  fn(
    "create_form",
    "Google Forms: propose a new form (questionnaire for candidates, test, survey). Shows the user a preview of all questions with a Create/Cancel button; the form is created, published and its links sent ONLY after they press the button. Call again with the full corrected list if they ask for changes.",
    {
      title: S('Form title, e.g. "Drenix · Frontend developer — candidate questionnaire"'),
      description: S("Short intro shown to respondents (what it is, how long it takes)"),
      purpose: S("Whom/what it is for, e.g. \"Frontend developer candidates\" — used later to analyse the answers"),
      contact_fields: B("Add Full name + Phone (required) at the top (default true for candidates; false for anonymous surveys)"),
      questions: {
        type: "array",
        description: "Questions in order",
        items: {
          type: "object",
          properties: {
            title: S("Question text"),
            type: { type: "string", enum: ["short", "paragraph", "choice", "checkboxes", "dropdown", "scale", "date"], description: "short = one line, paragraph = long text, choice = one option, checkboxes = several options, dropdown, scale = 1..N rating, date" },
            options: { type: "array", items: { type: "string" }, description: "Options for choice/checkboxes/dropdown (2+)" },
            required: B("Default true"),
            description: S("Optional hint under the question"),
            high: N("Scale top value (default 5, max 10)"),
            low_label: S("Scale label for the lowest value"),
            high_label: S("Scale label for the highest value"),
          },
          required: ["title", "type"],
        },
      },
    },
    ["title", "questions"],
  ),
  fn("list_forms", "Google Forms created by the bot (or added by link): title, link, live response count.", {}),
  fn(
    "form_read",
    "Google Forms: read the responses of a form (each respondent's answers) to answer questions about them. For a full analysis with charts use form_report.",
    { form: S("Form title (or part), edit link or id; omit for the newest form"), limit: N("Most recent respondents to return (default 30, max 100)") },
  ),
  fn(
    "form_report",
    "Google Forms: analyse a form's responses (statistics per question, charts, AI summary of open answers, AI assessment of each candidate, recommendations) and send a short summary + report files to the chat.",
    {
      form: S("Form title (or part), edit link or id; omit for the newest form"),
      formats: { type: "array", items: { type: "string", enum: ["pdf", "docx", "xlsx"] }, description: "Files to send: pdf (default), docx = Word, xlsx = Excel with all raw responses. Several allowed." },
      from: S("Only responses from this date YYYY-MM-DD (optional)"),
      to: S("Only responses up to this date YYYY-MM-DD (optional)"),
    },
  ),
  fn(
    "form_accepting",
    "Google Forms: stop (close) or resume accepting responses for a form.",
    { form: S("Form title (or part), edit link or id; omit for the newest form"), accepting: B("false = close the form, true = open it again") },
    ["accepting"],
  ),
  fn("remember", "Store a long-term memory (preference, habit, fact).", { text: S("The fact, one sentence") }, ["text"]),
  fn("forget", "Delete a memory by id.", { memory_id: N("Memory id") }, ["memory_id"]),
  fn("get_stats", "Numbers for advice: completion/overdue rates, best day, overdue items.", { period: { type: "string", enum: ["day", "week", "month"] } }, ["period"]),
  fn(
    "send_report",
    "Send the daily/weekly/monthly report to the chat (text with recommendations, optionally as PDF).",
    { period: { type: "string", enum: ["day", "week", "month"] }, pdf: B("Also send a PDF"), date: S("Workday the report ends on, YYYY-MM-DD (optional)") },
    ["period"],
  ),
];

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): OpenAI.Chat.Completions.ChatCompletionTool {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

// ---------------- helpers ----------------

const MAX_CELL = 300;
const norm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();
/** Header index by exact, then prefix, then substring match. */
function colIndex(headers: string[], name: string): number {
  const n = norm(name);
  const hs = headers.map(norm);
  let i = hs.indexOf(n);
  if (i < 0) i = hs.findIndex((h) => h && h.startsWith(n));
  if (i < 0) i = hs.findIndex((h) => h && (h.includes(n) || n.includes(h)));
  if (i < 0) throw new Error(`Column "${name}" not found. Columns: ${headers.filter(Boolean).join(" | ")}`);
  return i;
}
const rowView = (headers: string[], r: string[], rowNo: number) => {
  const o: Record<string, string | number> = { row: rowNo };
  headers.forEach((h, i) => {
    const v = String(r[i] ?? "").trim();
    if (v) o[h || `col ${sheets.colLetter(i)}`] = v.length > MAX_CELL ? `${v.slice(0, MAX_CELL)}…` : v;
  });
  return o;
};
/** Name of the person in a row (for previews), falling back to the first filled cell. */
function rowLabel(headers: string[], r: string[]): string {
  const i = headers.findIndex((h) => /full name|ф\.?и\.?о|^name|^имя|ism/i.test(h));
  return String((i >= 0 ? r[i] : r.find((c) => String(c).trim())) ?? "").trim().slice(0, 60);
}
/** The application-form tab: the one with "Full Name" + "Step 1" headers, else the default tab. */
async function formTab(ref: ReturnType<typeof sheets.parseSheetRef>) {
  const { tabs } = await sheets.spreadsheetInfo(ref);
  for (const tb of tabs) {
    const { headers } = await sheets.readTab(ref, tb.title);
    if (headers.some((h) => /full name/i.test(h)) && headers.some((h) => /step 1/i.test(h))) return tb;
  }
  return sheets.resolveTab(ref);
}
const previewResult = (u: RowChange[]) => ({
  ok: true,
  awaiting_confirmation: true,
  rows: u.map((x) => ({ row: x.row, name: x.label, changes: x.cells.map((c) => `${c.column}: "${c.old}" → "${c.value}"`) })),
  note: "A preview with ✅/❌ buttons was sent to the user. NOTHING is written until they press ✅ — do not say it is done. Reply with one short line.",
});
const strMap = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== "object") throw new Error("values must be an object of column → value");
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, x == null ? "" : String(x)]));
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const date = (v: unknown) => {
  const s = str(v);
  if (!s) return undefined;
  const d = parseIso(s);
  if (!d) throw new Error(`Bad datetime: ${s}`);
  return d;
};
const mins = (v: unknown) => (Array.isArray(v) ? v.map(num).filter((n): n is number => !!n && n > 0 && n <= 10080) : undefined);
const ymd = (v: unknown) => {
  const s = str(v);
  if (s && !/^\d{4}-\d\d-\d\d$/.test(s)) throw new Error(`Bad date (YYYY-MM-DD): ${s}`);
  return s;
};

const taskView = (x: Task) => ({
  id: x.id,
  title: x.title,
  status: x.status,
  priority: `P${x.priority}`,
  shift_date: x.shift_date,
  start: x.start_at ? isoLocal(new Date(x.start_at)) : null,
  duration_min: x.duration_min,
  deadline: x.deadline_at ? isoLocal(new Date(x.deadline_at)) : null,
  depends_on: x.depends_on,
  result: x.result,
  postponed: x.postponed_count || undefined,
  recurrence: x.recurrence || undefined,
});

const iv = (a: { start: Date; end: Date; title?: string }) => ({ start: isoLocal(a.start), end: isoLocal(a.end), ...(a.title ? { title: a.title } : {}) });

/** Flags times that fall outside the task's workday (e.g. on a day off) so the model can correct itself. */
function timeWarning(x: Task): string | undefined {
  if (!x.start_at) return undefined;
  const s = new Date(x.start_at);
  if (!inShift(s)) return `start ${isoLocal(s)} is outside working hours / on a day off — ask the user or move it into a shift`;
  if (x.shift_date && x.shift_date !== currentOrNextShift(s)) return `start ${isoLocal(s)} does not belong to shift_date ${x.shift_date}`;
  return undefined;
}

async function alternatives(durationMin: number, around: Date) {
  const slots = await findSlots({ durationMin, fromShift: currentOrNextShift(around), days: 2, count: 4, leadMin: 15 });
  return slots.map(isoLocal);
}

function meetingView(m: Meeting) {
  return { meeting_id: m.id, title: m.title, start: isoLocal(new Date(m.start_at)), end: isoLocal(new Date(m.end_at)), format: m.format, meet_url: m.meet_url, status: m.status, kind: m.kind };
}

async function resolveEvent(a: Args): Promise<{ meeting: Meeting | null; eventId: string | null }> {
  const mid = num(a.meeting_id);
  if (mid) {
    const m = getMeeting(mid);
    if (!m) throw new Error(`Meeting ${mid} not found`);
    return { meeting: m, eventId: m.calendar_event_id };
  }
  const eid = str(a.event_id);
  if (!eid) throw new Error("meeting_id or event_id is required");
  return { meeting: meetingByEvent(eid), eventId: eid };
}

// ---------------- implementations ----------------

const impl: Record<string, Impl> = {
  async get_agenda(a) {
    const first = ymd(a.shift_date) ?? currentOrNextShift();
    const days = Math.min(7, Math.max(1, num(a.days) ?? 1));
    const list = workdaysFrom(first, days);
    const windows = await freeWindows(first, days).catch(() => []);
    const out = [];
    for (const sd of list) {
      const { start, end } = shiftBounds(sd);
      let events: unknown[] = [];
      if (gcal.googleConnected()) {
        const evs = await gcal.listEvents(start, end);
        events = evs.map((e) => ({
          event_id: e.id,
          meeting_id: meetingByEvent(e.id)?.id,
          title: e.summary,
          start: gcal.isAllDay(e) ? e.start.date : isoLocal(gcal.eventStart(e)),
          end: gcal.isAllDay(e) ? e.end.date : isoLocal(gcal.eventEnd(e)),
          meet_url: gcal.meetLink(e),
        }));
      }
      out.push({
        shift_date: sd,
        shift: iv({ start, end }),
        tasks: listTasks({ shift_date: sd }).map(taskView),
        events,
        free: windows.find((w) => w.shift_date === sd)?.free.map(iv) ?? [],
      });
    }
    return { days: out, backlog: backlog().map(taskView), google_connected: gcal.googleConnected() };
  },

  create_tasks(a) {
    const items = Array.isArray(a.tasks) ? (a.tasks as Args[]) : [];
    if (!items.length) throw new Error("tasks is empty");
    const created: Task[] = [];
    const out = [];
    for (const it of items) {
      const depIdx = num(it.depends_on_index);
      const dep = num(it.depends_on_task_id) ?? (depIdx !== undefined ? created[depIdx]?.id : undefined);
      const start = date(it.start);
      const { task, duplicate } = createTask({
        title: str(it.title) ?? "Task",
        description: str(it.description) ?? null,
        shift_date: ymd(it.shift_date) ?? (start ? currentOrNextShift(start) : null),
        start_at: start ?? null,
        duration_min: num(it.duration_min) ?? null,
        deadline_at: date(it.deadline) ?? null,
        priority: num(it.priority),
        recurrence: str(it.recurrence) ?? null,
        depends_on: dep ?? null,
        job_request_id: num(it.job_request_id) ?? null,
      });
      created.push(task);
      out.push({ ...taskView(task), duplicate: duplicate || undefined, warning: timeWarning(task) });
    }
    audit("ai", "create_tasks", out.map((x) => x.id));
    return { ok: true, created: out };
  },

  update_task(a) {
    const id = num(a.task_id);
    if (!id || !getTask(id)) throw new Error(`Task ${a.task_id} not found`);
    const patch: TaskPatch = {};
    if (str(a.title)) patch.title = str(a.title);
    if (a.description !== undefined) patch.description = str(a.description) ?? null;
    if (a.shift_date !== undefined) patch.shift_date = ymd(a.shift_date) ?? null;
    if (a.start !== undefined) patch.start_at = date(a.start) ?? null;
    if (a.duration_min !== undefined) patch.duration_min = num(a.duration_min) ?? null;
    if (a.deadline !== undefined) patch.deadline_at = date(a.deadline) ?? null;
    if (a.priority !== undefined) patch.priority = num(a.priority);
    if (str(a.status)) patch.status = str(a.status) as Status;
    if (a.result !== undefined) patch.result = str(a.result) ?? null;
    if (a.notes !== undefined) patch.notes = str(a.notes) ?? null;
    if (a.depends_on_task_id !== undefined) patch.depends_on = num(a.depends_on_task_id) || null;
    if (patch.start_at && patch.shift_date === undefined) patch.shift_date = currentOrNextShift(patch.start_at);
    const after = updateTask(id, patch)!;
    audit("ai", "update_task", { id, patch });
    return { ok: true, task: taskView(after), warning: timeWarning(after) };
  },

  delete_task(a) {
    const id = num(a.task_id);
    if (!id) throw new Error("task_id required");
    if (!getTask(id)) return { ok: false, error: `task ${id} does not exist — if this is a calendar meeting use cancel_meeting` };
    const ok = deleteTask(id);
    audit("ai", "delete_task", id);
    return { ok };
  },

  search_tasks(a) {
    const rows = listTasks({
      query: str(a.query),
      statuses: Array.isArray(a.status) ? (a.status as Status[]) : undefined,
      from_shift: ymd(a.from_date),
      to_shift: ymd(a.to_date),
      limit: 60,
    });
    return { count: rows.length, tasks: rows.map(taskView) };
  },

  async find_free_slots(a) {
    const dur = num(a.duration_min) ?? 30;
    const from = ymd(a.from_date) ?? currentOrNextShift();
    const days = Math.min(7, Math.max(1, num(a.days) ?? 3));
    const windows = await freeWindows(from, days);
    const starts = await findSlots({ durationMin: dur, fromShift: from, days, count: 8, leadMin: 15 });
    return { google_connected: gcal.googleConnected(), windows: windows.map((w) => ({ shift_date: w.shift_date, free: w.free.map(iv) })), suggested_starts: starts.map(isoLocal) };
  },

  async create_meeting(a) {
    const start = date(a.start);
    if (!start) throw new Error("start required");
    const dur = num(a.duration_min) ?? 30;
    const end = addMinutes(start, dur);
    if (start < addMinutes(new Date(), -5)) return { ok: false, error: "start is in the past", free_alternatives: await alternatives(dur, new Date()) };
    if (!a.ignore_conflicts) {
      const clash = await conflictsFor(start, end);
      if (clash.length) return { ok: false, conflict: clash.map(iv), alternatives: await alternatives(dur, start) };
    }
    const fmt = (str(a.format) ?? "online") as "online" | "offline" | "none";
    const m = await createMeeting({
      title: str(a.title) ?? "Meeting",
      start,
      durationMin: dur,
      format: fmt,
      attendees: Array.isArray(a.attendee_emails) ? (a.attendee_emails as string[]).filter((e) => /@/.test(e)) : undefined,
      description: str(a.description),
      remindersMin: mins(a.remind_before_min),
    });
    audit("ai", "create_meeting", { id: m.id });
    return { ok: true, ...meetingView(m), meet_link_created: fmt === "online" ? !!m.meet_url : undefined };
  },

  async list_events(a) {
    const from = date(a.from);
    const to = date(a.to);
    if (!from || !to) throw new Error("from/to required");
    if (!gcal.googleConnected()) return { google_connected: false, events: [] };
    const evs = await gcal.listEvents(from, to);
    return {
      events: evs.map((e) => ({
        event_id: e.id,
        meeting_id: meetingByEvent(e.id)?.id,
        title: e.summary,
        start: gcal.isAllDay(e) ? e.start.date : isoLocal(gcal.eventStart(e)),
        end: gcal.isAllDay(e) ? e.end.date : isoLocal(gcal.eventEnd(e)),
        meet_url: gcal.meetLink(e),
      })),
    };
  },

  async move_meeting(a, ctx) {
    const start = date(a.new_start);
    if (!start) throw new Error("new_start required");
    const { meeting, eventId } = await resolveEvent(a);
    let dur = num(a.duration_min);
    if (meeting) {
      dur ??= Math.round((+new Date(meeting.end_at) - +new Date(meeting.start_at)) / 60_000);
      const clash = await conflictsFor(start, addMinutes(start, dur), meeting.calendar_event_id ?? undefined);
      if (clash.length && !a.ignore_conflicts) return { ok: false, conflict: clash.map(iv), alternatives: await alternatives(dur, start) };
      const m = await moveMeeting(meeting.id, start, dur);
      if (m.candidate_id) await askNotifyCandidate(ctx, m.candidate_id, "cm", t(ctx.lang, "btn_send"));
      return { ok: true, ...meetingView(m), candidate_notice: m.candidate_id ? "asked the user whether to notify the candidate" : undefined };
    }
    const ev = await gcal.getEvent(eventId!);
    dur ??= Math.round((+gcal.eventEnd(ev) - +gcal.eventStart(ev)) / 60_000);
    const clash = await conflictsFor(start, addMinutes(start, dur), eventId!);
    if (clash.length && !a.ignore_conflicts) return { ok: false, conflict: clash.map(iv), alternatives: await alternatives(dur, start) };
    const upd = await gcal.updateEvent(eventId!, { start, end: addMinutes(start, dur) });
    return { ok: true, event_id: upd.id, start: isoLocal(gcal.eventStart(upd)), end: isoLocal(gcal.eventEnd(upd)) };
  },

  async cancel_meeting(a, ctx) {
    const { meeting, eventId } = await resolveEvent(a);
    if (meeting) {
      await cancelMeeting(meeting.id);
      if (meeting.candidate_id) await askNotifyCandidate(ctx, meeting.candidate_id, "cx", t(ctx.lang, "btn_send"));
      return { ok: true, cancelled: meeting.title, candidate_notice: meeting.candidate_id ? "asked the user whether to notify the candidate" : undefined };
    }
    await gcal.deleteEvent(eventId!);
    return { ok: true };
  },

  async propose_schedule(a, ctx) {
    const items = (Array.isArray(a.items) ? (a.items as Args[]) : []).map((it) => ({
      title: str(it.title) ?? "Item",
      start: date(it.start)!.toISOString(),
      duration_min: num(it.duration_min) ?? 30,
      type: str(it.type) === "task" ? "task" : "meeting",
      format: (str(it.format) ?? "online") as "online" | "offline" | "none",
      task_id: num(it.task_id),
      reminders: mins(it.remind_before_min),
    }));
    if (!items.length) throw new Error("items is empty");
    items.sort((x, y) => +new Date(x.start) - +new Date(y.start));
    const id = Number(db.prepare("INSERT INTO pending_actions (kind, payload) VALUES ('plan', ?)").run(JSON.stringify(items)).lastInsertRowid);
    const lines = items.map((it) => {
      const s = new Date(it.start);
      const icon = it.type === "meeting" ? (it.format === "online" ? "💻" : it.format === "offline" ? "🏢" : "📅") : "📝";
      return `${icon} <b>${fmtTime(s)}–${fmtTime(addMinutes(s, it.duration_min))}</b> ${esc(it.title)}`;
    });
    const dayLabel = fmtDateTime(new Date(items[0].start), ctx.lang, true).split(",").slice(0, 2).join(",");
    await send(
      ctx.chatId,
      `${t(ctx.lang, "plan_title")} · ${dayLabel}\n${str(a.note) ? `<i>${esc(str(a.note))}</i>\n` : ""}\n${lines.join("\n")}`,
      new InlineKeyboard().text(t(ctx.lang, "btn_confirm"), `pl:${id}:ok`).text(t(ctx.lang, "btn_cancel"), `pl:${id}:no`),
    );
    return { ok: true, shown_to_user: true, note: "Plan with Confirm/Cancel buttons was shown. Do not repeat the list; just say a short line." };
  },

  async invite_candidate(a) {
    const name = str(a.name) ?? str(a.telegram_username) ?? "Candidate";
    const fixed = date(a.fixed_start);
    const dur = num(a.duration_min) ?? 30;
    if (fixed) {
      const clash = await conflictsFor(fixed, addMinutes(fixed, dur));
      if (clash.length) return { ok: false, conflict: clash.map(iv), alternatives: await alternatives(dur, fixed) };
    }
    const c = cands.createDraft({
      name,
      username: str(a.telegram_username),
      phone: str(a.phone),
      email: str(a.email),
      position: str(a.position),
      job_request_id: num(a.job_request_id),
      duration_min: dur,
      format: str(a.format) === "offline" ? "offline" : "online",
      fixed_start: fixed,
    });
    await cands.sendPreview(c);
    return { ok: true, candidate_id: c.id, shown_to_user: true, note: "A preview with Confirm/Cancel was shown. Say one short line." };
  },

  list_candidates(a) {
    const rows = cands.listCandidates({ query: str(a.query), status: Array.isArray(a.status) ? (a.status as cands.CandStatus[]) : undefined });
    return {
      candidates: rows.map((c) => {
        const m = c.meeting_id ? getMeeting(c.meeting_id) : null;
        return {
          id: c.id,
          name: c.name,
          username: c.username,
          position: c.position,
          status: c.status,
          outcome: c.outcome,
          interview: m ? meetingView(m) : null,
          job_request_id: c.job_request_id,
        };
      }),
    };
  },

  list_job_requests(a) {
    const s = str(a.status) as "open" | "closed" | undefined;
    return {
      job_requests: listJobs(s).map((j) => ({
        id: j.id,
        position: j.position,
        department: j.department,
        open_positions: j.open_positions,
        requester: j.requester,
        status: j.status,
        created: j.created_at,
        pipeline: jobPipeline(j.id),
      })),
    };
  },

  update_job_request(a) {
    const id = num(a.id);
    if (!id || !getJob(id)) throw new Error("job request not found");
    const j = setJobStatus(id, str(a.status) === "closed" ? "closed" : "open");
    return { ok: true, id, status: j?.status };
  },

  save_contact(a) {
    const name = str(a.name);
    if (!name) throw new Error("name required");
    const username = str(a.username)?.replace(/^@/, "");
    const existing = db
      .prepare("SELECT id FROM contacts WHERE (? IS NOT NULL AND username = ?) OR lower(name) = lower(?) LIMIT 1")
      .get(username ?? null, username ?? null, name) as { id: number } | undefined;
    const vals = [name, username ?? null, str(a.phone) ?? null, str(a.email) ?? null, str(a.position) ?? null, str(a.company) ?? null, str(a.notes) ?? null];
    if (existing) {
      db.prepare(
        "UPDATE contacts SET name = ?, username = COALESCE(?, username), phone = COALESCE(?, phone), email = COALESCE(?, email), position = COALESCE(?, position), company = COALESCE(?, company), notes = COALESCE(?, notes) WHERE id = ?",
      ).run(...vals, existing.id);
      return { ok: true, id: existing.id, updated: true };
    }
    const r = db.prepare("INSERT INTO contacts (name, username, phone, email, position, company, notes) VALUES (?, ?, ?, ?, ?, ?, ?)").run(...vals);
    return { ok: true, id: Number(r.lastInsertRowid) };
  },

  find_contacts(a) {
    const q = `%${(str(a.query) ?? "").replace(/^@/, "")}%`;
    const contacts = db
      .prepare("SELECT * FROM contacts WHERE name LIKE ? OR IFNULL(username,'') LIKE ? OR IFNULL(email,'') LIKE ? OR IFNULL(phone,'') LIKE ? OR IFNULL(company,'') LIKE ? LIMIT 20")
      .all(q, q, q, q, q);
    const meetings = db.prepare("SELECT id, title, start_at, status, outcome FROM meetings WHERE title LIKE ? ORDER BY start_at DESC LIMIT 10").all(q) as {
      id: number;
      title: string;
      start_at: string;
      status: string;
      outcome: string | null;
    }[];
    return {
      contacts,
      candidates: cands.listCandidates({ query: str(a.query), limit: 10 }).map((c) => ({ id: c.id, name: c.name, username: c.username, status: c.status, position: c.position })),
      meeting_history: meetings.map((m) => ({ ...m, start_at: isoLocal(new Date(m.start_at)) })),
    };
  },

  async sheet_info(a) {
    const ref = sheets.parseSheetRef(str(a.spreadsheet));
    const info = await sheets.spreadsheetInfo(ref);
    const def = await sheets.resolveTab(ref);
    const tabs = [];
    for (const tb of info.tabs.slice(0, 15)) {
      const { headers, rows } = await sheets.readTab(ref, tb.title);
      tabs.push({ tab: tb.title, default: tb.gid === def.gid || undefined, columns: headers.filter(Boolean), data_rows: rows.filter((r) => r.some((c) => String(c).trim())).length });
    }
    return { title: info.title, tabs };
  },

  async sheet_read(a) {
    const ref = sheets.parseSheetRef(str(a.spreadsheet));
    const tab = await sheets.resolveTab(ref, str(a.tab));
    const { headers, rows } = await sheets.readTab(ref, tab.title);
    const q = str(a.query)?.toLowerCase();
    const filters = a.filters && typeof a.filters === "object" ? Object.entries(strMap(a.filters)).map(([k, v]) => [colIndex(headers, k), v.toLowerCase().trim()] as const) : [];
    let hits = rows
      .map((r, i) => ({ r, rowNo: i + 2 }))
      .filter(({ r }) => r.some((c) => String(c).trim()))
      .filter(({ r }) => !q || r.some((c) => String(c).toLowerCase().includes(q)))
      .filter(({ r }) => filters.every(([i, v]) => (v === "" ? !String(r[i] ?? "").trim() : String(r[i] ?? "").toLowerCase().includes(v))));
    const total = hits.length;
    const limit = Math.min(Math.max(num(a.limit) ?? 60, 1), 150);
    hits = a.oldest_first ? hits.slice(0, limit) : hits.slice(-limit).reverse();
    return {
      tab: tab.title,
      columns: headers.filter(Boolean),
      total_matches: total,
      returned: hits.length,
      ...(hits.length < total ? { note: `Only ${hits.length} of ${total} rows shown. Do not conclude anything about the rest: use filters on the relevant column or a larger limit.` } : {}),
      rows: hits.map(({ r, rowNo }) => rowView(headers, r, rowNo)) };
  },

  async sheet_update(a, ctx) {
    const ref = sheets.parseSheetRef(str(a.spreadsheet));
    const tab = await sheets.resolveTab(ref, str(a.tab));
    const items = Array.isArray(a.rows) && a.rows.length ? (a.rows as Args[]) : [{ row: a.row, values: a.values }];
    const { headers, rows } = await sheets.readTab(ref, tab.title);
    const updates: RowChange[] = items.map((it) => {
      const row = num(it.row);
      if (!row || row < 2) throw new Error("row must be a data row number (2 or more) from sheet_read");
      const before = rows[row - 2] ?? [];
      if (!before.some((c) => String(c).trim())) throw new Error(`Row ${row} is empty; read the sheet again to get the right row number`);
      const cells = Object.entries(strMap(it.values))
        .map(([k, v]) => ({ col: colIndex(headers, k), value: v }))
        .map(({ col, value }) => ({ col, column: headers[col], old: String(before[col] ?? ""), value }))
        .filter((c) => c.old.trim() !== c.value.trim());
      return { row, label: rowLabel(headers, before), cells };
    });
    const changed = updates.filter((u) => u.cells.length);
    if (!changed.length) return { ok: true, nothing_to_change: true, note: "The cells already have these values." };
    await proposeSheetWrite(ctx.chatId, ctx.lang, { spreadsheetId: ref.id, tab: tab.title, title: "", updates: changed });
    return previewResult(changed);
  },

  async show_applicants(a, ctx) {
    const status = (str(a.status) ?? "not_reviewed") as ApplicantStatus;
    const from = ymd(a.from);
    const { applicants } = await listApplicants({ status, position: str(a.position), query: str(a.query), from, to: ymd(a.to) ?? (from ? ymdOf(new Date()) : undefined) });
    const limit = Math.min(Math.max(num(a.limit) ?? 15, 1), 50);
    const list = applicants.slice(0, limit);
    await send(ctx.chatId, applicantsText(list, applicants.length, status, ctx.lang));
    return {
      ok: true,
      shown_to_user: true,
      total: applicants.length,
      rows: list.map((x) => ({ row: x.row, name: x.name, position: x.position, date: x.date, status: x.status })),
      note: "The list with #row numbers is already in the chat — do not repeat it. Reply with one short line (e.g. ask whom to reject: #numbers or names).",
    };
  },

  async sheet_reject(a, ctx) {
    const ref = sheets.parseSheetRef(str(a.spreadsheet));
    const tab = await formTab(ref);
    const { headers, rows } = await sheets.readTab(ref, tab.title);
    const find = (re: RegExp) => headers.findIndex((h) => re.test(h.toLowerCase()));
    const i1 = find(/step 1/), i2 = find(/step 2/), iF = find(/final|decision|desicion/), iR = find(/comment|reason/);
    if (iF < 0) throw new Error(`No final decision column in "${tab.title}". Columns: ${headers.filter(Boolean).join(" | ")}`);
    const by = str(a.by) ?? "Daniel";
    const reason = str(a.reason);
    const list = (Array.isArray(a.rows) ? a.rows : [a.rows]).map(num).filter((n): n is number => !!n && n >= 2);
    if (!list.length) throw new Error("rows required (sheet row numbers from sheet_read)");
    const already: string[] = [];
    const updates: RowChange[] = [];
    for (const row of [...new Set(list)]) {
      const r = rows[row - 2] ?? [];
      if (!r.some((c) => String(c).trim())) throw new Error(`Row ${row} is empty; read the sheet again`);
      // already rejected → leave the row (and its reason) as it is
      if (/reject/i.test(String(r[iF] ?? ""))) {
        already.push(`#${row} ${rowLabel(headers, r)}`);
        continue;
      }
      const want: [number, string][] = [];
      if (i1 >= 0 && !String(r[i1] ?? "").trim()) want.push([i1, `Rejected by ${by}`]);
      if (i2 >= 0 && !String(r[i2] ?? "").trim()) want.push([i2, `Reject by ${by}`]);
      want.push([iF, `Rejected by ${by}`]);
      if (reason && iR >= 0) want.push([iR, reason]);
      const cells = want.map(([col, value]) => ({ col, column: headers[col], old: String(r[col] ?? ""), value })).filter((c) => c.old.trim() !== c.value.trim());
      if (cells.length) updates.push({ row, label: rowLabel(headers, r), cells });
      else already.push(`#${row} ${rowLabel(headers, r)}`);
    }
    if (!updates.length) return { ok: true, nothing_to_change: true, already_rejected: already };
    await proposeSheetWrite(ctx.chatId, ctx.lang, { spreadsheetId: ref.id, tab: tab.title, title: "Reject", updates });
    return { ...previewResult(updates), already_rejected: already.length ? already : undefined };
  },

  async create_form(a, ctx) {
    const title = str(a.title);
    const raw = Array.isArray(a.questions) ? (a.questions as Args[]) : [];
    if (!title || !raw.length) return { ok: false, error: "title and at least one question are required" };
    const TYPES = ["short", "paragraph", "choice", "checkboxes", "dropdown", "scale", "date"];
    const questions: gforms.QuestionDraft[] = raw
      .map((q) => ({
        title: str(q.title) ?? "",
        type: (TYPES.includes(q.type as string) ? q.type : "short") as gforms.QuestionType,
        options: Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : undefined,
        required: q.required !== false,
        description: str(q.description),
        high: num(q.high),
        lowLabel: str(q.low_label),
        highLabel: str(q.high_label),
      }))
      .filter((q) => q.title);
    const contact = a.contact_fields !== false;
    const isContact = (t: string) => /(ism|familiya|f\.?i\.?sh|фио|имя|name|telefon|телефон|phone)/i.test(t);
    const CONTACT: Record<Lang, [string, string]> = { uz: ["To'liq ism-familiya", "Telefon raqam"], ru: ["ФИО", "Номер телефона"], en: ["Full name", "Phone number"] };
    const head: gforms.QuestionDraft[] = contact && !questions.slice(0, 3).some((q) => isContact(q.title)) ? CONTACT[ctx.lang].map((t) => ({ title: t, type: "short" as const, required: true })) : [];
    const all = [...head, ...questions].slice(0, 60);
    await proposeForm(ctx.chatId, ctx.lang, { title, description: str(a.description) ?? "", purpose: str(a.purpose) ?? title, questions: all });
    return {
      ok: true,
      preview_shown: true,
      questions: all.length,
      note: "The user sees the full question list with Create/Cancel buttons. NOTHING is created until they press Create; then the links are sent to them automatically. Reply in 1 short line (do not repeat the questions, do not invent a link).",
    };
  },

  list_forms: async () => {
    const forms = listForms(20);
    const out = [];
    for (const f of forms) {
      let responses: number | string = f.seen_responses;
      try {
        responses = (await gforms.listResponses(f.form_id)).length;
      } catch (e) {
        responses = `? (${(e as Error).message.slice(0, 80)})`;
      }
      out.push({ title: f.title, purpose: f.purpose, responder_link: f.responder_uri, edit_link: gforms.editUrl(f.form_id), responses, accepting: !!f.accepting, created: f.created_at.slice(0, 10) });
    }
    return { forms: out };
  },

  async form_read(a) {
    const f = await resolveForm(str(a.form));
    const an = await analyzeForm(f, "en", { ai: false });
    const limit = Math.min(100, num(a.limit) ?? 30);
    return {
      form: an.title,
      purpose: an.purpose,
      total_responses: an.total,
      questions: an.questions.map((q) => ({ q: q.index, title: q.title, kind: q.kind, answered: q.answered, ...(q.counts ? { counts: Object.fromEntries(q.counts) } : {}), ...(q.avg !== undefined ? { avg: q.avg } : {}) })),
      respondents: an.respondents.slice(-limit).map((r) => ({ n: r.n, name: r.name, submitted: isoLocal(r.at).slice(0, 16), answers: Object.fromEntries(Object.entries(r.answers).map(([k, v]) => [k, v.slice(0, MAX_CELL)])) })),
      ...(an.total > limit ? { note: `Only the newest ${limit} of ${an.total} respondents are shown.` } : {}),
    };
  },

  async form_report(a, ctx) {
    const f = await resolveForm(str(a.form));
    const from = ymd(a.from);
    const to = ymd(a.to) ?? (from ? ymdOf(new Date()) : undefined);
    const formats = (Array.isArray(a.formats) ? a.formats.filter((x): x is ReportFormat => ["pdf", "docx", "xlsx"].includes(x as string)) : []) as ReportFormat[];
    const an = await analyzeForm(f, ctx.lang, { from, to });
    await send(ctx.chatId, formSummaryText(an, ctx.lang));
    const files = an.total ? await formReportFiles(an, ctx.lang, formats.length ? [...new Set(formats)] : ["pdf"]) : [];
    for (const file of files) await bot.api.sendDocument(ctx.chatId, new InputFile(file.data, file.name));
    return {
      ok: true,
      shown_to_user: true,
      responses: an.total,
      files: files.map((x) => x.name),
      top: an.ai?.scores.slice(0, 3).map((s) => ({ name: an.respondents.find((r) => r.n === s.n)?.name, score: s.score })),
      note: an.total
        ? "Summary and files are already sent. Reply with 1–2 short lines (most useful insight or next step), no repetition."
        : "The form has no responses yet (summary with the link already sent). Say so in one line.",
    };
  },

  async form_accepting(a) {
    const f = await resolveForm(str(a.form));
    const accepting = a.accepting !== false;
    await setFormAccepting(f, accepting);
    return { ok: true, form: f.title, accepting };
  },

  async recruiting_dashboard(a, ctx) {
    const from = ymd(a.from);
    const to = ymd(a.to) ?? (from ? ymdOf(new Date()) : undefined);
    const s = await recruitingStats(from, to, str(a.spreadsheet));
    await send(ctx.chatId, dashboardText(s, ctx.lang));
    if (a.pdf !== false) await bot.api.sendDocument(ctx.chatId, new InputFile(await dashboardPdf(s, ctx.lang), dashboardFileName(s)));
    return {
      ok: true,
      shown_to_user: true,
      summary: { applications: s.apps?.total, funnel: s.apps?.funnel, open_vacancies: s.vacancies?.open, seats_left: s.vacancies?.remaining, retention: s.candidates?.retention },
      note: "Dashboard (text + PDF) already sent. Reply with 1–3 short lines: the most useful insight from the numbers, no repetition of the whole dashboard.",
    };
  },

  async sheet_append(a, ctx) {
    const ref = sheets.parseSheetRef(str(a.spreadsheet));
    const tab = await sheets.resolveTab(ref, str(a.tab));
    const { headers } = await sheets.readTab(ref, tab.title);
    const out: string[] = headers.map(() => "");
    for (const [k, v] of Object.entries(strMap(a.values))) out[colIndex(headers, k)] = v;
    await proposeSheetWrite(ctx.chatId, ctx.lang, {
      spreadsheetId: ref.id,
      tab: tab.title,
      title: "",
      updates: [],
      append: headers.map((h, i) => ({ column: h || sheets.colLetter(i), value: out[i] })),
      appendRow: out,
    });
    return { ok: true, awaiting_confirmation: true, note: "A preview with ✅/❌ buttons was sent. Nothing is written until the user presses ✅. Reply with one short line." };
  },

  remember(a) {
    const text = str(a.text);
    if (!text) throw new Error("text required");
    const r = db.prepare("INSERT INTO memories (text) VALUES (?)").run(text);
    return { ok: true, memory_id: Number(r.lastInsertRowid) };
  },

  forget(a) {
    const id = num(a.memory_id);
    return { ok: !!id && db.prepare("DELETE FROM memories WHERE id = ?").run(id).changes > 0 };
  },

  async get_stats(a) {
    return computeStats((str(a.period) ?? "week") as Period);
  },

  async send_report(a, ctx) {
    const period = (str(a.period) ?? "day") as Period;
    const s = await computeStats(period, ymd(a.date));
    const recs = period === "day" ? [] : await recommendations(s, ctx.lang);
    const rec = await recruitingReportLines(s.from, s.to, ctx.lang);
    const extra = rec ? [rec] : [];
    await send(ctx.chatId, reportText(s, ctx.lang, recs, extra), new InlineKeyboard().text(t(ctx.lang, "btn_pdf"), `rp:${period}:${s.to}`));
    if (a.pdf) await bot.api.sendDocument(ctx.chatId, new InputFile(await reportPdf(s, ctx.lang, recs, extra), reportFileName(s)));
    return { ok: true, shown_to_user: true, stats: { completionRate: s.completionRate, overdue: s.overdue, total: s.total }, note: "Report already sent; reply with at most one short line." };
  },
};

async function askNotifyCandidate(ctx: ToolCtx, candidateId: number, prefix: "cm" | "cx", sendLabel: string) {
  const c = cands.getCandidate(candidateId);
  if (!c?.chat_id) return;
  const q =
    prefix === "cm"
      ? { uz: `${esc(c.name)} ga yangi vaqt haqida xabar yuborilsinmi?`, ru: `Сообщить ${esc(c.name)} о новом времени?`, en: `Notify ${esc(c.name)} about the new time?` }
      : { uz: `${esc(c.name)} ga suhbat bekor qilingani haqida xabar yuborilsinmi?`, ru: `Сообщить ${esc(c.name)} об отмене собеседования?`, en: `Tell ${esc(c.name)} the interview is cancelled?` };
  await send(ctx.chatId, q[ctx.lang], new InlineKeyboard().text(sendLabel, `${prefix}:${c.id}:send`).text(t(ctx.lang, "btn_dont_send"), `${prefix}:${c.id}:skip`));
}

export async function runTool(name: string, rawArgs: string, ctx: ToolCtx): Promise<string> {
  const f = impl[name];
  if (!f) return JSON.stringify({ ok: false, error: `unknown tool ${name}` });
  try {
    const args = rawArgs ? (JSON.parse(rawArgs) as Args) : {};
    const res = await f(args, ctx);
    return JSON.stringify(res ?? { ok: true });
  } catch (e) {
    console.error(`tool ${name} failed:`, e);
    return JSON.stringify({ ok: false, error: (e as Error).message });
  }
}

// ---------------- confirmed plan execution ----------------

export async function executePlan(id: number, lang: Lang): Promise<string> {
  const row = db.prepare("SELECT * FROM pending_actions WHERE id = ? AND kind = 'plan'").get(id) as { payload: string; status: string } | undefined;
  if (!row || row.status !== "pending") return t(lang, "already_done");
  db.prepare("UPDATE pending_actions SET status = 'done' WHERE id = ?").run(id);
  const items = JSON.parse(row.payload) as { title: string; start: string; duration_min: number; type: string; format: "online" | "offline" | "none"; task_id?: number; reminders?: number[] }[];
  const errors: string[] = [];
  const done: string[] = [];
  for (const it of items) {
    const start = new Date(it.start);
    try {
      if (it.type === "meeting") {
        const m = await createMeeting({ title: it.title, start, durationMin: it.duration_min, format: it.format, remindersMin: it.reminders });
        done.push(`• ${fmtTime(start)} ${esc(it.title)}${m.meet_url ? ` — ${m.meet_url}` : ""}`);
      } else if (it.task_id && getTask(it.task_id)) {
        updateTask(it.task_id, { start_at: start, duration_min: it.duration_min, shift_date: currentOrNextShift(start) });
        done.push(`• ${fmtTime(start)} ${esc(it.title)}`);
      } else {
        createTask({ title: it.title, start_at: start, duration_min: it.duration_min, shift_date: currentOrNextShift(start), priority: 3 });
        done.push(`• ${fmtTime(start)} ${esc(it.title)}`);
      }
    } catch (e) {
      errors.push(`• ${esc(it.title)}: ${esc((e as Error).message)}`);
    }
  }
  audit("hr", "plan_confirmed", { id, ok: done.length, failed: errors.length });
  return errors.length ? `${t(lang, "plan_partial", { errors: errors.join("\n") })}${done.length ? `\n\n${done.join("\n")}` : ""}` : `${t(lang, "plan_done")}\n\n${done.join("\n")}`;
}

export function cancelPlan(id: number) {
  db.prepare("UPDATE pending_actions SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(id);
}
