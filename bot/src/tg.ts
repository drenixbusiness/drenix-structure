import { Bot, GrammyError, InlineKeyboard, InputFile } from "grammy";
import { config } from "./config.js";
import { db } from "./db.js";
import { hrChats } from "./services/users.js";
import type { Lang } from "./i18n.js";

export const bot = new Bot(config.telegramToken);

export const esc = (s: string | number | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type Keyboard = InlineKeyboard | undefined;

export async function send(chatId: number, html: string, kb?: Keyboard, opts: { track?: boolean } = {}) {
  const chunks = splitHtml(html);
  let last: Awaited<ReturnType<typeof bot.api.sendMessage>> | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const reply_markup = i === chunks.length - 1 ? kb : undefined;
    try {
      last = await bot.api.sendMessage(chatId, chunks[i], { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup });
    } catch (e) {
      // broken HTML from the model must not swallow the whole answer: resend as plain text
      if (!(e instanceof GrammyError && e.error_code === 400 && /parse entities|can't find end|unsupported start tag/i.test(e.description))) throw e;
      const plain = chunks[i].replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      last = await bot.api.sendMessage(chatId, plain, { link_preview_options: { is_disabled: true }, reply_markup });
    }
    if (opts.track) trackMessage(chatId, last.message_id);
  }
  return last!;
}

/** Sends to every HR chat. Returns true if at least one delivery succeeded. */
export async function sendHr(build: (lang: Lang) => { html: string; kb?: Keyboard }): Promise<boolean> {
  let ok = false;
  for (const c of hrChats()) {
    try {
      const { html, kb } = build(c.lang);
      await send(c.id, html, kb);
      ok = true;
    } catch (e) {
      console.error("sendHr failed", c.id, describe(e));
    }
  }
  return ok;
}

export async function sendHrDocument(file: Buffer, filename: string, caption?: string) {
  for (const c of hrChats()) {
    await bot.api.sendDocument(c.id, new InputFile(file, filename), caption ? { caption, parse_mode: "HTML" } : {});
  }
}

/** Candidate chats keep a log of message ids so the history can be cleaned up later. */
export function trackMessage(chatId: number, messageId: number) {
  db.prepare("INSERT OR IGNORE INTO chat_messages (chat_id, message_id) VALUES (?, ?)").run(chatId, messageId);
}

/**
 * Deletes tracked messages younger than ~47h (Telegram refuses older ones).
 * `keep` stays in the chat. Returns how many were removed.
 */
export async function cleanupChat(chatId: number, keep: number[] = []): Promise<number> {
  const rows = db
    .prepare("SELECT message_id FROM chat_messages WHERE chat_id = ? AND at > datetime('now', '-47 hours')")
    .all(chatId) as { message_id: number }[];
  const ids = rows.map((r) => r.message_id).filter((id) => !keep.includes(id));
  let removed = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    try {
      await bot.api.deleteMessages(chatId, part);
      removed += part.length;
    } catch (e) {
      // fall back one by one (some may already be gone)
      for (const id of part) {
        try {
          await bot.api.deleteMessage(chatId, id);
          removed++;
        } catch {
          /* too old or already deleted */
        }
      }
      console.warn("deleteMessages batch failed", describe(e));
    }
  }
  db.prepare(`DELETE FROM chat_messages WHERE chat_id = ? AND message_id NOT IN (${keep.map(() => "?").join(",") || "NULL"})`).run(chatId, ...keep);
  return removed;
}

export function describe(e: unknown): string {
  if (e instanceof GrammyError) return `${e.error_code} ${e.description}`;
  return e instanceof Error ? e.message : String(e);
}

/** Telegram limit is 4096 chars; split on blank lines / newlines. */
function splitHtml(html: string, max = 3900): string[] {
  if (html.length <= max) return [html];
  const out: string[] = [];
  let cur = "";
  for (const line of html.split("\n")) {
    if ((cur + "\n" + line).length > max && cur) {
      out.push(cur);
      cur = line;
    } else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

export { InlineKeyboard };
