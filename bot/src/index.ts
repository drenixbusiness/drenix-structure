import { config } from "./config.js";
import { db } from "./db.js";
import { googleConnected, googleEmail } from "./google/calendar.js";
import { registerHandlers } from "./handlers.js";
import { startHttp } from "./http.js";
import { startScheduler, stopScheduler } from "./services/scheduler.js";
import { bot } from "./tg.js";

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
  console.error("fatal", e);
  process.exit(1);
});
