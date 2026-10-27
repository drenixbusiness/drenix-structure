import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "./config.js";

const file = resolve(config.dbPath);
mkdirSync(dirname(file), { recursive: true });

export const db = new Database(file);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

/** Ordered migrations; index + 1 = schema version (PRAGMA user_version). */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,          -- Telegram user id (= private chat id)
    role          TEXT NOT NULL DEFAULT 'none', -- hr | candidate | none
    lang          TEXT,                         -- uz | ru | en
    first_name    TEXT,
    username      TEXT,
    pending_token TEXT,                         -- invite token waiting for language choice
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE job_requests (
    id               INTEGER PRIMARY KEY,
    department       TEXT NOT NULL,
    position         TEXT NOT NULL,
    open_positions   INTEGER NOT NULL DEFAULT 1,
    requester        TEXT,
    payload          TEXT NOT NULL,             -- JSON of the form
    status           TEXT NOT NULL DEFAULT 'open', -- open | closed
    group_message_id INTEGER,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at        TEXT
  );

  CREATE TABLE tasks (
    id              INTEGER PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT,
    shift_date      TEXT,                       -- workday YYYY-MM-DD
    start_at        TEXT,                       -- ISO UTC, planned block
    duration_min    INTEGER,
    deadline_at     TEXT,                       -- ISO UTC
    priority        INTEGER NOT NULL DEFAULT 3, -- 1 critical .. 4 low
    status          TEXT NOT NULL DEFAULT 'pending', -- pending | in_progress | completed | postponed | cancelled | blocked
    result          TEXT,
    notes           TEXT,
    recurrence      TEXT,                       -- daily | weekdays | weekly:1,3 | monthly:15
    recurring_parent INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    depends_on      INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    job_request_id  INTEGER REFERENCES job_requests(id) ON DELETE SET NULL,
    postponed_count INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT
  );
  CREATE INDEX tasks_shift ON tasks(shift_date, status);

  CREATE TABLE task_history (
    id      INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    field   TEXT NOT NULL,
    old     TEXT,
    new     TEXT,
    at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE contacts (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    username   TEXT,
    chat_id    INTEGER,
    phone      TEXT,
    email      TEXT,
    position   TEXT,
    company    TEXT,
    notes      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE candidates (
    id             INTEGER PRIMARY KEY,
    name           TEXT NOT NULL,
    username       TEXT,
    phone          TEXT,
    email          TEXT,
    position       TEXT,
    job_request_id INTEGER REFERENCES job_requests(id) ON DELETE SET NULL,
    token          TEXT NOT NULL UNIQUE,
    chat_id        INTEGER,
    lang           TEXT,
    duration_min   INTEGER NOT NULL DEFAULT 30,
    format         TEXT NOT NULL DEFAULT 'online', -- online | offline
    fixed_start    TEXT,                       -- ISO when HR set the time
    offered_slots  TEXT,                       -- JSON ISO[]
    selected_start TEXT,
    meeting_id     INTEGER,
    status         TEXT NOT NULL DEFAULT 'draft',
      -- draft | invited | opened | slot_selected | scheduled | confirmed | reschedule | declined | passed | rejected | no_show | closed
    outcome        TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at      TEXT
  );

  CREATE TABLE meetings (
    id                INTEGER PRIMARY KEY,
    title             TEXT NOT NULL,
    kind              TEXT NOT NULL DEFAULT 'meeting', -- meeting | interview
    start_at          TEXT NOT NULL,
    end_at            TEXT NOT NULL,
    format            TEXT NOT NULL DEFAULT 'online',  -- online | offline | none
    meet_url          TEXT,
    location          TEXT,
    calendar_event_id TEXT UNIQUE,
    candidate_id      INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
    status            TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | cancelled | completed
    outcome           TEXT,
    outcome_asked     INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX meetings_start ON meetings(start_at);

  CREATE TABLE notifications (
    id        INTEGER PRIMARY KEY,
    ref       TEXT NOT NULL UNIQUE,   -- dedupe key
    chat_id   INTEGER NOT NULL,
    kind      TEXT NOT NULL,
    due_at    TEXT NOT NULL,          -- ISO UTC
    payload   TEXT NOT NULL DEFAULT '{}',
    sent_at   TEXT,
    cancelled INTEGER NOT NULL DEFAULT 0,
    attempts  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX notifications_due ON notifications(sent_at, cancelled, due_at);

  CREATE TABLE chat_messages (        -- candidate chats, for history cleanup
    chat_id    INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    at         TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (chat_id, message_id)
  );

  CREATE TABLE conversation (
    id      INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL,
    role    TEXT NOT NULL,            -- user | assistant
    content TEXT NOT NULL,
    at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX conversation_chat ON conversation(chat_id, id);

  CREATE TABLE memories (
    id         INTEGER PRIMARY KEY,
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE pending_actions (      -- things waiting for a confirm button
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL,
    payload    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending', -- pending | done | cancelled
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE processed_updates (    -- duplicate message protection
    chat_id    INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    PRIMARY KEY (chat_id, message_id)
  );

  CREATE TABLE audit_log (
    id     INTEGER PRIMARY KEY,
    actor  TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT,
    at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // v2: per-meeting reminder offsets (JSON minutes[]; NULL = defaults)
  `ALTER TABLE meetings ADD COLUMN reminders TEXT;`,
  // v3: Google Forms created by the bot (or added by link) and how many responses HR has been told about
  `
  CREATE TABLE forms (
    id             INTEGER PRIMARY KEY,
    form_id        TEXT NOT NULL UNIQUE,
    title          TEXT NOT NULL,
    purpose        TEXT,
    responder_uri  TEXT,
    questions      INTEGER NOT NULL DEFAULT 0,
    seen_responses INTEGER NOT NULL DEFAULT 0,
    accepting      INTEGER NOT NULL DEFAULT 1,
    watch          INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // v4: per-task reminder offsets (JSON minutes before start; NULL = 15)
  `ALTER TABLE tasks ADD COLUMN reminders TEXT;`,
];

export function migrate() {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
migrate();

export const nowIso = () => new Date().toISOString();

/** Runs from the scheduler: old chat history, finished reminders and answered buttons are not needed forever. */
export function housekeeping() {
  db.prepare("DELETE FROM conversation WHERE at < datetime('now', '-90 days')").run();
  db.prepare("DELETE FROM notifications WHERE (sent_at IS NOT NULL OR cancelled = 1) AND due_at < ?").run(new Date(Date.now() - 90 * 86_400_000).toISOString());
  db.prepare("DELETE FROM pending_actions WHERE status != 'pending' AND created_at < datetime('now', '-90 days')").run();
}

export function audit(actor: string, action: string, detail?: unknown) {
  db.prepare("INSERT INTO audit_log (actor, action, detail) VALUES (?, ?, ?)").run(
    actor,
    action,
    detail === undefined ? null : typeof detail === "string" ? detail : JSON.stringify(detail),
  );
}

export function getSetting(key: string): string | null {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return r?.value ?? null;
}
export function setSetting(key: string, value: string | null) {
  if (value === null) db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  else db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
