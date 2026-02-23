# G2 Memory System

How conversation state is stored, resumed, archived, and searched.

---

## Overview

The memory system has three layers:

1. **Claude Agent SDK sessions** — the actual conversation state the agent has access to during a query
2. **Session pointer tables in SQLite** — track which session is active per group and bookmark old ones for switching
3. **Conversation archives** — human-readable markdown transcripts searchable by the agent

```
┌─────────────────────────────────────────────────────────────┐
│  data/sessions/{group}/.claude/                             │
│  ├── projects/-workspace-group/                             │
│  │   ├── {sessionId-A}.jsonl   ← full/compacted transcript  │
│  │   ├── {sessionId-B}.jsonl                                │
│  │   └── {sessionId-C}.jsonl                                │
│  ├── session-env/{sessionId}/  ← environment state          │
│  ├── todos/                    ← task tracking              │
│  ├── shell-snapshots/          ← Bash tool state            │
│  └── settings.json             ← SDK config + feature flags │
│                                                             │
│  (All sessions for a group coexist in one .claude/ dir,     │
│   each keyed by UUID. The SDK loads whichever sessionId     │
│   is passed via the `resume` parameter.)                    │
└─────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  SQLite (store/messages.db)              │
│                                          │
│  sessions table                          │
│  ┌────────────┬──────────────────┐       │
│  │group_folder│ session_id       │       │
│  ├────────────┼──────────────────┤       │
│  │ main       │ d58a79a7-...     │  ← active session pointer
│  │ dev-team   │ 7b8ff97a-...     │       │
│  └────────────┴──────────────────┘       │
│                                          │
│  session_history table                   │
│  ┌──┬────────────┬──────────────┬──────┐ │
│  │id│group_folder│ session_id   │ name │ │
│  ├──┼────────────┼──────────────┼──────┤ │
│  │ 2│ main       │ 5768e1ec-... │ "Tax"│ ← archived session bookmarks
│  │ 3│ main       │ 40b21204-... │ "..." │ │
│  └──┴────────────┴──────────────┴──────┘ │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  groups/{group}/conversations/           │
│  ├── 2026-02-20-tax-research.md          │
│  ├── 2026-02-21-wind-down-reminder.md    │
│  └── ...                                 │
│                                          │
│  (Searchable markdown transcripts.       │
│   Written on clear_session and on        │
│   SDK compaction via PreCompact hook.)   │
└──────────────────────────────────────────┘
```

---

## Layer 1: Claude Agent SDK Sessions

### What a session is

A session is identified by a UUID string (e.g. `d58a79a7-451e-4af5-86d1-3e839200d98d`). It represents the full conversation state managed by the Claude Agent SDK — the compacted transcript, tool results, environment state, and todos.

### Where sessions live on disk

All sessions for a group are stored under a single `.claude/` directory:

```
data/sessions/{group}/.claude/
├── projects/-workspace-group/
│   ├── {sessionId}.jsonl          # Conversation transcript (JSONL format)
│   └── {sessionId}/tool-results/  # Cached tool outputs
├── session-env/{sessionId}/       # Per-session environment state
├── todos/{sessionId}-agent-*.json # Per-session task tracking
├── shell-snapshots/               # Bash tool shell state (shared)
├── debug/                         # Debug logs
├── plans/                         # Plan mode artifacts
├── skills/                        # Synced from container/skills/
└── settings.json                  # SDK feature flags
```

The `-workspace-group` directory name is derived from the container's cwd (`/workspace/group`), encoded by the SDK.

### Multiple sessions coexist

The `.claude/` directory is **not** one session per group. Every session that has ever existed for that group has its `.jsonl` transcript file here, keyed by UUID. The SDK loads whichever session ID is passed via the `resume` parameter in `query()`. Old session files remain on disk indefinitely.

### How sessions are mounted

`DefaultMountFactory` (`src/interfaces/default-mount-factory.ts`) mounts the group's `.claude/` directory into the container:

```
Host: data/sessions/{group}/.claude/
  → Container: /home/node/.claude/
```

On first mount, a `settings.json` is initialized with feature flags (agent teams, additional directories, auto memory).

### How sessions are resumed

In `container/agent-runner/src/index.ts`, the SDK `query()` call receives:

```typescript
query({
  prompt: stream,
  options: {
    resume: sessionId,        // UUID from sessions table, or undefined for new
    resumeSessionAt: resumeAt, // Resume at specific message UUID (for multi-query loop)
    cwd: '/workspace/group',
    // ...
  }
})
```

When `resume` is `undefined`, the SDK creates a new session and returns the new UUID via the `system/init` message. When `resume` is set, the SDK loads the corresponding `.jsonl` transcript.

### Compaction

When the conversation grows too long for the context window, the SDK automatically **compacts** the transcript — older messages are summarized and the `.jsonl` is rewritten with compacted content. After compaction, the original verbatim messages are lost from the SDK state. The `PreCompact` hook (see Layer 3) captures the full transcript before this happens.

---

## Layer 2: Session Pointer Tables

The SQLite database does not store conversation content. It stores **pointers** — which session UUID is active for each group, and bookmarks of old session UUIDs for switching.

### `sessions` table

```sql
CREATE TABLE sessions (
  group_folder TEXT PRIMARY KEY,
  session_id TEXT NOT NULL
);
```

Maps each group to its currently active session UUID. This is what `SessionManager.get()` returns, and what gets passed as `resume` to the SDK.

### `session_history` table

```sql
CREATE TABLE session_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_folder TEXT NOT NULL,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT NOT NULL
);
```

Bookmarks of previous session UUIDs with human-friendly names. Used by `list_sessions` and `resume_session` to let the agent switch between past conversations.

### `SessionManager` (`src/session-manager.ts`)

In-memory cache backed by SQLite. Provides:

| Method | Purpose |
|---|---|
| `get(groupFolder)` | Return active session UUID |
| `set(groupFolder, sessionId)` | Set active session (memory + DB) |
| `delete(groupFolder)` | Remove active session pointer |
| `archive(groupFolder, name)` | Copy current pointer to `session_history` |
| `restore(groupFolder, historyId)` | Move a `session_history` entry back to `sessions` |
| `getHistory(groupFolder)` | List archived sessions for a group |

### Snapshot pattern

Containers have no direct DB access. Before each container spawn, the host writes a JSON snapshot of the session history to `data/ipc/{group}/session_history.json`. The `list_sessions` MCP tool reads this file. Same pattern used for `current_tasks.json` and `available_groups.json`.

---

## Layer 3: Conversation Archives

Human-readable markdown transcripts stored in each group's `conversations/` folder. These are the only artifacts the agent can search by content to find past conversations.

### Location

```
groups/{group}/conversations/
├── 2026-02-20-tax-research.md
├── 2026-02-21-wind-down-reminder-setup.md
└── ...
```

Mounted into the container at `/workspace/group/conversations/`.

### When archives are written

Archives are created by two independent mechanisms:

**1. On `clear_session` (host-side, `src/ipc-handlers/clear-session.ts`)**

When the agent calls the `clear_session` MCP tool, the host handler reads the session's `.jsonl` transcript from `data/sessions/{group}/.claude/projects/-workspace-group/{sessionId}.jsonl`, parses it, and writes a markdown file to `groups/{group}/conversations/`. This is the primary archival mechanism — every explicitly cleared session gets a searchable archive.

**2. On SDK compaction (container-side, `container/agent-runner/src/index.ts`)**

The `PreCompact` hook fires before the SDK compacts a long conversation. It reads the full transcript (via the SDK-provided `transcript_path`), parses it, and writes markdown to `/workspace/group/conversations/`. This captures the full pre-compaction detail that would otherwise be summarized away in the `.jsonl`.

Both mechanisms use the same transcript format:

```markdown
# Travel Planning

Archived: Feb 21, 3:39 AM

---

**User**: I want to plan a trip to Japan...

**G2**: Here are some suggestions...
```

### Transcript parsing

The `.jsonl` transcript is parsed line by line. Each line is a JSON object with a `type` field:

- `type: "user"` — user message, content extracted from `message.content` (string or array of `{text}` blocks)
- `type: "assistant"` — agent response, text parts extracted from `message.content` array where `type === "text"`
- Other types (system, tool use, etc.) are skipped

Messages longer than 2000 characters are truncated in the archive.

### How the agent uses archives

The agent's `CLAUDE.md` instructs it:

> The `conversations/` folder contains searchable history of past conversations. Use this to recall context from previous sessions.

When a user asks to "switch to the conversation where I talked about XYZ", the agent can:

1. `Grep` through `conversations/*.md` for the topic
2. Match the filename to a session name in `list_sessions`
3. Call `resume_session` to switch

---

## Session Lifecycle

### New session

```
1. First message to group
2. Container spawns with sessionId = undefined
3. SDK creates new session, returns UUID via system/init message
4. agent-runner captures newSessionId
5. Host receives newSessionId in ContainerOutput
6. SessionManager.set(groupFolder, newSessionId) writes to sessions table
```

### Active session (subsequent messages)

```
1. Message arrives for group
2. Host reads sessionId from SessionManager.get(groupFolder)
3. Container spawns with resume: sessionId
4. SDK loads .jsonl transcript, agent has full context
5. If follow-up messages arrive, they pipe to /workspace/ipc/input/ (MessageStream)
6. resumeAt tracks last assistant UUID for multi-query continuity
```

### Clear session

```
1. Agent calls clear_session MCP tool with a friendly name
2. MCP tool writes IPC file to /workspace/ipc/tasks/
3. Host ClearSessionHandler:
   a. Reads current sessionId from SessionManager
   b. Reads .jsonl transcript, writes markdown to conversations/
   c. Archives sessionId + name to session_history table
   d. Deletes sessionId from sessions table
   e. Writes _close sentinel to stop the container
4. Next message spawns container with sessionId = undefined → new session
5. Old .jsonl remains on disk in .claude/projects/
```

### Resume session

```
1. Agent calls list_sessions → reads session_history.json snapshot
2. Agent calls resume_session with history ID
3. Host ResumeSessionHandler:
   a. Archives current session to session_history (if save name provided)
   b. Restores target session_id from session_history into sessions table
   c. Removes the history entry (it's now the active session again)
   d. Writes _close sentinel to stop the container
4. Next message spawns container with resume: restored sessionId
5. SDK loads the old .jsonl → agent has that conversation's context
```

---

## Per-Group Isolation

Each group's memory is fully isolated:

| Resource | Isolation |
|---|---|
| SDK state | `data/sessions/{group}/.claude/` — separate directory per group |
| Session pointers | `sessions` table keyed by `group_folder` |
| Session history | `session_history` table filtered by `group_folder` |
| Conversation archives | `groups/{group}/conversations/` — per-group directory |
| IPC snapshots | `data/ipc/{group}/session_history.json` — per-group |

Non-main groups cannot access other groups' sessions, archives, or history. Main group has access to the full project filesystem including all group directories.

### Global memory

`groups/global/CLAUDE.md` is a shared read-only file mounted at `/workspace/global/CLAUDE.md` for non-main groups. Its content is appended to the system prompt via the `append` parameter:

```typescript
systemPrompt: globalClaudeMd
  ? { type: 'preset', preset: 'claude_code', append: globalClaudeMd }
  : undefined,
```

Main group doesn't need this mount since it has direct access to the entire project tree.

---

## Key Files

| File | Layer | Purpose |
|---|---|---|
| `src/session-manager.ts` | 2 | In-memory + SQLite session pointer management |
| `src/db.ts` | 2 | SQLite schema and accessors for sessions/history |
| `src/ipc-handlers/clear-session.ts` | 2, 3 | Archive session pointer + write conversation markdown |
| `src/ipc-handlers/resume-session.ts` | 2 | Restore session pointer from history |
| `src/interfaces/default-mount-factory.ts` | 1 | Mount `.claude/` directory, init settings, sync skills |
| `src/container-runner.ts` | 1, 2 | Write session history snapshot, capture newSessionId |
| `container/agent-runner/src/index.ts` | 1, 3 | SDK query with resume, PreCompact hook |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | — | MCP tools: clear/list/resume session |
| `groups/{group}/CLAUDE.md` | — | Per-group instructions (references conversations/) |
| `groups/global/CLAUDE.md` | — | Global instructions appended to system prompt |
