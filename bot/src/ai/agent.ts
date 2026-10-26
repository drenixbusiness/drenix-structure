import type OpenAI from "openai";
import { config } from "../config.js";
import { db } from "../db.js";
import { LANG_NAME, type Lang } from "../i18n.js";
import { modelOpts, openai } from "./client.js";
import { systemPrompt } from "./prompt.js";
import { runTool, TOOL_DEFS, type ToolCtx } from "./tools.js";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const HISTORY = 16;
const MAX_ROUNDS = 8;

function history(chatId: number): Msg[] {
  const rows = db
    .prepare("SELECT role, content FROM conversation WHERE chat_id = ? AND at > datetime('now', '-3 days') ORDER BY id DESC LIMIT ?")
    .all(chatId, HISTORY) as { role: "user" | "assistant"; content: string }[];
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

const remember = (chatId: number, role: "user" | "assistant", content: string) =>
  db.prepare("INSERT INTO conversation (chat_id, role, content) VALUES (?, ?, ?)").run(chatId, role, content.slice(0, 4000));

/** Runs the assistant for one user message. Returns Telegram-HTML to send (may be empty). */
export async function runAgent(chatId: number, text: string, lang: Lang): Promise<string> {
  const ctx: ToolCtx = { chatId, lang };
  const messages: Msg[] = [
    { role: "system", content: systemPrompt(lang) },
    ...history(chatId),
    // after the history, so earlier replies in another language don't win
    { role: "system", content: `Reply in ${LANG_NAME[lang]} only.` },
    { role: "user", content: text },
  ];
  let answer = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const r = await openai.chat.completions.create({
      model: config.openaiModel,
      messages,
      tools: TOOL_DEFS,
      tool_choice: "auto",
      parallel_tool_calls: true,
      ...modelOpts(0.2),
    });
    const msg = r.choices[0].message;
    if (!msg.tool_calls?.length) {
      answer = msg.content ?? "";
      break;
    }
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      if (call.type !== "function") continue;
      const out = await runTool(call.function.name, call.function.arguments, ctx);
      if (process.env.DEBUG_TOOLS) console.log(`🔧 ${call.function.name}(${call.function.arguments}) → ${out.slice(0, 400)}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: out });
    }
  }
  if (lang === "uz") answer = latinizeMixed(answer);
  remember(chatId, "user", text);
  if (answer) remember(chatId, "assistant", answer);
  return toTelegramHtml(answer);
}

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s",
  т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "'", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o'", қ: "q", ғ: "g'", ҳ: "h",
};
/**
 * The model sometimes copies Cyrillic letters from the user's Uzbek-Cyrillic message into a Latin word
 * ("qolганда"). Only words that mix both scripts are transliterated; pure Cyrillic names stay as they are.
 */
export function latinizeMixed(s: string): string {
  return s.replace(/[\p{L}'ʻʼ]+/gu, (w) => {
    if (!/[a-z]/i.test(w) || !/[Ѐ-ӿ]/.test(w)) return w;
    return [...w]
      .map((ch) => {
        const lo = ch.toLowerCase();
        const t = CYR[lo];
        if (t === undefined) return ch;
        return ch === lo ? t : t.charAt(0).toUpperCase() + t.slice(1);
      })
      .join("");
  });
}

/** Keeps only Telegram-safe tags; converts stray Markdown the model may still produce. */
export function toTelegramHtml(s: string): string {
  let out = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|\s)__(.+?)__(?=\s|$)/g, "$1<i>$2</i>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/^\s*[-*]\s+/gm, "• ");
  // escape everything, then restore allowed tags
  out = out.replace(/&(?!amp;|lt;|gt;|quot;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  out = out
    .replace(/&lt;(\/?)(b|i|u|s|code|pre)&gt;/g, "<$1$2>")
    .replace(/&lt;a href="(https?:[^"]+)"&gt;/g, '<a href="$1">')
    .replace(/&lt;\/a&gt;/g, "</a>");
  return balance(out.trim());
}

/** Drops unbalanced tags so Telegram doesn't reject the message. */
function balance(html: string): string {
  const stack: string[] = [];
  const re = /<(\/?)(b|i|u|s|code|pre|a)(\s[^>]*)?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) {
      if (stack[stack.length - 1] === m[2]) stack.pop();
      else return html.replace(/<\/?(b|i|u|s|code|pre|a)(\s[^>]*)?>/g, "");
    } else stack.push(m[2]);
  }
  return stack.length ? html.replace(/<\/?(b|i|u|s|code|pre|a)(\s[^>]*)?>/g, "") : html;
}
