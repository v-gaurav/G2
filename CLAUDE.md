# G2

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

### Core
| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/types.ts` | Central type definitions (`Channel`, `RegisteredGroup`, `NewMessage`, etc.) |
| `src/config.ts` | Trigger pattern, paths, intervals, container settings |
| `src/logger.ts` | Pino logger singleton |
| `src/db.ts` | SQLite operations (messages, groups, sessions, tasks, state) |

### Channels & Routing
| File | Purpose |
|------|---------|
| `src/channels/whatsapp.ts` | WhatsApp connection, auth, send/receive |
| `src/channels/whatsapp-metadata-sync.ts` | WhatsApp group metadata syncing |
| `src/channels/outgoing-message-queue.ts` | Rate-limited outbound message queue |
| `src/channel-registry.ts` | Registry pattern for multiple channels |
| `src/router.ts` | Message formatting and outbound routing |

### Container & Execution
| File | Purpose |
|------|---------|
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/container-runtime.ts` | Docker runtime abstraction |
| `src/group-queue.ts` | Per-group queue with global concurrency limit |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/session-manager.ts` | Claude Agent SDK session management per group |

### IPC Handlers (`src/ipc-handlers/`)
| File | Purpose |
|------|---------|
| `src/ipc.ts` | IPC watcher and task processing |
| `src/ipc-handlers/dispatcher.ts` | Routes IPC commands to handlers |
| `src/ipc-handlers/schedule-task.ts` | Handle `schedule_task` IPC command |
| `src/ipc-handlers/register-group.ts` | Handle `register_group` IPC command |
| `src/ipc-handlers/pause-task.ts` | Handle `pause_task` IPC command |
| `src/ipc-handlers/resume-task.ts` | Handle `resume_task` IPC command |
| `src/ipc-handlers/cancel-task.ts` | Handle `cancel_task` IPC command |
| `src/ipc-handlers/clear-session.ts` | Handle `clear_session` IPC command |
| `src/ipc-handlers/resume-session.ts` | Handle `resume_session` IPC command |
| `src/ipc-handlers/refresh-groups.ts` | Handle `refresh_groups` IPC command |

### Interfaces (`src/interfaces/`)
| File | Purpose |
|------|---------|
| `src/interfaces/container-runtime.ts` | `IContainerRuntime` interface |
| `src/interfaces/docker-runtime.ts` | Docker implementation of `IContainerRuntime` |
| `src/interfaces/mount-factory.ts` | `IMountFactory` interface |
| `src/interfaces/default-mount-factory.ts` | Default mount builder (group/main-aware) |
| `src/interfaces/message-store.ts` | `IMessageStore` interface |
| `src/interfaces/sqlite-message-store.ts` | SQLite implementation of `IMessageStore` |

### Security & Validation
| File | Purpose |
|------|---------|
| `src/authorization.ts` | Fine-grained auth (`canSendMessage`, `canScheduleTask`, etc.) |
| `src/mount-security.ts` | Mount allowlist validation for containers |
| `src/trigger-validator.ts` | Trigger pattern matching for non-main groups |
| `src/timeout-config.ts` | Container timeout configuration |
| `src/env.ts` | Secure `.env` file parsing |

### Other
| File | Purpose |
|------|---------|
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser/SKILL.md` | Browser automation skill (available to all agents) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/sync-docs` | After major refactoring — sync all docs with actual codebase structure |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
launchctl load ~/Library/LaunchAgents/com.g2.plist
launchctl unload ~/Library/LaunchAgents/com.g2.plist
```

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
