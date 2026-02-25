#!/bin/bash
set -euo pipefail

# restart.sh — Build and restart the G2 service
# Detects platform (macOS/Linux) and uses the appropriate service manager.
# Optionally rebuilds the agent container with --container flag.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
LOG_FILE="$PROJECT_ROOT/logs/restart.log"

mkdir -p "$PROJECT_ROOT/logs"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [restart] $*" >> "$LOG_FILE"; }

cd "$PROJECT_ROOT"

# Parse args
REBUILD_CONTAINER=false
SKIP_BUILD=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --container) REBUILD_CONTAINER=true; shift ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    *) shift ;;
  esac
done

# Detect platform
case "$(uname -s)" in
  Darwin*) PLATFORM="macos" ;;
  Linux*)  PLATFORM="linux" ;;
  *)       PLATFORM="unknown" ;;
esac

log "Starting restart: platform=$PLATFORM container=$REBUILD_CONTAINER skip_build=$SKIP_BUILD"

# Step 1: Build TypeScript
BUILD_OK=true
if [ "$SKIP_BUILD" = false ]; then
  log "Building TypeScript"
  if npm run build >> "$LOG_FILE" 2>&1; then
    log "Build succeeded"
  else
    BUILD_OK=false
    log "Build failed"
  fi
else
  log "Skipping TypeScript build"
fi

# Step 2: Rebuild container (optional)
CONTAINER_OK="skipped"
if [ "$REBUILD_CONTAINER" = true ]; then
  log "Rebuilding agent container"
  if [ -f "$PROJECT_ROOT/container/build.sh" ]; then
    if "$PROJECT_ROOT/container/build.sh" >> "$LOG_FILE" 2>&1; then
      CONTAINER_OK="true"
      log "Container rebuild succeeded"
    else
      CONTAINER_OK="false"
      log "Container rebuild failed"
    fi
  else
    CONTAINER_OK="false"
    log "container/build.sh not found"
  fi
fi

# Step 3: Restart service
SERVICE_OK=false
SERVICE_TYPE="unknown"
PID=""

case "$PLATFORM" in
  macos)
    SERVICE_TYPE="launchd"
    log "Restarting via launchctl"
    if launchctl kickstart -k "gui/$(id -u)/com.g2" >> "$LOG_FILE" 2>&1; then
      sleep 2
      if launchctl list 2>/dev/null | grep -q "com.g2"; then
        SERVICE_OK=true
        PID=$(launchctl list 2>/dev/null | grep "com.g2" | awk '{print $1}')
        log "Service restarted: PID=$PID"
      else
        log "Service not found after kickstart"
      fi
    else
      log "kickstart failed, trying unload/load"
      PLIST="$HOME/Library/LaunchAgents/com.g2.plist"
      launchctl unload "$PLIST" >> "$LOG_FILE" 2>&1 || true
      sleep 1
      if launchctl load "$PLIST" >> "$LOG_FILE" 2>&1; then
        sleep 2
        if launchctl list 2>/dev/null | grep -q "com.g2"; then
          SERVICE_OK=true
          PID=$(launchctl list 2>/dev/null | grep "com.g2" | awk '{print $1}')
          log "Service restarted via unload/load: PID=$PID"
        fi
      fi
    fi
    ;;

  linux)
    SERVICE_TYPE="systemd"
    log "Restarting via systemctl"

    # Kill any rogue tsx/node processes running G2 outside of systemd
    ROGUE_PIDS=$(pgrep -f "tsx src/index.ts|node.*dist/index.js" 2>/dev/null || true)
    SYSTEMD_PID=$(systemctl --user show g2 --property=MainPID --value 2>/dev/null || echo "0")
    for rpid in $ROGUE_PIDS; do
      if [ "$rpid" != "$SYSTEMD_PID" ] && [ "$rpid" != "0" ]; then
        log "Killing rogue G2 process: $rpid"
        kill "$rpid" >> "$LOG_FILE" 2>&1 || true
      fi
    done

    systemctl --user daemon-reload >> "$LOG_FILE" 2>&1 || true
    if systemctl --user restart g2 >> "$LOG_FILE" 2>&1; then
      sleep 3
      if systemctl --user is-active g2 >/dev/null 2>&1; then
        SERVICE_OK=true
        PID=$(systemctl --user show g2 --property=MainPID --value 2>/dev/null || echo "unknown")
        log "Service restarted: PID=$PID"
      else
        log "Service not active after restart"
      fi
    else
      log "systemctl restart failed"
    fi
    ;;

  *)
    log "Unsupported platform: $PLATFORM"
    ;;
esac

# Step 4: Verify health (check logs for startup indicators)
HEALTHY=false
if [ "$SERVICE_OK" = true ]; then
  sleep 5
  if tail -20 "$PROJECT_ROOT/logs/g2.log" 2>/dev/null | grep -q "G2 running"; then
    HEALTHY=true
    log "Health check passed"
  else
    log "Health check: 'G2 running' not found in recent logs"
  fi
fi

# Output status block
cat <<EOF
=== G2 RESTART ===
PLATFORM: $PLATFORM
SERVICE_TYPE: $SERVICE_TYPE
BUILD_OK: $BUILD_OK
CONTAINER_REBUILD: $CONTAINER_OK
SERVICE_OK: $SERVICE_OK
PID: ${PID:-none}
HEALTHY: $HEALTHY
LOG: logs/restart.log
=== END ===
EOF
