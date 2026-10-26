import { config, isHr } from "../config.js";
import { db } from "../db.js";
import { isLang, type Lang } from "../i18n.js";

export interface User {
  id: number;
  role: "hr" | "candidate" | "none";
  lang: Lang | null;
  first_name: string | null;
  username: string | null;
  pending_token: string | null;
}

export function getUser(id: number): User | null {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
  if (!u) return null;
  return { ...u, lang: isLang(u.lang) ? u.lang : null };
}

export function ensureUser(from: { id: number; first_name?: string; username?: string }): User {
  db.prepare(
    `INSERT INTO users (id, role, first_name, username) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username, updated_at = datetime('now')`,
  ).run(from.id, isHr(from.id) ? "hr" : "none", from.first_name ?? null, from.username ?? null);
  // HR membership always follows the env list
  db.prepare("UPDATE users SET role = 'hr' WHERE id = ? AND role != 'hr'").run(isHr(from.id) ? from.id : -1);
  return getUser(from.id)!;
}

export function setLang(id: number, lang: Lang) {
  db.prepare("UPDATE users SET lang = ?, updated_at = datetime('now') WHERE id = ?").run(lang, id);
}

export function setPendingToken(id: number, token: string | null) {
  db.prepare("UPDATE users SET pending_token = ? WHERE id = ?").run(token, id);
}

export function setRole(id: number, role: User["role"]) {
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
}

/** HR chats the bot can message (they must have pressed /start once). */
export function hrChats(): { id: number; lang: Lang }[] {
  return config.hrUserIds
    .map((id) => getUser(id))
    .filter((u): u is User => !!u)
    .map((u) => ({ id: u.id, lang: u.lang ?? "uz" }));
}

/** Language of the main HR user (for texts generated outside a chat context). */
export const hrLang = (): Lang => hrChats()[0]?.lang ?? "uz";
export const hrName = (): string => {
  const u = config.hrUserIds.map((id) => getUser(id)).find(Boolean);
  return u?.first_name ?? "Daniel";
};
