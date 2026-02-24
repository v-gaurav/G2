# G2

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system architecture. See [docs/CHANNEL-MANAGEMENT.md](docs/CHANNEL-MANAGEMENT.md) for channel architecture. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions. See [docs/HEARTBEAT.md](docs/HEARTBEAT.md) for the polling loops and task scheduler.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

### Core
| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point: channel setup, `main()` bootstrap |
| `src/orchestrator.ts` | Orchestrator class: composes services, wires subsystems |
| `src/message-processor.ts` | Message polling, cursor management, trigger checking |
| `src/agent-executor.ts` | Container execution, session tracking, snapshot writing |
| `src/types.ts` | Central type definitions (`Channel`, `RegisteredGroup`, `NewMessage`, etc.) |
| `src/config.ts` | Trigger pattern, paths, intervals, container settings, `TimeoutConfig` |
| `src/logger.ts` | Pino logger singleton |
| `src/db.ts` | Thin composition root delegating to domain repositories |

### Repositories (`src/repositories/`)
| File | Purpose |
|------|---------|
| `src/repositories/schema.ts` | Schema creation, migrations, DB init logic |
| `src/repositories/chat-repository.ts` | Chat metadata CRUD |
| `src/repositories/message-repository.ts` | Message storage and retrieval |
| `src/repositories/task-repository.ts` | Scheduled task CRUD, claiming, run logging |
| `src/repositories/session-repository.ts` | Agent session persistence |
| `src/repositories/archive-repository.ts` | Conversation archive storage and search |
| `src/repositories/group-repository.ts` | Registered group persistence |
| `src/repositories/state-repository.ts` | Router state (key-value) persistence |

### Channels & Routing
| File | Purpose |
|------|---------|
| `src/channels/whatsapp.ts` | WhatsApp connection, auth, send/receive |
| `src/channels/whatsapp-metadata-sync.ts` | WhatsApp group metadata syncing |
| `src/channels/outgoing-message-queue.ts` | Rate-limited outbound message queue |
| `src/channel-registry.ts` | Registry pattern for multiple channels |
| `src/message-formatter.ts` | Message format transforms (XML encoding, internal tag stripping) |
| `src/router.ts` | Backward-compatible re-exports (delegates to message-formatter) |

### Container & Execution
| File | Purpose |
|------|---------|
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/container-runtime.ts` | Docker runtime abstraction |
| `src/group-queue.ts` | Per-group queue with global concurrency limit |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/session-manager.ts` | Claude Agent SDK session management per group |
| `src/group-paths.ts` | Centralized path construction for group directories |
| `src/poll-loop.ts` | Shared polling loop abstraction |
| `src/idle-timer.ts` | Shared idle timer utility |
| `src/ipc-transport.ts` | File-based IPC write operations |
| `src/task-snapshots.ts` | Task snapshot writing for containers |

### IPC Handlers (`src/ipc-handlers/`)
| File | Purpose |
|------|---------|
| `src/ipc.ts` | IPC watcher (fs.watch + fallback poll) and task processing |
| `src/ipc-handlers/index.ts` | Exports all handlers |
| `src/ipc-handlers/types.ts` | `IpcCommandHandler` interface |
| `src/ipc-handlers/dispatcher.ts` | Routes IPC commands to handlers |
| `src/ipc-handlers/schedule-task.ts` | Handle `schedule_task` IPC command |
| `src/ipc-handlers/register-group.ts` | Handle `register_group` IPC command |
| `src/ipc-handlers/pause-task.ts` | Handle `pause_task` IPC command |
| `src/ipc-handlers/resume-task.ts` | Handle `resume_task` IPC command |
| `src/ipc-handlers/cancel-task.ts` | Handle `cancel_task` IPC command |
| `src/ipc-handlers/clear-session.ts` | Handle `clear_session` IPC command |
| `src/ipc-handlers/resume-session.ts` | Handle `resume_session` IPC command |
| `src/ipc-handlers/search-sessions.ts` | Handle `search_sessions` IPC command (round-trip) |
| `src/ipc-handlers/archive-session.ts` | Handle `archive_session` IPC command (PreCompact) |
| `src/ipc-handlers/archive-utils.ts` | Shared transcript parsing and formatting |
| `src/ipc-handlers/refresh-groups.ts` | Handle `refresh_groups` IPC command |
| `src/ipc-handlers/base-handler.ts` | Base class for IPC handlers (validation, context) |
| `src/ipc-handlers/task-helpers.ts` | Shared task lookup and authorization helper |

### Interfaces (`src/interfaces/`)
| File | Purpose |
|------|---------|
| `src/interfaces/index.ts` | Exports all interfaces and implementations |
| `src/interfaces/container-runtime.ts` | `IContainerRuntime` interface |
| `src/interfaces/docker-runtime.ts` | Docker implementation of `IContainerRuntime` |
| `src/interfaces/mount-factory.ts` | `IMountFactory` interface |
| `src/interfaces/default-mount-factory.ts` | Default mount builder (group/main-aware) |
| `src/interfaces/message-store.ts` | `IMessageStore` interface |
| `src/interfaces/sqlite-message-store.ts` | SQLite implementation of `IMessageStore` |

### Security & Validation
| File | Purpose |
|------|---------|
| `src/authorization.ts` | Fine-grained auth (`AuthorizationPolicy` class) |
| `src/mount-security.ts` | Mount allowlist validation for containers |
| `src/trigger-validator.ts` | Trigger pattern matching for non-main groups |
| `src/env.ts` | Secure `.env` file parsing |

### Utilities
| File | Purpose |
|------|---------|
| `src/safe-parse.ts` | Safe JSON parsing (returns null on failure) |

### Other
| File | Purpose |
|------|---------|
| `src/whatsapp-auth.ts` | Standalone WhatsApp authentication |
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
