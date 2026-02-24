#!/bin/bash
set -euo pipefail

# 05-sync-groups.sh — Connect to WhatsApp, fetch group metadata, write to DB, exit.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
LOG_FILE="$PROJECT_ROOT/logs/setup.log"

mkdir -p "$PROJECT_ROOT/logs"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [sync-groups] $*" >> "$LOG_FILE"; }

cd "$PROJECT_ROOT"

# Build TypeScript
log "Building TypeScript"
BUILD="failed"
if npm run build >> "$LOG_FILE" 2>&1; then
  BUILD="success"
  log "Build succeeded"
else
  log "Build failed"
  cat <<EOF
=== G2 SETUP: SYNC_GROUPS ===
BUILD: failed
SYNC: skipped
GROUPS_IN_DB: 0
STATUS: failed
ERROR: build_failed
LOG: logs/setup.log
=== END ===
EOF
  exit 1
fi

# Directly connect, fetch groups, write to DB, exit
log "Fetching group metadata directly"
SYNC="failed"

SYNC_OUTPUT=$(node -e "
import makeWASocket, { useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

const logger = pino({ level: 'silent' });
const authDir = path.join('store', 'auth');
const dbPath = path.join('store', 'messages.db');

if (!fs.existsSync(authDir)) {
  console.error('NO_AUTH');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(\`CREATE TABLE IF NOT EXISTS chats (
  jid TEXT PRIMARY KEY,
  name TEXT,
  last_message_time TEXT,
  channel TEXT,
  is_group INTEGER DEFAULT 0
)\`);

const upsert = db.prepare(
  'INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?) ON CONFLICT(jid) DO UPDATE SET name = excluded.name'
);

const { state, saveCreds } = await useMultiFileAuthState(authDir);

const sock = makeWASocket({
  auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
  printQRInTerminal: false,
  logger,
  browser: Browsers.macOS('Chrome'),
});

// Timeout after 30s
const timeout = setTimeout(() => {
  console.error('TIMEOUT');
  process.exit(1);
}, 30000);

sock.ev.on('creds.update', saveCreds);

sock.ev.on('connection.update', async (update) => {
  if (update.connection === 'open') {
    try {
      const groups = await sock.groupFetchAllParticipating();
      const now = new Date().toISOString();
      let count = 0;
      for (const [jid, metadata] of Object.entries(groups)) {
        if (metadata.subject) {
          upsert.run(jid, metadata.subject, now, 'whatsapp', jid.endsWith('@g.us') ? 1 : 0);
          count++;
        }
      }
      console.log('SYNCED:' + count);
    } catch (err) {
      console.error('FETCH_ERROR:' + err.message);
    } finally {
      clearTimeout(timeout);
      sock.end(undefined);
      db.close();
      process.exit(0);
    }
  } else if (update.connection === 'close') {
    clearTimeout(timeout);
    console.error('CONNECTION_CLOSED');
    process.exit(1);
  }
});
" --input-type=module 2>&1) || true

log "Sync output: $SYNC_OUTPUT"

if echo "$SYNC_OUTPUT" | grep -q "SYNCED:"; then
  SYNC="success"
fi

# Check for groups in DB
GROUPS_IN_DB=0
if [ -f "$PROJECT_ROOT/store/messages.db" ]; then
  GROUPS_IN_DB=$(node --no-warnings -e 'const db=require("better-sqlite3")("./store/messages.db");try{console.log(db.prepare("SELECT COUNT(*) as cnt FROM chats WHERE jid LIKE \"%@g.us\" AND jid <> \"__group_sync__\"").get().cnt)}catch{console.log(0)}' 2>/dev/null || echo "0")
  log "Groups found in DB: $GROUPS_IN_DB"
fi

STATUS="success"
if [ "$SYNC" != "success" ]; then
  STATUS="failed"
fi

cat <<EOF
=== G2 SETUP: SYNC_GROUPS ===
BUILD: $BUILD
SYNC: $SYNC
GROUPS_IN_DB: $GROUPS_IN_DB
STATUS: $STATUS
LOG: logs/setup.log
=== END ===
EOF

if [ "$STATUS" = "failed" ]; then
  exit 1
fi
