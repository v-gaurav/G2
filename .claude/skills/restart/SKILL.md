---
name: restart
description: Restart the G2 service. Builds TypeScript, restarts via the platform service manager (systemd on Linux, launchd on macOS), and verifies health. Optionally rebuilds the agent container. Triggers on "restart", "restart g2", "restart the agent", "reboot service".
---

# G2 Restart

Build and restart the G2 service. Handles both macOS (launchd) and Linux (systemd), kills rogue processes, and verifies health after restart.

## Default Restart

Run `./.claude/skills/restart/scripts/restart.sh` (Bash timeout: 60000ms) and parse the status block.

This will:
1. Build TypeScript (`npm run build`)
2. Restart the service via the platform service manager
3. Wait for startup and verify health

## With Container Rebuild

If the user asks to also rebuild the container (or if context suggests container changes were made), run with `--container`:

```bash
./.claude/skills/restart/scripts/restart.sh --container
```

## Skip Build

If the user explicitly says to skip the build (code hasn't changed), run with `--skip-build`:

```bash
./.claude/skills/restart/scripts/restart.sh --skip-build
```

## Handling Results

Parse the status block output:

- **BUILD_OK=false**: Read `logs/restart.log` for the TypeScript compilation error. Fix the error and re-run.
- **CONTAINER_REBUILD=false**: Read `logs/restart.log` for the container build error. Common fix: `docker builder prune -af` then re-run with `--container`.
- **SERVICE_OK=false**: The service failed to start.
  - On Linux: run `systemctl --user status g2` and read `logs/g2.error.log` for the crash reason.
  - On macOS: run `launchctl list | grep g2` and read `logs/g2.error.log`.
  - Common causes: missing `.env`, missing WhatsApp auth, wrong Node path. Fix and re-run.
- **HEALTHY=false but SERVICE_OK=true**: Service started but hasn't fully initialized. Tail `logs/g2.log` to check progress — WhatsApp connection may still be establishing. Wait a few seconds and re-check with `tail -5 logs/g2.log`.
- **HEALTHY=true**: Restart complete. Report the PID and confirm G2 is running.

## After Restart

Show the user a brief summary: PID, service type, and health status. If healthy, confirm G2 is running. If not, diagnose and fix.
