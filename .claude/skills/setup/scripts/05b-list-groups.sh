#!/bin/bash
set -euo pipefail

# 05b-list-groups.sh — Query WhatsApp groups from the database.
# Output: pipe-separated JID|name lines, most recent first.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
DB_PATH="$PROJECT_ROOT/store/messages.db"

LIMIT="${1:-30}"

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: database not found" >&2
  exit 1
fi

cd "$PROJECT_ROOT"

node --no-warnings -e "
const db = require('better-sqlite3')('$DB_PATH');
const rows = db.prepare(
  \"SELECT jid, name FROM chats WHERE jid LIKE '%@g.us' AND jid <> '__group_sync__' AND name <> jid ORDER BY last_message_time DESC LIMIT ?\"
).all($LIMIT);
for (const r of rows) console.log(r.jid + '|' + r.name);
db.close();
"
