import "dotenv/config";

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}
const opt = (name: string, def: string) => process.env[name]?.trim() || def;

function hm(name: string, def: string): number {
  const [h, m] = opt(name, def).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) throw new Error(`${name} must be HH:MM`);
  return h * 60 + m;
}

export const config = {
  telegramToken: req("TELEGRAM_BOT_TOKEN"),
  jobsChatId: Number(req("JOBS_CHAT_ID")),
  hrUserIds: req("HR_USER_IDS")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Boolean),

  openaiKey: req("OPENAI_API_KEY"),
  openaiModel: opt("OPENAI_MODEL", "gpt-4.1-mini"),
  /** reasoning effort for gpt-5.x models; Chat Completions with tools needs "none" on gpt-5.4 */
  openaiReasoning: opt("OPENAI_REASONING", "none"),
  transcribeModel: opt("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-transcribe"),

  googleClientId: opt("GOOGLE_CLIENT_ID", ""),
  googleClientSecret: opt("GOOGLE_CLIENT_SECRET", ""),
  /** default spreadsheet for the sheet_* tools (full URL; #gid= picks the default tab) */
  googleSheetUrl: opt("GOOGLE_SHEET_URL", ""),

  apiSecret: req("BOT_API_SECRET"),
  httpHost: opt("HTTP_HOST", "127.0.0.1"),
  httpPort: Number(opt("HTTP_PORT", "4000")),

  encryptionKey: req("ENCRYPTION_KEY"),

  /** minutes after local midnight */
  shiftStart: hm("SHIFT_START", "17:00"),
  shiftEnd: hm("SHIFT_END", "02:00"),
  briefingTime: hm("BRIEFING_TIME", "16:45"),
  reviewTime: hm("REVIEW_TIME", "01:30"),
  offDays: opt("OFF_DAYS", "0")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => n >= 0 && n <= 6),

  officeAddress: opt("OFFICE_ADDRESS", ""),
  officeMapUrl: opt("OFFICE_MAP_URL", ""),

  dbPath: opt("DB_PATH", "./data/assistant.db"),

  /** reminder offsets before a meeting, minutes */
  hrMeetingReminders: [1440, 60, 15, 5],
  candidateReminders: [1440, 60],
  /** interview slots offered to a candidate */
  slotCount: 5,
  slotDays: 3,
} as const;

export const isHr = (userId: number | undefined) => !!userId && config.hrUserIds.includes(userId);
