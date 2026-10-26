/**
 * Local console to talk to the AI agent without Telegram (tools run for real against the
 * local DB; messages the tools would send go to Telegram only if an HR chat exists).
 *   npm run chat            (interactive)
 *   npm run chat -- "text"  (one shot)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { runAgent } from "../ai/agent.js";
import { isLang } from "../i18n.js";
import { bot } from "../tg.js";

process.env.DEBUG_TOOLS = "1";
// fake chat id: replies stay in the console, nothing reaches real Telegram chats
const chatId = 1;

// Every Telegram call the tools make is printed instead of sent; documents are saved to CHAT_OUT_DIR.
const outDir = process.env.CHAT_OUT_DIR ?? "./data/chat-out";
let fakeId = 1000;
bot.api.config.use(async (_prev, method, payload) => {
  const p = payload as Record<string, unknown>;
  if (method === "sendMessage" || method === "editMessageText") {
    const kb = (p.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard;
    console.log(`\n📨 [${method}]\n${String(p.text)}${kb?.length ? `\n   ${kb.map((r) => r.map((b) => `[${b.text} → ${b.callback_data}]`).join(" ")).join("\n   ")}` : ""}`);
  } else if (method === "sendDocument") {
    const doc = p.document as { filename?: string; fileData?: unknown };
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, doc.filename ?? `doc-${fakeId}.pdf`);
    if (Buffer.isBuffer(doc.fileData)) writeFileSync(file, doc.fileData);
    console.log(`\n📎 [sendDocument] ${file}`);
  } else if (method !== "sendChatAction") console.log(`\n· [${method}]`);
  return { ok: true, result: { message_id: ++fakeId, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: "private" } } } as never;
});
const lang = isLang(process.env.LANG_CODE) ? process.env.LANG_CODE : "uz";

async function ask(text: string) {
  const t0 = Date.now();
  const out = await runAgent(chatId, text, lang);
  console.log(`\n🤖 (${((Date.now() - t0) / 1000).toFixed(1)}s)\n${out}\n`);
}

const oneShot = process.argv.slice(2).join(" ").trim();
if (oneShot) {
  await ask(oneShot);
  process.exitCode = 0;
  setTimeout(() => process.exit(0), 50);
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "you> " });
  rl.prompt();
  rl.on("line", async (line) => {
    if (line.trim()) await ask(line.trim()).catch((e) => console.error(e));
    rl.prompt();
  });
}
