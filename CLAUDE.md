# G2

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system architecture. See [docs/CHANNEL-MANAGEMENT.md](docs/CHANNEL-MANAGEMENT.md) for channel architecture. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions. See [docs/HEARTBEAT.md](docs/HEARTBEAT.md) for the polling loops and task scheduler.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

### Core
| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point: channel setup, `main()` bootstrap |
| `src/app.ts` | Orchestrator class: composes services, wires subsystems |
| `src/types.ts` | Barrel re-export of all domain types |

### Infrastructure (`src/infrastructure/`)
| File | Purpose |
|------|---------|
| `src/infrastructure/Config.ts` | Trigger pattern, paths, intervals, container settings, `TimeoutConfig`, `.env` parsing |
| `src/infrastructure/Database.ts` | Schema creation, migrations, `AppDatabase` composition root |
| `src/infrastructure/Logger.ts` | Pino logger singleton |
| `src/infrastructure/StateRepository.ts` | Router state (key-value) persistence |
| `src/infrastructure/poll-loop.ts` | Shared polling loop abstraction |
| `src/infrastructure/idle-timer.ts` | Shared idle timer utility |

### Messaging (`src/messaging/`)
| File | Purpose |
|------|---------|
| `src/messaging/types.ts` | `Channel`, `OnInboundMessage`, `OnChatMetadata`, `NewMessage` |
| `src/messaging/MessagePoller.ts` | Message polling, cursor management, trigger checking |
| `src/messaging/MessageFormatter.ts` | Message format transforms (XML encoding, internal tag stripping) |
| `src/messaging/MessageRepository.ts` | Message + chat metadata storage and retrieval |
| `src/messaging/ChannelRegistry.ts` | Registry pattern for multiple channels |
| `src/messaging/whatsapp/WhatsAppChannel.ts` | WhatsApp connection, auth, send/receive |
| `src/messaging/whatsapp/MetadataSync.ts` | WhatsApp group metadata syncing |
| `src/messaging/whatsapp/OutgoingMessageQueue.ts` | Rate-limited outbound message queue |

### Execution (`src/execution/`)
| File | Purpose |
|------|---------|
| `src/execution/AgentExecutor.ts` | Container execution, session tracking, snapshot writing |
| `src/execution/ContainerRunner.ts` | `ContainerRunner`: spawns agent containers, parses output |
| `src/execution/ContainerOutputParser.ts` | Stateful parser for OUTPUT_START/END marker protocol |
| `src/execution/ContainerRuntime.ts` | `IContainerRuntime` interface + `DockerRuntime` implementation |
| `src/execution/ExecutionQueue.ts` | Per-group queue with global concurrency limit |
| `src/execution/MountBuilder.ts` | `IMountFactory` interface + `DefaultMountFactory` implementation |
| `src/execution/MountSecurity.ts` | Mount allowlist validation for containers |

### Sessions (`src/sessions/`)
| File | Purpose |
|------|---------|
| `src/sessions/types.ts` | `ArchivedSession` |
| `src/sessions/SessionManager.ts` | Session + archive lifecycle (clear, resume, search), transcript formatting |
| `src/sessions/SessionRepository.ts` | Session + conversation archive persistence |

### Scheduling (`src/scheduling/`)
| File | Purpose |
|------|---------|
| `src/scheduling/types.ts` | `ScheduledTask`, `TaskRunLog` |
| `src/scheduling/TaskService.ts` | `TaskManager`: centralized task lifecycle (create, pause, resume, cancel) |
| `src/scheduling/TaskScheduler.ts` | Runs scheduled tasks via `TaskManager` |
| `src/scheduling/TaskRepository.ts` | Scheduled task CRUD, claiming, run logging |
| `src/scheduling/SnapshotWriter.ts` | Writes tasks, sessions, groups snapshots for containers |

### Groups (`src/groups/`)
| File | Purpose |
|------|---------|
| `src/groups/types.ts` | `RegisteredGroup`, `ContainerConfig`, `AdditionalMount`, `MountAllowlist`, `AllowedRoot` |
| `src/groups/Authorization.ts` | Fine-grained auth (`AuthorizationPolicy` class) |
| `src/groups/GroupPaths.ts` | Centralized path construction for group directories |
| `src/groups/GroupRepository.ts` | Registered group persistence |

### IPC (`src/ipc/`)
| File | Purpose |
|------|---------|
| `src/ipc/types.ts` | `IpcCommandHandler` interface |
| `src/ipc/IpcWatcher.ts` | `IpcWatcher`: fs.watch + fallback poll, dispatches IPC commands |
| `src/ipc/IpcDispatcher.ts` | Routes IPC commands to handlers, `BaseIpcHandler` base class |
| `src/ipc/IpcTransport.ts` | File-based IPC write operations |
| `src/ipc/handlers/TaskHandlers.ts` | `schedule_task`, `pause_task`, `resume_task`, `cancel_task` handlers |
| `src/ipc/handlers/SessionHandlers.ts` | `clear_session`, `resume_session`, `search_sessions`, `archive_session` handlers |
| `src/ipc/handlers/GroupHandlers.ts` | `register_group`, `refresh_groups` handlers |

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
