#!/usr/bin/env bash
# Daily SQLite backup (keeps 14 days). Cron: 0 12 * * * /path/to/bot/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/backups
sqlite3 data/assistant.db ".backup 'data/backups/assistant-$(date +%F).db'" 2>/dev/null \
  || node -e "require('better-sqlite3')('data/assistant.db').backup('data/backups/assistant-$(date +%F).db').then(()=>process.exit(0))"
find data/backups -name 'assistant-*.db' -mtime +14 -delete
