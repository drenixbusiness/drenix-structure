/**
 * One-time Google Calendar + Sheets + Forms connection.
 *   npm run google:auth        (local, via tsx)
 *   npm run google:auth:prod   (server, compiled)
 *
 * Opens a consent URL. After "Allow", Google redirects to http://localhost:53682/?code=...
 * - On the same machine the local listener catches it automatically.
 * - On a remote server the browser shows "can't connect": copy that full URL from the
 *   address bar and paste it here.
 */
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { config } from "../config.js";
import { exchangeCode, GOOGLE_SCOPES } from "./calendar.js";

const PORT = 53682;
const redirectUri = `http://localhost:${PORT}`;

if (!config.googleClientId || !config.googleClientSecret) {
  console.error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing in .env");
  process.exit(1);
}

const url =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    login_hint: "drenixit@gmail.com",
  }).toString();

let finished = false;
async function finish(code: string) {
  if (finished) return;
  finished = true;
  try {
    const email = await exchangeCode(code, redirectUri);
    console.log(`\n✅ Google Calendar + Sheets + Forms connected${email ? ` as ${email}` : ""}. You can close this window.`);
    process.exit(0);
  } catch (e) {
    console.error("\n❌", (e as Error).message);
    process.exit(1);
  }
}

const server = createServer((req, res) => {
  const u = new URL(req.url ?? "/", redirectUri);
  const code = u.searchParams.get("code");
  const err = u.searchParams.get("error");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    `<body style="font-family:system-ui;background:#15100e;color:#f3ece8;display:grid;place-items:center;height:100vh;margin:0"><div><h2 style="color:#ee6b2c">Drenix Assistant</h2><p>${
      code ? "Google connected. You can close this tab." : `Error: ${err ?? "no code"}`
    }</p></div></body>`,
  );
  if (code) void finish(code);
});
server.on("error", () => console.log("(local listener unavailable — paste the redirect URL instead)"));
// "::" is dual-stack: browsers may resolve localhost to ::1 (IPv6) or 127.0.0.1
server.listen({ port: PORT, host: "::", ipv6Only: false });

console.log("\n1) Open this link and sign in with drenixit@gmail.com:\n");
console.log(url);
console.log(
  '\n2) On "Google hasn\'t verified this app" choose Advanced → Go to Drenix Assistant → Continue.' +
    '\n   On the next screen TICK ALL checkboxes (Calendar, Sheets, Forms and form responses), then Continue.' +
    "\n3) If the browser then shows \"This site can't be reached\", copy the full address (http://localhost:53682/?code=...) and paste it below.\n",
);

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on("line", (line) => {
  const s = line.trim();
  if (!s) return;
  try {
    const code = s.startsWith("http") ? new URL(s).searchParams.get("code") : s;
    if (code) void finish(code);
    else console.log("No ?code= in that URL, try again.");
  } catch {
    console.log("That doesn't look like a URL, try again.");
  }
});
