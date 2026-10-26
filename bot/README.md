# Drenix Assistant bot

One Telegram bot (`@drenix_job_app_bot`) with two jobs:

1. **Job requests** — the website form (`structure.drenix.uz`, "Need worker") posts to this bot; the bot sends the request to the *Jobs needed* group, notifies HR and creates a task.
2. **HR AI assistant** for Daniel (private chat): tasks from plain text/voice (uz/ru/en mixed), planning, Google Calendar + Meet, the recruiting Google Sheet (read/search/update rows), candidate interviews, reminders, shift briefing/review, reports (text + PDF).

Runs as a single Node.js process (~100–150 MB RAM). No Redis, no separate database server: SQLite file in `data/`.

## How it fits together

```
structure.drenix.uz (Vercel) ──HTTPS + secret──► bot.drenix.uz (nginx) ──► 127.0.0.1:4000  ┐
                                                                                            ├─ bot process (PM2)
Telegram  ◄──────────── long polling (outgoing only) ──────────────────────────────────────┘      │
Google Calendar API ◄──────────────────────────────────────────────────────────────────────────────┤
OpenAI API ◄───────────────────────────────────────────────────────────────────────────────────────┘
```

If the bot is down, the website falls back to posting straight to the Telegram group, so job requests are never lost.

## Workday model

All times are Asia/Tashkent. A workday is the overnight shift **17:00 → 02:00** and is named by the date it starts (00:00–02:00 belongs to the previous date). Sunday 02:00 → Monday 17:00 is off. Briefing 16:45, review 01:30. All configurable in `.env`.

## Local development

```bash
cd bot
npm install
cp .env.example .env        # fill in
npm run google:auth         # once: connect drenixit@gmail.com (Calendar + Sheets + Forms; tick all checkboxes)
npm run dev                 # bot + scheduler + HTTP bridge (watch mode)
npm run chat                # talk to the AI in the console (fake chat, nothing sent to Telegram)
```

Only one process may poll a bot token at a time. When the production bot is running on the server, use a separate test bot token locally.

## Deploy on the office server (Ubuntu + PM2)

Requirements: Node.js ≥ 22 (24 LTS recommended), build tools for `better-sqlite3` (`build-essential python3`), PM2, nginx, certbot. The office router forwards TCP 80/443 from `93.188.81.14` to the server, and DNS has `A bot → 93.188.81.14`. Only the bot runs on the server; the website stays on Vercel (`.vercelignore` keeps `bot/` out of the Vercel build).

```bash
# 0. once: system packages
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3 nginx certbot python3-certbot-nginx sqlite3
sudo npm i -g pm2

# 1. code (npm ≥ 11 runs only the install scripts listed in package.json "allowScripts")
git clone <repo> drenix && cd drenix/bot
npm ci
npm run build

# 2. config + data
cp .env.example .env && nano .env      # same values as local (keep ENCRYPTION_KEY identical!)
mkdir -p data/logs
#   Stop the local bot first (one token = one poller), then copy .env and data/assistant.db from
#   the local machine (keeps the Google connection and all tasks/meetings/forms):
#     scp bot/.env bot/data/assistant.db <user>@<server>:~/drenix/bot/   (assistant.db → data/)
#   Either copy data/assistant.db from the local machine (keeps the Google connection),
#   or connect Google again on the server:
#   npm run google:auth:prod  → open the link on your PC, after "Allow" copy the
#   http://localhost:53682/?code=... address from the browser and paste it into the terminal.

# 3. run
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs drenix-assistant

# 4. HTTPS for the website bridge
sudo cp deploy/nginx-bot.drenix.uz.conf /etc/nginx/sites-available/bot.drenix.uz
sudo ln -s /etc/nginx/sites-available/bot.drenix.uz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d bot.drenix.uz
curl https://bot.drenix.uz/health     # → {"ok":true}

# 5. daily backup
crontab -e   # add:  0 12 * * * /home/<user>/drenix/bot/deploy/backup.sh
```

Then in **Vercel → Project → Settings → Environment Variables** add and redeploy:

| Name | Value |
|---|---|
| `BOT_API_URL` | `https://bot.drenix.uz` |
| `BOT_API_SECRET` | same as `BOT_API_SECRET` in `bot/.env` |
| `TELEGRAM_BOT_TOKEN` | the (new) bot token — used only as fallback |
| `TELEGRAM_CHAT_ID` | `-1004453168262` |

Updating: `git pull && npm ci && npm run build && pm2 restart drenix-assistant`.

## Using the bot

- **Daniel**: open the bot, `/start`, choose a language. Then just write or send voice notes. Commands: `/today`, `/report`, `/lang`, `/google`.
- **Candidates**: Daniel asks e.g. *"@ali ga bo'sh vaqtga 45 daqiqalik onlayn interview belgila"* → confirms the preview → forwards the invite link. The candidate opens it, picks a language and one of 5 free slots (next 3 workdays) → Daniel approves → Calendar event + Meet link (+ email invite if an email was given) → reminders 1 day and 1 hour before → after the interview the bot asks for the outcome. On rejection the candidate gets a polite message, the chat is cleaned (Telegram only allows deleting messages younger than 48 h) and the link stops working.
- Nothing is sent to a candidate without Daniel pressing a button.
- **Recruiting sheet** (`GOOGLE_SHEET_URL`): questions about applicants, CV links, `show_applicants` lists with `#row` numbers, rejections in the sheet's own style ("Rejected by Daniel" + reason), any cell change. Every write to the sheet is shown as a preview and happens only after ✅; a cell that changed in the meantime is not overwritten. "Dashboard" → text + PDF built from all tabs (funnel, positions, sources, rejection reasons, retention, open vacancies, expenses). Daily/weekly/monthly reports include a recruiting block.
- **Google Forms** (no Apps Script needed — the Forms API does everything): "frontend kandidatlariga savol yarat" → the AI writes 8–12 questions (+ name/phone) → preview with ✅ → the form is created, published, and the candidate link + edit link are sent. New responses are announced (checked every 5 min, forms of the last 60 days). "Javoblar bo'yicha hisobot" → summary in chat + files: PDF and Word (charts per question, AI themes of open answers, AI score per candidate based only on the answers, recommendations, all answers) and Excel (raw responses + AI score, per-question stats, AI summary). Contact answers are never sent to OpenAI. Requires the **Google Forms API** enabled in the Cloud project and `npm run google:auth` again (tick the Forms checkboxes).
- Meetings: several times in one message create several Meet links; "remind me 5 minutes before" sets only that reminder for those meetings.
- Model: `OPENAI_MODEL=gpt-5.4` with `OPENAI_REASONING=none` (gpt-4.1-mini followed the sheet rules poorly in tests).
- `npm run chat` prints everything the tools would send to Telegram and saves PDFs to `data/chat-out/` instead of sending.

## Files

| Path | What |
|---|---|
| `src/index.ts` | entry: bot, HTTP bridge, scheduler |
| `src/handlers.ts` | Telegram commands, messages, buttons |
| `src/ai/` | OpenAI agent, system prompt, tool schemas, voice transcription |
| `src/services/tasks.ts` | tasks, statuses, history, recurrence, dependencies |
| `src/services/meetings.ts` | Calendar events, free slots, reminders, calendar sync |
| `src/services/candidates.ts` | interview invitation flow |
| `src/services/jobs.ts` | job requests from the website |
| `src/services/reports.ts` | daily/weekly/monthly stats, text + PDF |
| `src/services/forms.ts`, `formReport.ts` | Google Forms: drafts + ✅, new-response alerts; analytics → PDF / Word / Excel |
| `src/services/scheduler.ts` | reminders, briefing, review, follow-ups (30 s loop) |
| `src/google/` | Calendar + Sheets + Forms REST clients, one-time OAuth CLI |
| `src/db.ts` | SQLite schema + migrations |
| `deploy/` | nginx config, backup script |
