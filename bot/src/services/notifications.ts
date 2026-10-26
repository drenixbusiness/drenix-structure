/**
 * Persistent notification queue. The scheduler sends due rows; nothing lives in memory,
 * so restarts (power cuts) only delay messages, never lose them.
 */
import { db } from "../db.js";

/** chat_id 0 = every HR user */
export const HR_CHAT = 0;

export interface Notification {
  id: number;
  ref: string;
  chat_id: number;
  kind: string;
  due_at: string;
  payload: string;
  attempts: number;
}

/** Insert or move an unsent notification. Already-sent refs are left alone (no duplicates). */
export function schedule(ref: string, chatId: number, kind: string, dueAt: Date, payload: Record<string, unknown> = {}) {
  db.prepare(
    `INSERT INTO notifications (ref, chat_id, kind, due_at, payload) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ref) DO UPDATE SET due_at = excluded.due_at, payload = excluded.payload, chat_id = excluded.chat_id, cancelled = 0
     WHERE notifications.sent_at IS NULL`,
  ).run(ref, chatId, kind, dueAt.toISOString(), JSON.stringify(payload));
}

export function cancelPrefix(prefix: string) {
  db.prepare("UPDATE notifications SET cancelled = 1 WHERE sent_at IS NULL AND ref LIKE ? ESCAPE '\\'").run(`${prefix.replace(/[%_\\]/g, "\\$&")}%`);
}

export function due(limit = 50): Notification[] {
  return db
    .prepare("SELECT * FROM notifications WHERE sent_at IS NULL AND cancelled = 0 AND due_at <= ? ORDER BY due_at LIMIT ?")
    .all(new Date().toISOString(), limit) as Notification[];
}

export const markSent = (id: number) => db.prepare("UPDATE notifications SET sent_at = datetime('now') WHERE id = ?").run(id);
export const markFailed = (id: number) =>
  db.prepare("UPDATE notifications SET attempts = attempts + 1, cancelled = CASE WHEN attempts >= 4 THEN 1 ELSE 0 END WHERE id = ?").run(id);

export const wasSent = (ref: string) => !!db.prepare("SELECT 1 FROM notifications WHERE ref = ? AND sent_at IS NOT NULL").get(ref);
