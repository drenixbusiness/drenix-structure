import { toFile } from "openai";
import { config } from "../config.js";
import { bot } from "../tg.js";
import { openai } from "./client.js";

const HINT =
  "Speech mixes Uzbek, Russian and English in one sentence. Work terms: Drenix, HR, JD, interview, meeting, task, deadline, Google Meet, candidate, dispatcher, recruiter.";

/** Telegram voice/audio file → text. Falls back to whisper-1 if the main model fails. */
export async function transcribe(fileId: string): Promise<string> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) throw new Error("Telegram returned no file path");
  const res = await fetch(`https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`);
  if (!res.ok) throw new Error(`voice download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const name = file.file_path.split("/").pop() || "voice.ogg";
  const run = async (model: string) =>
    (await openai.audio.transcriptions.create({ file: await toFile(buf, name.endsWith(".oga") ? name.replace(/\.oga$/, ".ogg") : name), model, prompt: HINT })).text.trim();
  try {
    return await run(config.transcribeModel);
  } catch (e) {
    console.warn("transcribe fallback:", (e as Error).message);
    return run("whisper-1");
  }
}
