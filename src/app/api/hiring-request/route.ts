import { NextResponse } from "next/server";
import { emptyHiringRequest, formatHiringMessage, validateHiring, type HiringRequest } from "@/lib/hiring";

// Posts an Employee Recruitment Request to the HR Telegram group.
// The bot token stays on the server (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID in .env.local).

export async function POST(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return NextResponse.json({ ok: false, error: "Telegram bot is not configured on the server." }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  // keep only known fields, coerce to strings
  const base = emptyHiringRequest();
  const src = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max = 1000) => (typeof v === "string" ? v.slice(0, max) : "");
  const arr = (v: unknown) => (Array.isArray(v) ? v.slice(0, 5).map((x) => str(x, 300)) : ["", "", "", "", ""]);
  const data = { ...base } as HiringRequest;
  for (const k of Object.keys(base) as (keyof HiringRequest)[]) {
    if (k === "responsibilities" || k === "hardSkills" || k === "softSkills") data[k] = arr(src[k]);
    else (data as unknown as Record<string, string>)[k] = str(src[k]);
  }

  // honeypot: bots fill hidden fields; pretend success
  if (data.website) return NextResponse.json({ ok: true });

  const errors = validateHiring(data);
  if (Object.keys(errors).length) return NextResponse.json({ ok: false, error: "Please complete all required fields.", errors }, { status: 422 });

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: formatHiringMessage(data), parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => null);

  if (!res || !res.ok) {
    const detail = res ? await res.text().catch(() => "") : "network error";
    console.error("Telegram sendMessage failed:", detail);
    return NextResponse.json({ ok: false, error: "Could not send to Telegram. Please try again." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
