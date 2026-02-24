# G2 Specification

A personal Claude assistant accessible via WhatsApp (and other channels), with persistent memory per conversation, scheduled tasks, container-isolated execution, and a security-first design.

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Architecture](#architecture)
3. [Design Principles](#design-principles)
4. [Folder Structure](#folder-structure)
5. [Configuration](#configuration)
6. [Channel System](#channel-system)
7. [Memory System](#memory-system)
8. [Session Management](#session-management)
9. [Message Flow](#message-flow)
10. [Container Lifecycle](#container-lifecycle)
11. [Execution Queue](#execution-queue)
12. [Commands](#commands)
13. [Scheduled Tasks](#scheduled-tasks)
14. [IPC System](#ipc-system)
15. [MCP Servers](#mcp-servers)
16. [Skills System](#skills-system)
17. [Security Model](#security-model)
18. [Polling Loops and Heartbeats](#polling-loops-and-heartbeats)
19. [Database Schema](#database-schema)
20. [Deployment](#deployment)
21. [Troubleshooting](#troubleshooting)

---

## Philosophy

G2 is a personal AI assistant that lives in your WhatsApp. It is designed around the following principles:

- **Privacy-first**: All data stays on your machine. No third-party servers beyond the Claude API.
- **Always available**: Runs as a persistent service, responds when mentioned.
- **Persistent memory**: Remembers context across conversations via CLAUDE.md files.
- **Full agent capabilities**: Can browse the web, read/write files, run code, and schedule tasks.
- **Container isolation**: Every agent invocation runs in a sandboxed Linux VM.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HOST (macOS / Linux)                          │
│                   (Main Node.js Process)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐                     ┌────────────────────┐        │
│  │  Channels    │────────────────────▶│   SQLite Database  │        │
│  │  (WA/TG/DC) │◀────────────────────│   (messages.db)    │        │
│  └──────────────┘   store/send        └─────────┬──────────┘        │
│                                                  │                   │
│         ┌────────────────────────────────────────┘                   │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  Message Loop    │    │  Scheduler Loop  │    │  IPC Watcher  │  │
│  │  (polls SQLite)  │    │  (checks tasks)  │    │  (file-based) │  │
│  └────────┬─────────┘    └────────┬─────────┘    └───────────────┘  │
│           │                       │                                  │
│           └───────────┬───────────┘                                  │
│                       │ spawns container                             │
│                       ▼                                              │
├─────────────────────────────────────────────────────────────────────┤
│                     CONTAINER (Linux VM)                              │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    AGENT RUNNER                               │   │
│  │                                                                │   │
│  │  Working directory: /workspace/group (mounted from host)       │   │
│  │  Volume mounts:                                                │   │
│  │    • groups/{name}/ → /workspace/group                         │   │
│  │    • groups/global/ → /workspace/global/ (non-main only)        │   │
│  │    • data/sessions/{group}/.claude/ → /home/node/.claude/      │   │
│  │    • Additional dirs → /workspace/extra/*                      │   │
│  │                                                                │   │
│  │  Tools (all groups):                                           │   │
│  │    • Bash (safe - sandboxed in container!)                     │   │
│  │    • Read, Write, Edit, Glob, Grep (file operations)           │   │
│  │    • WebSearch, WebFetch (internet access)                     │   │
│  │    • agent-browser (browser automation)                        │   │
│  │    • mcp__g2__* (scheduler tools via IPC)                │   │
│  │                                                                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| WhatsApp Connection | Node.js (@whiskeysockets/baileys) | Connect to WhatsApp, send/receive messages |
| Message Storage | SQLite (better-sqlite3) | Store messages for polling |
| Container Runtime | Containers (Linux VMs) | Isolated environments for agent execution |
| Agent | @anthropic-ai/claude-agent-sdk (0.2.29) | Run Claude with tools and MCP servers |
| Browser Automation | agent-browser + Chromium | Web interaction and screenshots |
| Runtime | Node.js 20+ | Host process for routing and scheduling |
| IPC | File-based JSON | Host-to-container communication |
| Scheduling | Custom cron/interval engine | Task scheduling and execution |
| Logging | Pino | Structured JSON logging |
| Session Storage | JSONL files | Claude Agent SDK transcript persistence |

### Prerequisites

- Node.js 20+
- Docker or Apple Containers
- WhatsApp account
- Claude authentication (OAuth token or API key)
- macOS or Linux

---

## Design Principles

The codebase follows four core design principles:

1. **Composition over inheritance** — The `App` class composes services rather than using class hierarchies. All subsystems are standalone services wired together at the composition root.

2. **Dependency injection via constructor** — All services receive their dependencies explicitly through constructor parameters. No global singletons or service locators.

3. **SQLite as single source of truth** — No in-memory state that cannot be reconstructed from the database. All persistent state (groups, sessions, tasks, messages) lives in SQLite.

4. **Poll, don't push** — Polling loops instead of event-driven architecture for reliability. Simpler recovery, no lost events, predictable resource usage. The trade-off is slight latency.

### App Composition Root

The `App` class in `src/app.ts` is the composition root for the entire application:

- Constructs all repositories, services, and subsystems
- Wiring order matters: Database -> Repositories -> Services -> Subsystems
- `start()` initializes subsystems in dependency order
- `stop()` tears down in reverse order (graceful shutdown)

---

## Folder Structure

```
g2/
├── CLAUDE.md                      # Project context for Claude Code
├── docs/
│   ├── SPEC.md                    # This specification document
│   ├── ARCHITECTURE.md            # System architecture
│   ├── REQUIREMENTS.md            # Architecture decisions
│   ├── HEARTBEAT.md               # Polling loops and task scheduler
│   ├── SECURITY.md                # Security model
│   ├── CHANNEL-MANAGEMENT.md      # Channel architecture
│   ├── MEMORY.md                  # Memory system details
│   ├── SDK_DEEP_DIVE.md           # Claude Agent SDK internals
│   ├── DEBUG_CHECKLIST.md         # Debugging guide
│   ├── SKILLS-ARCHITECTURE.md     # Skills system
│   └── APPLE-CONTAINER-NETWORKING.md # Apple container runtime
├── README.md                      # User documentation
├── package.json                   # Node.js dependencies
├── tsconfig.json                  # TypeScript configuration
├── .mcp.json                      # MCP server configuration (reference)
├── .gitignore
│
├── src/
│   ├── index.ts                   # Entry point: channel setup, main() bootstrap
│   ├── app.ts                     # App class: composes services, wires subsystems
│   ├── types.ts                   # TypeScript interfaces (Channel, RegisteredGroup, NewMessage, etc.)
│   ├── whatsapp-auth.ts           # Standalone WhatsApp authentication
│   ├── execution/                 # Container execution and isolation
│   │   ├── AgentExecutor.ts       # Container execution, session tracking, snapshot writing
│   │   ├── ContainerOutputParser.ts # Stateful parser for OUTPUT_START/END marker protocol
│   │   ├── ContainerRunner.ts     # Spawns agents in containers
│   │   ├── ContainerRuntime.ts    # IContainerRuntime interface and Docker implementation
│   │   ├── ExecutionQueue.ts      # Per-group queue with global concurrency limit
│   │   ├── MountBuilder.ts        # IMountFactory interface and default mount builder
│   │   └── MountSecurity.ts       # Mount allowlist validation for containers
│   ├── groups/                    # Group management
│   │   ├── types.ts               # Group-related types
│   │   ├── Authorization.ts       # Fine-grained IPC auth (AuthorizationPolicy class)
│   │   ├── GroupPaths.ts          # Centralized path construction for group directories
│   │   └── GroupRepository.ts     # Registered group persistence
│   ├── infrastructure/            # Shared infrastructure
│   │   ├── Config.ts              # Configuration constants, TimeoutConfig, secure .env parsing
│   │   ├── Database.ts            # Schema, migrations, DB init logic
│   │   ├── Logger.ts              # Pino logger setup
│   │   ├── StateRepository.ts     # Router state (key-value) persistence
│   │   ├── idle-timer.ts          # Shared idle timer utility
│   │   └── poll-loop.ts           # Shared polling loop abstraction
│   ├── ipc/                       # IPC communication
│   │   ├── types.ts               # IpcCommandHandler interface
│   │   ├── IpcDispatcher.ts       # Routes IPC commands to handlers, base handler logic
│   │   ├── IpcTransport.ts        # File-based IPC write operations
│   │   ├── IpcWatcher.ts          # IPC watcher (fs.watch + fallback poll)
│   │   └── handlers/              # Consolidated IPC command handlers
│   │       ├── GroupHandlers.ts   # Handle register_group, refresh_groups commands
│   │       ├── SessionHandlers.ts # Handle clear/resume/search/archive session commands
│   │       └── TaskHandlers.ts    # Handle schedule/pause/resume/cancel task commands
│   ├── messaging/                 # Message routing and formatting
│   │   ├── types.ts               # Messaging-related types
│   │   ├── ChannelRegistry.ts     # Registry pattern for multiple channels
│   │   ├── MessageFormatter.ts    # Message format transforms (XML encoding, internal tag stripping)
│   │   ├── MessagePoller.ts       # Message polling, cursor management, trigger checking
│   │   ├── MessageRepository.ts   # Chat metadata and message storage/retrieval
│   │   └── whatsapp/              # WhatsApp channel implementation
│   │       ├── MetadataSync.ts    # WhatsApp group metadata syncing
│   │       ├── OutgoingMessageQueue.ts # Rate-limited outbound message queue
│   │       └── WhatsAppChannel.ts # WhatsApp connection, auth, send/receive
│   ├── scheduling/                # Task scheduling
│   │   ├── types.ts               # Scheduling-related types
│   │   ├── SnapshotWriter.ts      # Task snapshot writing for containers
│   │   ├── TaskRepository.ts      # Scheduled task CRUD, claiming, run logging
│   │   ├── TaskScheduler.ts       # Runs scheduled tasks when due
│   │   └── TaskService.ts         # Centralized task lifecycle management
│   └── sessions/                  # Session management
│       ├── types.ts               # Session-related types
│       ├── SessionManager.ts      # Claude Agent SDK session management per group
│       └── SessionRepository.ts   # Agent session + conversation archive persistence
│
│
├── container/
│   ├── Dockerfile                 # Container image (runs as 'node' user, includes Claude Code CLI)
│   ├── build.sh                   # Build script for container image
│   ├── agent-runner/              # Code that runs inside the container
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts           # Entry point (query loop, IPC polling, session resume)
│   │       └── ipc-mcp-stdio.ts   # Stdio-based MCP server for host communication
│   └── skills/
│       └── agent-browser/
│           └── SKILL.md           # Browser automation skill
│
├── dist/                          # Compiled JavaScript (gitignored)
│
├── .claude/
│   └── skills/
│       ├── setup/SKILL.md              # /setup - First-time installation
│       ├── customize/SKILL.md          # /customize - Add capabilities
│       ├── debug/SKILL.md              # /debug - Container debugging
│       ├── add-telegram/SKILL.md       # /add-telegram - Telegram channel
│       ├── add-telegram-swarm/SKILL.md # /add-telegram-swarm - Agent swarm for Telegram
│       ├── add-discord/SKILL.md        # /add-discord - Discord channel
│       ├── add-gmail/SKILL.md          # /add-gmail - Gmail integration
│       ├── add-voice-transcription/    # /add-voice-transcription - Whisper
│       ├── x-integration/SKILL.md      # /x-integration - X/Twitter
│       ├── convert-to-apple-container/  # /convert-to-apple-container - Apple Container runtime
│       ├── add-parallel/SKILL.md       # /add-parallel - Parallel agents
│       └── sync-docs/SKILL.md          # /sync-docs - Sync docs after refactoring
│
├── groups/
│   ├── global/                    # Global memory (read by all groups)
│   │   └── CLAUDE.md              # Shared preferences, facts, context
│   ├── main/                      # Self-chat (main control channel)
│   │   ├── CLAUDE.md              # Main channel memory
│   │   └── logs/                  # Task execution logs
│   └── {Group Name}/              # Per-group folders (created on registration)
│       ├── CLAUDE.md              # Group-specific memory
│       ├── logs/                  # Task logs for this group
│       └── *.md                   # Files created by the agent
│
├── store/                         # Local data (gitignored)
│   ├── auth/                      # WhatsApp authentication state
│   └── messages.db                # SQLite database (messages, chats, scheduled_tasks, task_run_logs, registered_groups, sessions, conversation_archives, router_state)
│
├── data/                          # Application state (gitignored)
│   ├── sessions/                  # Per-group session data (.claude/ dirs with JSONL transcripts)
│   ├── env/env                    # Copy of .env for container mounting
│   └── ipc/                       # Container IPC (messages/, tasks/, input/, responses/)
│
├── logs/                          # Runtime logs (gitignored)
│   ├── g2.log               # Host stdout
│   └── g2.error.log         # Host stderr
│   # Note: Per-container logs are in groups/{folder}/logs/container-*.log
│
└── launchd/
    └── com.g2.plist         # macOS service configuration
```

---

## Configuration

Configuration constants are in `src/infrastructure/Config.ts`:

```typescript
import path from 'path';
import { readEnvFile } from './env.js';

const envConfig = readEnvFile(['ASSISTANT_NAME', 'ASSISTANT_HAS_OWN_NUMBER']);

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'G2';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER || envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

export const MOUNT_ALLOWLIST_PATH = path.join(HOME_DIR, '.config', 'g2', 'mount-allowlist.json');
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE = process.env.CONTAINER_IMAGE || 'g2-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(process.env.CONTAINER_TIMEOUT || '1800000', 10);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760', 10); // 10MB
export const IPC_POLL_INTERVAL = 1000; // Base interval; IPC watcher uses fs.watch with 10x fallback poll
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10); // 30min
export const MAX_CONCURRENT_CONTAINERS = Math.max(1, parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5);

export const TRIGGER_PATTERN = new RegExp(`^@${escapeRegex(ASSISTANT_NAME)}\\b`, 'i');
export const TIMEZONE = resolveTimezone(); // System timezone, falls back to UTC
```

**Note:** Paths must be absolute for container volume mounts to work correctly.

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ASSISTANT_NAME` | `G2` | Name used for trigger pattern and response prefix |
| `ASSISTANT_HAS_OWN_NUMBER` | `false` | When `true`, every message triggers (DMs as main channel) |
| `CONTAINER_IMAGE` | `g2-agent:latest` | Docker image for agent containers |
| `CONTAINER_TIMEOUT` | `1800000` (30min) | Maximum container execution time in ms |
| `CONTAINER_MAX_OUTPUT_SIZE` | `10485760` (10MB) | Maximum output size from container |
| `IDLE_TIMEOUT` | `1800000` (30min) | Inactivity timeout in ms |
| `MAX_CONCURRENT_CONTAINERS` | `5` | Global concurrency limit for containers |

### ASSISTANT_HAS_OWN_NUMBER Mode

When `ASSISTANT_HAS_OWN_NUMBER=true`, the assistant has its own dedicated WhatsApp number. In this mode:
- Every incoming message triggers a response (no `@Name` prefix needed)
- DMs serve as the main control channel
- Group behavior remains the same (trigger word still required)

### Container Configuration

Groups can have additional directories mounted via `containerConfig` in the SQLite `registered_groups` table (stored as JSON in the `container_config` column). Example registration:

```typescript
registerGroup("1234567890@g.us", {
  name: "Dev Team",
  folder: "dev-team",
  trigger: "@G2",
  added_at: new Date().toISOString(),
  containerConfig: {
    additionalMounts: [
      {
        hostPath: "~/projects/webapp",
        containerPath: "webapp",
        readonly: false,
      },
    ],
    timeout: 600000,
  },
});
```

Additional mounts appear at `/workspace/extra/{containerPath}` inside the container.

**Mount syntax note:** Read-write mounts use `-v host:container`, but readonly mounts require `--mount "type=bind,source=...,target=...,readonly"` (the `:ro` suffix may not work on all runtimes).

### Claude Authentication

Configure authentication in a `.env` file in the project root. Two options:

**Option 1: Claude Subscription (OAuth token)**
```bash
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
```
The token can be extracted from `~/.claude/.credentials.json` if you're logged in to Claude Code.

**Option 2: Pay-per-use API Key**
```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
```

Only the authentication variables (`CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY`) are extracted from `.env` and written to `data/env/env`, then mounted into the container at `/workspace/env-dir/env` and sourced by the entrypoint script. This ensures other environment variables in `.env` are not exposed to the agent. This workaround is needed because some container runtimes lose `-e` environment variables when using `-i` (interactive mode with piped stdin).

### Changing the Assistant Name

Set the `ASSISTANT_NAME` environment variable:

```bash
ASSISTANT_NAME=Bot npm start
```

Or edit the default in `src/infrastructure/Config.ts`. This changes:
- The trigger pattern (messages must start with `@YourName`)
- The response prefix (`YourName:` added automatically)

### Placeholder Values in launchd

Files with `{{PLACEHOLDER}}` values need to be configured:
- `{{PROJECT_ROOT}}` - Absolute path to your g2 installation
- `{{NODE_PATH}}` - Path to node binary (detected via `which node`)
- `{{HOME}}` - User's home directory

---

## Channel System

G2 supports multiple messaging channels through a registry-based architecture.

### Channel Interface

Each channel implements the `Channel` interface:

```typescript
interface Channel {
  id: string;          // Unique identifier (e.g., "whatsapp", "telegram")
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(chatJid: string, text: string): Promise<void>;
}
```

### Channel Registry

The `ChannelRegistry` uses the registry pattern with prefix-based routing:

- `wa:` prefix for WhatsApp chat JIDs
- `tg:` prefix for Telegram chat IDs
- `dc:` prefix for Discord channel IDs

This allows uniform processing regardless of the originating channel. Outbound messages are routed to the correct channel based on the prefix of the `chat_jid`.

### Supported Channels

| Channel | Status | Implementation |
|---------|--------|----------------|
| WhatsApp | Built-in | `src/messaging/whatsapp/WhatsAppChannel.ts` |
| Telegram | Optional | Added via `/add-telegram` skill |
| Discord | Optional | Added via `/add-discord` skill |

### Channel Lifecycle

1. Channel implements the `Channel` interface
2. Channel is registered with the `ChannelRegistry`
3. `start()` is called during application startup
4. Inbound messages are normalized and stored in SQLite
5. Outbound messages are dispatched through the registry based on `chat_jid` prefix

### Multi-Channel Message Flow

All channels normalize messages into the same format before storage. The message poller and router operate on the unified format, making the processing pipeline channel-agnostic.

---

## Memory System

G2 uses a hierarchical memory system based on CLAUDE.md files.

### Memory Hierarchy

| Level | Location | Read By | Written By | Purpose |
|-------|----------|---------|------------|---------|
| **Global** | `groups/global/CLAUDE.md` | All groups | Main only | Preferences, facts, context shared across all conversations |
| **Group** | `groups/{name}/CLAUDE.md` | That group | That group | Group-specific context, conversation memory |
| **Files** | `groups/{name}/*.md` | That group | That group | Notes, research, documents created during conversation |

### How Memory Works

1. **Agent Context Loading**
   - Agent runs with `cwd` set to `/workspace/group` (mounted from `groups/{group-name}/`)
   - `./CLAUDE.md` in the working directory = group memory
   - For non-main groups, `groups/global/` is mounted at `/workspace/global` (read-only). Claude Code loads `CLAUDE.md` files from additional directories via the `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` setting.
   - For main groups, the project root is mounted at `/workspace/project`, giving access to all group memory

2. **Writing Memory**
   - When user says "remember this", agent writes to `./CLAUDE.md` in the group folder
   - When user says "remember this globally" (main channel only), agent writes to `groups/global/CLAUDE.md`
   - Agent can create files like `notes.md`, `research.md` in the group folder

3. **Main Channel Privileges**
   - Only the "main" group (self-chat) can write to global memory
   - Main can manage registered groups and schedule tasks for any group
   - Main can configure additional directory mounts for any group
   - All groups have Bash access (safe because it runs inside container)

### Memory File Format

Memory files are standard Markdown. They are auto-loaded by Claude Code when the agent starts. The content persists across sessions — memory is long-lived, while sessions (transcripts) may be cleared independently.

### Memory Update Patterns

- **Append**: Add new facts or preferences to the end of the file
- **Replace sections**: Update a specific section with new content
- **Create new files**: For larger bodies of knowledge (research, notes, project context)

### Session vs Memory

These are distinct concepts:
- **Sessions** = transcript continuity via JSONL files. Allows Claude to remember what was said in recent messages. Can be cleared without losing memory.
- **Memory** = persistent facts via CLAUDE.md files. Survives session clears. Contains preferences, learned facts, and ongoing context.

---

## Session Management

Sessions enable conversation continuity — Claude remembers what you talked about.

### How Sessions Work

1. Each group has a session ID stored in SQLite (`sessions` table, keyed by `group_folder`)
2. Session ID is passed to Claude Agent SDK's `resume` option
3. Claude continues the conversation with full context
4. Session transcripts are stored as JSONL files in `data/sessions/{group}/.claude/`

### Session Resume Flow

1. Host reads session ID from SQLite for the group
2. Session ID passed to `ContainerRunner` as the `resume` option
3. Container mounts `data/sessions/{group}/.claude/` to `/home/node/.claude/`
4. Agent runner passes `resume` to Claude Agent SDK
5. Claude loads the JSONL transcript and continues the conversation

### Session Commands

| Command | Effect |
|---------|--------|
| `clear_session` | Clears the current session, starts fresh |
| `resume_session` | Resumes a specific session by ID |
| `search_sessions` | Search across archived session transcripts |
| `archive_session` | Archive the current session for later retrieval |

---

## Message Flow

### Incoming Message Flow

```
1. User sends message (WhatsApp, Telegram, Discord, etc.)
   │
   ▼
2. Channel receives message and normalizes format
   │
   ▼
3. Message stored in SQLite (store/messages.db)
   │
   ▼
4. Message loop polls SQLite (every 2 seconds)
   │
   ▼
5. Router checks:
   ├── Is chat_jid in registered groups (SQLite)? → No: ignore
   └── Does message match trigger pattern? → No: store but don't process
   │
   ▼
6. Router catches up conversation:
   ├── Fetch all messages since last agent interaction
   ├── Format with timestamp and sender name
   └── Build prompt with full conversation context
   │
   ▼
7. Router invokes Claude Agent SDK:
   ├── cwd: groups/{group-name}/
   ├── prompt: conversation history + current message
   ├── resume: session_id (for continuity)
   └── mcpServers: g2 (scheduler)
   │
   ▼
8. Claude processes message:
   ├── Reads CLAUDE.md files for context
   └── Uses tools as needed (search, email, etc.)
   │
   ▼
9. Router prefixes response with assistant name and sends via channel
   │
   ▼
10. Router updates last agent timestamp and saves session ID
```

### Trigger Word Matching

Messages must start with the trigger pattern (default: `@G2`):
- `@G2 what's the weather?` → Triggers Claude
- `@g2 help me` → Triggers (case insensitive)
- `Hey @G2` → Ignored (trigger not at start)
- `What's up?` → Ignored (no trigger)

When `ASSISTANT_HAS_OWN_NUMBER=true`, DMs trigger without the prefix.

### Conversation Catch-Up

When a triggered message arrives, the agent receives all messages since its last interaction in that chat. Each message is formatted with timestamp and sender name:

```
[Jan 31 2:32 PM] John: hey everyone, should we do pizza tonight?
[Jan 31 2:33 PM] Sarah: sounds good to me
[Jan 31 2:35 PM] John: @G2 what toppings do you recommend?
```

This allows the agent to understand the conversation context even if it wasn't mentioned in every message.

### Message Formatting

The `MessageFormatter` applies two key transforms before messages reach the agent:
- **XML encoding**: Prevents injection of XML-like tags in user messages
- **Internal tag stripping**: Removes any internal system tags from user content

---

## Container Lifecycle

Each agent invocation follows this lifecycle:

```
1. AgentExecutor.execute() called with group + prompt
   │
   ▼
2. MountBuilder constructs volume mounts
   ├── Group directory → /workspace/group
   ├── Global memory → /workspace/global (non-main)
   ├── Session data → /home/node/.claude/
   ├── Additional mounts → /workspace/extra/*
   └── Env file → /workspace/env-dir/env
   │
   ▼
3. ContainerRunner spawns container via ContainerRuntime
   │
   ▼
4. Host pipes prompt to container stdin
   │
   ▼
5. Container runs agent-runner → Claude Agent SDK
   ├── Loads CLAUDE.md files for context
   ├── Receives conversation catchup + task context
   ├── Resumes session if session ID provided
   └── Configures tools and MCP servers
   │
   ▼
6. OUTPUT_START / OUTPUT_END markers delimit response
   │
   ▼
7. ContainerOutputParser extracts response
   │
   ▼
8. Container exits; output returned to host
```

### Container Entrypoint Flow

Inside the container, the agent-runner:
1. Sources environment variables from `/workspace/env-dir/env`
2. Reads prompt from stdin
3. Constructs system prompt from CLAUDE.md files and context
4. Initializes Claude Agent SDK with tools, MCP servers, and resume option
5. Runs the query loop (agent processes tools and generates response)
6. Writes response between OUTPUT_START/OUTPUT_END markers to stdout

### Container Networking

- Containers have internet access via NAT (for web search, API calls)
- No inbound ports are exposed
- IPC between host and container is file-based (via mounted directories), not network-based

---

## Execution Queue

The `ExecutionQueue` manages container execution with two guarantees:

1. **Per-group sequential execution**: Within a group, messages are processed FIFO. This prevents race conditions on group files (CLAUDE.md, session data).

2. **Global concurrency limit**: At most `MAX_CONCURRENT_CONTAINERS` (default: 5) containers run simultaneously across all groups.

When a message arrives for a group that already has a container running, it queues behind the current execution. Messages for different groups can run in parallel up to the concurrency limit.

---

## Commands

### Commands Available in Any Group

| Command | Example | Effect |
|---------|---------|--------|
| `@Assistant [message]` | `@G2 what's the weather?` | Talk to Claude |

### Commands Available in Main Channel Only

| Command | Example | Effect |
|---------|---------|--------|
| `@Assistant add group "Name"` | `@G2 add group "Family Chat"` | Register a new group |
| `@Assistant remove group "Name"` | `@G2 remove group "Work Team"` | Unregister a group |
| `@Assistant list groups` | `@G2 list groups` | Show registered groups |
| `@Assistant remember [fact]` | `@G2 remember I prefer dark mode` | Add to global memory |

---

## Scheduled Tasks

G2 has a built-in scheduler that runs tasks as full agents in their group's context.

### How Scheduling Works

1. **Group Context**: Tasks created in a group run with that group's working directory and memory
2. **Full Agent Capabilities**: Scheduled tasks have access to all tools (WebSearch, file operations, etc.)
3. **Optional Messaging**: Tasks can send messages to their group using the `send_message` tool, or complete silently
4. **Main Channel Privileges**: The main channel can schedule tasks for any group and view all tasks
5. **Task Isolation**: Each scheduled task runs in its own container invocation

### Schedule Types

| Type | Value Format | Example |
|------|--------------|---------|
| `cron` | Cron expression | `0 9 * * 1` (Mondays at 9am) |
| `interval` | Milliseconds | `3600000` (every hour) |
| `once` | ISO timestamp | `2024-12-25T09:00:00Z` |

### Creating a Task

```
User: @G2 remind me every Monday at 9am to review the weekly metrics

Claude: [calls mcp__g2__schedule_task]
        {
          "prompt": "Send a reminder to review weekly metrics. Be encouraging!",
          "schedule_type": "cron",
          "schedule_value": "0 9 * * 1"
        }

Claude: Done! I'll remind you every Monday at 9am.
```

### One-Time Tasks

```
User: @G2 at 5pm today, send me a summary of today's emails

Claude: [calls mcp__g2__schedule_task]
        {
          "prompt": "Search for today's emails, summarize the important ones, and send the summary to the group.",
          "schedule_type": "once",
          "schedule_value": "2024-01-31T17:00:00Z"
        }
```

### Managing Tasks

From any group:
- `@G2 list my scheduled tasks` - View tasks for this group
- `@G2 pause task [id]` - Pause a task
- `@G2 resume task [id]` - Resume a paused task
- `@G2 cancel task [id]` - Delete a task

From main channel:
- `@G2 list all tasks` - View tasks from all groups
- `@G2 schedule task for "Family Chat": [prompt]` - Schedule for another group

### Task Claiming and Execution

The scheduler uses atomic claiming to prevent duplicate execution:
- `TaskScheduler` checks for due tasks every 60 seconds
- When a task is due, it sets `last_claimed_at` atomically
- The claimed task spawns a container in the group's context
- Execution results are logged to the `task_run_logs` table (including timing and output)

---

## IPC System

G2 uses file-based IPC for communication between the host process and agent containers.

### How IPC Works

1. Container writes a JSON command file to a mounted IPC directory (`data/ipc/`)
2. Host's `IpcWatcher` detects the file (via `fs.watch` with 10-second fallback polling)
3. `IpcDispatcher` routes the command to the appropriate handler
4. Handler executes the command and writes a response file
5. Container polls for the response file

### IPC Security

- The host validates group ownership before executing any IPC command
- `AuthorizationPolicy` enforces access control: main group has full access, regular groups are restricted to their own resources
- All IPC commands include the originating group for authorization checks

### IPC Command Handlers

| Handler | Commands |
|---------|----------|
| `TaskHandlers` | `schedule_task`, `pause_task`, `resume_task`, `cancel_task` |
| `SessionHandlers` | `clear_session`, `resume_session`, `search_sessions`, `archive_session` |
| `GroupHandlers` | `register_group`, `refresh_groups` |

---

## MCP Servers

### G2 MCP (built-in)

The `g2` MCP server is created dynamically per agent call with the current group's context. Inside the container, it runs as a stdio-based MCP server (`ipc-mcp-stdio.ts`) that translates MCP tool calls into file-based IPC commands.

**Available Tools:**
| Tool | Purpose |
|------|---------|
| `schedule_task` | Schedule a recurring or one-time task |
| `list_tasks` | Show tasks (group's tasks, or all if main) |
| `get_task` | Get task details and run history |
| `update_task` | Modify task prompt or schedule |
| `pause_task` | Pause a task |
| `resume_task` | Resume a paused task |
| `cancel_task` | Delete a task |
| `send_message` | Send a message to the group |

### Agent SDK Configuration

The Claude Agent SDK is invoked with these options:
- `model`: Claude model to use
- `prompt`: Constructed from conversation catchup and context
- `resume`: Session ID for continuity
- `maxTurns`: Limit on agent turns
- `mcpServers`: G2 MCP server (and any per-group MCP servers)
- `tools`: All standard tools enabled (Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch)
- `permissionMode`: Configured per invocation

### System Prompt Construction

The agent's system prompt is built from:
1. `CLAUDE.md` files (group + global memory)
2. Conversation catchup (recent messages)
3. Task context (for scheduled task executions)
4. Snapshot data (tasks, sessions, groups summaries written by `SnapshotWriter`)

---

## Skills System

G2 uses Claude Code's slash command skills system for developer-facing operations and container-available capabilities.

### Developer Skills (`.claude/skills/`)

These are invoked by the developer via Claude Code slash commands:

| Category | Skills |
|----------|--------|
| **Setup** | `/setup` — First-time installation and configuration |
| **Channels** | `/add-telegram`, `/add-telegram-swarm`, `/add-discord`, `/add-gmail` |
| **Features** | `/x-integration`, `/add-voice-transcription`, `/add-parallel` |
| **Maintenance** | `/sync-docs` — Sync documentation after refactoring |
| **Runtime** | `/convert-to-apple-container` — Switch to Apple Container runtime |
| **Debugging** | `/debug` — Container and service troubleshooting |
| **Customization** | `/customize` — Add capabilities and integrations |

### Container Skills (`container/skills/`)

These are available to all agent instances running inside containers:

| Skill | Purpose |
|-------|---------|
| `agent-browser` | Browser automation via Chromium |

---

## Security Model

### Trust Boundaries

G2 operates across three trust zones:

| Zone | Trust Level | Components |
|------|-------------|------------|
| **Host** | Trusted | Node.js process, SQLite, file system |
| **Container** | Semi-trusted | Agent runner, mounted directories, tools |
| **Agent LLM** | Untrusted | Claude's responses, tool invocations |

### Container Isolation

All agents run inside containers (lightweight Linux VMs), providing:
- **Filesystem isolation**: Agents can only access mounted directories
- **Safe Bash access**: Commands run inside the container, not on the host
- **Network isolation**: Internet via NAT, no inbound ports
- **Process isolation**: Container processes cannot affect the host
- **Non-root user**: Container runs as unprivileged `node` user (uid 1000)
- **No Docker socket**: Container cannot access the container runtime
- **Read-only mounts**: Global memory and reference directories are mounted read-only
- **Timeout enforcement**: Containers are killed after `CONTAINER_TIMEOUT`
- **Output size limit**: Response capped at `CONTAINER_MAX_OUTPUT_SIZE`

### Mount Security

The `MountSecurity` module (`src/execution/MountSecurity.ts`) validates all mount requests:
- Checks against an allowlist at `~/.config/g2/mount-allowlist.json`
- Prevents path traversal attacks
- Resolves symlinks before validation
- Only explicitly allowed paths can be mounted

### Authorization Policy

The `AuthorizationPolicy` class enforces fine-grained access control:
- **Main group**: Full access to all groups, tasks, sessions, and global memory
- **Regular groups**: Restricted to their own group directory, tasks, and sessions
- Authorization is checked on every IPC command

### Prompt Injection Mitigations

WhatsApp messages could contain malicious instructions attempting to manipulate Claude's behavior.

**Mitigations:**
- Container isolation limits blast radius
- Only registered groups are processed
- Trigger word required (reduces accidental processing)
- Agents can only access their group's mounted directories
- XML encoding of user messages prevents tag injection
- Internal tag stripping removes system markers from user content
- Scheduled tasks run in isolation (own container, own context)
- Claude's built-in safety training

**Recommendations:**
- Only register trusted groups
- Review additional directory mounts carefully
- Review scheduled tasks periodically
- Monitor logs for unusual activity

### Credential Storage

| Credential | Storage Location | Notes |
|------------|------------------|-------|
| Claude CLI Auth | data/sessions/{group}/.claude/ | Per-group isolation, mounted to /home/node/.claude/ |
| WhatsApp Session | store/auth/ | Auto-created, persists ~20 days |

### File Permissions

The groups/ folder contains personal memory and should be protected:
```bash
chmod 700 groups/
```

---

## Polling Loops and Heartbeats

G2 uses three polling loops and a timer, all built on the shared `poll-loop` abstraction.

### Message Polling Loop

- **Component**: `MessagePoller`
- **Interval**: 2000ms (`POLL_INTERVAL`)
- **Behavior**: Queries SQLite for new messages since the last cursor. Cursor is stored in `router_state`.
- **On match**: Enqueues message for group processing

### Scheduler Loop

- **Component**: `TaskScheduler`
- **Interval**: 60000ms (`SCHEDULER_POLL_INTERVAL`)
- **Behavior**: Checks for due tasks (cron, interval, or one-time). Claims atomically via `last_claimed_at`. Spawns container for execution.

### IPC Watcher

- **Component**: `IpcWatcher`
- **Primary**: `fs.watch` on `data/ipc/` directory
- **Fallback**: 10-second polling interval (for filesystems where `fs.watch` is unreliable)
- **Behavior**: Detects new IPC command files, dispatches to `IpcDispatcher`

### Idle Timer

- **Component**: `idle-timer.ts`
- **Behavior**: Tracks inactivity per group. Used by the scheduler to avoid unnecessary executions. Configurable timeout (`IDLE_TIMEOUT`).

### Recovery on Startup

On startup, G2:
- Checks for unprocessed messages (messages after the last cursor position)
- Checks for overdue scheduled tasks
- Processes both immediately to avoid gaps from downtime

### Backoff Strategy

All polling loops use exponential backoff on errors:
- Backoff multiplier increases on consecutive errors (up to 5x the base interval)
- Resets to base interval on first successful poll

---

## Database Schema

All persistent state is stored in SQLite (`store/messages.db`). The database contains 8 tables:

| Table | Purpose |
|-------|---------|
| `messages` | All incoming and outgoing messages across channels |
| `chats` | Chat metadata (group name, participant info) |
| `scheduled_tasks` | Task definitions (prompt, schedule, status, claiming) |
| `task_run_logs` | Execution history for tasks (timing, output, status) |
| `registered_groups` | Group registrations (chat_jid, folder, trigger, container_config) |
| `sessions` | Active session IDs per group |
| `conversation_archives` | Archived session transcripts for search |
| `router_state` | Key-value store for routing state (cursors, timestamps) |

### Architecture Decision: SQLite over JSON Files

SQLite was chosen over JSON files for:
- **Atomic writes**: No partial write corruption
- **Concurrent access**: Multiple readers, single writer with WAL mode
- **Query capability**: SQL for complex lookups (vs. loading entire files)
- **Auto-migration**: Existing JSON data is migrated automatically on first run

---

## Deployment

G2 runs as a single macOS launchd service (or as a systemd service on Linux).

### Setup Steps

1. Clone the repository
2. Install dependencies (`npm install`)
3. Configure `.env` with Claude authentication
4. Build the host (`npm run build`)
5. Build the container image (`./container/build.sh`)
6. Start the service (or run `npm run dev`)
7. Scan the QR code for WhatsApp authentication
8. Register your main group (self-chat)

### Startup Sequence

When G2 starts, it:
1. **Ensures container runtime is running** - Automatically starts it if needed; kills orphaned G2 containers from previous runs
2. Initializes the SQLite database (migrates from JSON files if they exist)
3. Loads state from SQLite (registered groups, sessions, router state)
4. Connects to WhatsApp (on `connection.open`):
   - Starts the scheduler loop
   - Starts the IPC watcher for container messages
   - Sets up the per-group queue with `processGroupMessages`
   - Recovers any unprocessed messages from before shutdown
   - Starts the message polling loop

### Graceful Shutdown

Shutdown occurs in reverse dependency order:
1. Stop message polling (no new messages accepted)
2. Wait for running containers to complete (or timeout)
3. Stop IPC watcher
4. Stop scheduler loop
5. Close database connection

### Service: com.g2

**launchd/com.g2.plist:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.g2</string>
    <key>ProgramArguments</key>
    <array>
        <string>{{NODE_PATH}}</string>
        <string>{{PROJECT_ROOT}}/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>{{PROJECT_ROOT}}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>{{HOME}}/.local/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>{{HOME}}</string>
        <key>ASSISTANT_NAME</key>
        <string>G2</string>
    </dict>
    <key>StandardOutPath</key>
    <string>{{PROJECT_ROOT}}/logs/g2.log</string>
    <key>StandardErrorPath</key>
    <string>{{PROJECT_ROOT}}/logs/g2.error.log</string>
</dict>
</plist>
```

### Managing the Service

```bash
# Install service
cp launchd/com.g2.plist ~/Library/LaunchAgents/

# Start service
launchctl load ~/Library/LaunchAgents/com.g2.plist

# Stop service
launchctl unload ~/Library/LaunchAgents/com.g2.plist

# Check status
launchctl list | grep g2

# View logs
tail -f logs/g2.log
```

### Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.

### Apple Container Runtime

G2 supports macOS-native Apple Containers as an alternative to Docker:

| Aspect | Docker | Apple Containers |
|--------|--------|-----------------|
| Runtime | Docker Desktop | macOS-native |
| Networking | Docker bridge | vmnet |
| Mounts | `-v` bind mounts | Container-native mounts |
| Build | `docker build` | Apple container build commands |

Migration from Docker to Apple Containers is available via the `/convert-to-apple-container` skill.

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| No response to messages | Service not running | Check `launchctl list | grep g2` |
| "Claude Code process exited with code 1" | Container runtime failed to start | Check logs; G2 auto-starts container runtime but may fail |
| "Claude Code process exited with code 1" | Session mount path wrong | Ensure mount is to `/home/node/.claude/` not `/root/.claude/` |
| Session not continuing | Session ID not saved | Check SQLite: `sqlite3 store/messages.db "SELECT * FROM sessions"` |
| Session not continuing | Mount path mismatch | Container user is `node` with HOME=/home/node; sessions must be at `/home/node/.claude/` |
| "QR code expired" | WhatsApp session expired | Delete store/auth/ and restart |
| "No groups registered" | Haven't added groups | Use `@G2 add group "Name"` in main |
| Slow responses | Container startup overhead | Normal: ~2-5s startup per container invocation |
| WhatsApp disconnects | Network or session issues | G2 auto-reconnects; check logs if persistent |
| Build cache stale | Buildkit retains old files | Prune builder, then rebuild (`./container/build.sh`) |

### Debug Checklist

**Container won't start:**
- Check container runtime is running (`docker ps` or equivalent)
- Verify container image exists (`docker images | grep g2-agent`)
- Check mount paths are valid and accessible
- Review container logs in `groups/{folder}/logs/container-*.log`

**Empty response from agent:**
- Check `OUTPUT_START`/`OUTPUT_END` markers in container logs
- Verify Claude authentication (OAuth token or API key valid)
- Check `CONTAINER_MAX_OUTPUT_SIZE` is not too small

**IPC not working:**
- Verify `data/ipc/` directory exists and is writable
- Check `IpcWatcher` is running (look for startup log)
- Try the fallback polling (fs.watch can be unreliable on some filesystems)

**Scheduled task not firing:**
- Check task status: `sqlite3 store/messages.db "SELECT * FROM scheduled_tasks"`
- Verify cron expression or interval is correct
- Check `last_claimed_at` — if recently claimed, task may be running
- Ensure scheduler loop is active (check logs for scheduler poll)

### Log Location

- `logs/g2.log` - stdout
- `logs/g2.error.log` - stderr
- `groups/{folder}/logs/container-*.log` - per-container execution logs

### Debug Mode

Run manually for verbose output:
```bash
npm run dev
# or
node dist/index.js
```

---

## Architecture Decision Records

Key architectural decisions and their rationale:

### ADR 1: SQLite over JSON Files
- **Decision**: Use SQLite for all persistent state
- **Rationale**: Atomic writes, concurrent access, query capability
- **Trade-off**: Slightly more complex than flat files
- **Migration**: Auto-migration from JSON files on first run

### ADR 2: Polling over WebSocket Events
- **Decision**: Use polling loops instead of event-driven message processing
- **Rationale**: Simpler recovery from crashes, no lost events, predictable resource usage
- **Trade-off**: Slight latency (~2s for messages, ~60s for tasks)

### ADR 3: Container Isolation over In-Process SDK
- **Decision**: Run each agent invocation in a separate container
- **Rationale**: Filesystem isolation, safe Bash execution, resource limits
- **Trade-off**: ~2-5s startup overhead per invocation

### ADR 4: File-Based IPC over Network IPC
- **Decision**: Use file-based JSON for host-container communication
- **Rationale**: Works across container runtimes, debuggable (inspect files), no port management
- **Trade-off**: `fs.watch` reliability varies; mitigated with fallback polling

### ADR 5: Session Continuity via Claude Agent SDK Resume
- **Decision**: Use JSONL transcripts with SDK resume option
- **Rationale**: Native SDK support, session ID tracked in SQLite, transcripts persist on disk
- **Trade-off**: Session files grow over time; mitigated with archiving

### ADR 6: Per-Group Memory Isolation
- **Decision**: Each group gets its own filesystem directory and memory
- **Rationale**: Privacy between groups, prevents cross-contamination
- **Trade-off**: Global context requires explicit opt-in via `groups/global/`
