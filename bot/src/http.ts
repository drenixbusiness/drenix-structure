/**
 * Small HTTP bridge for the website (structure.drenix.uz on Vercel):
 *   POST /job-request   Authorization: Bearer <BOT_API_SECRET>
 *   GET  /health
 * Bound to 127.0.0.1; nginx terminates HTTPS for bot.drenix.uz in front of it.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { receiveJob } from "./services/jobs.js";
import { describe } from "./tg.js";

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

function authorized(req: IncomingMessage) {
  const got = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(config.apiSecret);
  return got.length === want.length && timingSafeEqual(got, want);
}

function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const s = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function startHttp() {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true });
      if (req.method === "POST" && req.url === "/job-request") {
        if (!authorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        const html = s(body.html, 4000);
        const position = s(body.position);
        if (!html || !position) return json(res, 400, { ok: false, error: "html and position are required" });
        const n = Number(body.openPositions);
        try {
          const id = await receiveJob({
            department: s(body.department) || "—",
            position,
            openPositions: Number.isInteger(n) && n > 0 ? n : 1,
            requester: s(body.requester) || "—",
            html,
            fields: typeof body.fields === "object" && body.fields ? (body.fields as Record<string, unknown>) : {},
          });
          return json(res, 200, { ok: true, id });
        } catch (e) {
          console.error("job request → Telegram failed:", describe(e));
          return json(res, 502, { ok: false, error: "telegram_failed" });
        }
      }
      json(res, 404, { ok: false });
    } catch (e) {
      json(res, 400, { ok: false, error: (e as Error).message });
    }
  });
  server.listen(config.httpPort, config.httpHost, () => console.log(`HTTP bridge on http://${config.httpHost}:${config.httpPort}`));
  return server;
}
