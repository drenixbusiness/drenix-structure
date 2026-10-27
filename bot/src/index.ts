import { config } from "./config.js";
import { db } from "./db.js";
import { googleConnected, googleEmail } from "./google/calendar.js";
import { registerHandlers } from "./handlers.js";
import { startHttp } from "./http.js";
import { startScheduler, stopScheduler } from "./services/scheduler.js";
import { bot } from "./tg.js";

// A stray rejected promise (a forgotten .catch somewhere) is logged instead of killing the bot.
process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e));
// A real crash leaves the process in an unknown state: log it and exit, PM2 starts a clean one within seconds.
process.on("uncaughtException", (e) => {
  console.error("uncaught exception, restarting:", e);
  process.exit(1);
});

async function main() {
  registerHandlers();
  await bot.init();
  console.log(`Bot @${bot.botInfo.username} · HR ids ${config.hrUserIds.join(",")} · model ${config.openaiModel}`);
  console.log(googleConnected() ? `Google Calendar: ${googleEmail()}` : "Google Calendar: NOT connected (npm run google:auth)");

  await bot.api.setMyCommands(
    [
      { command: "start", description: "Start / restart" },
      { command: "today", description: "Today's plan" },
      { command: "report", description: "Daily report" },
      { command: "lang", description: "Language" },
      { command: "google", description: "Calendar status" },
    ],
    { scope: { type: "all_private_chats" } },
  );

  const server = startHttp();
  startScheduler();

  const stop = async (sig: string) => {
    console.log(`${sig}: shutting down`);
    stopScheduler();
    server.close();
    await bot.stop();
    db.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));

  // long polling: only outgoing connections, works behind NAT
  await bot.start({ allowed_updates: ["message", "callback_query"], onStart: () => console.log("Polling started") });
}

main().catch((e) => {
  console.error(`fatal: ${startupHint(e)}\n`, e);
  process.exit(1); // PM2 retries with a growing delay
});

/** The usual reasons the bot can't start, in plain words for the PM2 log. */
function startupHint(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/401|Unauthorized/i.test(m)) return "Telegram rejected TELEGRAM_BOT_TOKEN (wrong or revoked) — put the current token from @BotFather into .env";
  if (/409|Conflict|terminated by other getUpdates/i.test(m)) return "another copy of the bot is running with the same token (local PC or a second PM2 process) — stop it";
  if (/EADDRINUSE/i.test(m)) return `port ${config.httpPort} is busy — another bot process is still running (pm2 ls) or change HTTP_PORT`;
  if (/fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network/i.test(m)) return "no internet / Telegram unreachable — will retry";
  if (/Missing required env|is required/i.test(m)) return "a required setting is missing in .env (see .env.example)";
  return "unexpected error";
}
