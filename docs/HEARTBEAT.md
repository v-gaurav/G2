# Scheduling & Polling Loops

How G2's three polling loops and task scheduling system work.

---

## Overview

G2 runs three independent polling loops that coordinate container execution:

```
                         SQLite
                           |
          +----------------+----------------+
          |                |                |
    Message Loop     Scheduler Loop    IPC Watcher
     (2s poll)        (60s poll)     (fs.watch + 10s fallback)
          |                |                |
          +--------> GroupQueue <-----------+
                    (max 5 containers)
                         |
                    Container
                  (Claude Agent SDK)
```

All three loops use `startPollLoop()` (`src/poll-loop.ts`) — a shared abstraction that handles error logging, duplicate-start prevention, and graceful stop.

---

## Loop 1: Message Loop

**File:** `src/index.ts` — `startMessageLoop()`
**Interval:** `POLL_INTERVAL` = 2 seconds

Polls SQLite for new incoming messages across all registered groups.

### What happens each tick

1. **Query** — `getNewMessages(jids, lastTimestamp, botPrefix)` fetches messages newer than `lastTimestamp` for all registered group JIDs
2. **Early exit** — If no new messages, do nothing
3. **Advance cursor** — Set `lastTimestamp = newTimestamp` and persist to DB immediately (crash-safe)
4. **Deduplicate** — Group messages by `chat_jid` into a `Map<jid, messages[]>`
5. **Per-group processing:**

   a. **Trigger check** — Non-main groups require a trigger pattern (e.g. `@G2`) in at least one message. Non-trigger messages accumulate in DB and get pulled as context when a trigger eventually arrives. Main group processes all messages.

   b. **Context gathering** — Fetches ALL messages since `lastAgentTimestamp[group]`, not just the new ones. This includes non-trigger messages that accumulated between triggers.

   c. **Route to container:**
   - If a container is already running for this group: pipe formatted messages to the container via IPC file (`queue.sendMessage()`) and set typing indicator
   - If no container running: call `queue.enqueueMessageCheck()` to start one

### Cursor management

Two cursors prevent duplicate processing:

| Cursor | Scope | Purpose |
|--------|-------|---------|
| `lastTimestamp` | Global | Polling cursor — which messages have been "seen" |
| `lastAgentTimestamp[group]` | Per-group | Processing cursor — which messages have been sent to an agent |

On error before output was sent to the user, `lastAgentTimestamp` is rolled back so retries reprocess those messages. On error after output, the cursor stays advanced to prevent duplicate responses.

---

## Loop 2: Scheduler Loop

**File:** `src/task-scheduler.ts` — `startSchedulerLoop()`
**Interval:** `SCHEDULER_POLL_INTERVAL` = 60 seconds

Polls SQLite for scheduled tasks that are due for execution.

### What happens each tick

1. **Query** — `getDueTasks()` runs:
   ```sql
   SELECT * FROM scheduled_tasks
   WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
   ORDER BY next_run
   ```
2. **Claim** — For each due task, atomically claim it by calling `claimTask(id)`:
   ```sql
   UPDATE scheduled_tasks SET next_run = NULL
   WHERE id = ? AND status = 'active' AND next_run IS NOT NULL
   ```
   This returns `true` only if the row was updated. If the task was already claimed by a previous tick (e.g. it's still running), or was paused/cancelled, the claim fails and the task is skipped. This prevents duplicate execution of long-running tasks.

3. **Enqueue** — Successfully claimed tasks are submitted to `GroupQueue.enqueueTask()`, which respects the global concurrency limit (default: 5 containers)

### Task execution (`runTask`)

When the queue runs the task:

1. **Validate group** — Look up the group by `task.group_folder`. If the group no longer exists, log the error and restore `next_run` so the task can retry.

2. **Write snapshots** — `refreshTasksSnapshot()` writes a filtered task list to the group's IPC directory so the container can see its scheduled tasks.

3. **Resolve session** — If `context_mode` is `'group'`, look up the current Claude Agent SDK session ID for this group. If `'isolated'`, use no session (fresh context).

4. **Start idle timer** — `createIdleTimer()` watches for output activity. If no output for `IDLE_TIMEOUT` (30 min), writes a `_close` sentinel to the container's IPC input directory, causing it to exit gracefully.

5. **Spawn container** — `runContainerAgent()` starts a Docker container with the task prompt. Results stream back via sentinel markers.

6. **Stream results** — Each streamed result is forwarded to the user via `sendMessage()` and resets the idle timer.

7. **Calculate next run:**

   | Schedule type | Next run calculation |
   |---------------|---------------------|
   | `cron` | `CronExpressionParser.parse(value, { tz: TIMEZONE }).next()` |
   | `interval` | `Date.now() + parseInt(value)` milliseconds |
   | `once` | `null` (task is done) |

8. **Update DB** — `updateTaskAfterRun(id, nextRun, resultSummary)` sets `next_run`, `last_run`, `last_result`, and marks status `'completed'` if `next_run` is null.

9. **Log run** — Insert into `task_run_logs` with duration, status, result, and error.

---

## Loop 3: IPC Watcher

**File:** `src/ipc.ts` — `startIpcWatcher()`
**Primary:** `fs.watch()` with `{ recursive: true }` on `data/ipc/`
**Fallback:** 10-second poll interval

Processes commands and outbound messages written by containers to their IPC directories.

### Directory structure

```
data/ipc/
  {group-folder}/
    messages/     Container -> Host: outbound messages
    tasks/        Container -> Host: IPC commands
    input/        Host -> Container: follow-up messages, _close sentinel
  errors/         Failed files moved here for debugging
```

### How it triggers

The watcher uses `fs.watch()` on the `data/ipc/` base directory with `{ recursive: true }`. When a container writes a new `.json` file, the watch event fires and triggers immediate processing. A 10-second fallback poll ensures nothing is missed if `fs.watch` drops an event.

A `processing` flag prevents overlapping runs from rapid watch events.

### What happens when triggered

1. **Scan directories** — Async `readdir` on `data/ipc/` to discover group folders (skipping `errors/`)

2. **Process messages** (`{group}/messages/*.json`) — For each message file:
   - Parse JSON, extract `chatJid` and `text`
   - **Authorization check** — `canSendMessage(ctx, targetGroupFolder)`: main group can send to any group, non-main groups can only send to themselves
   - If authorized, call `channel.sendMessage()`
   - Delete file on success, move to `errors/` on failure

3. **Process tasks** (`{group}/tasks/*.json`) — For each task file:
   - Parse JSON, extract command `type`
   - Route to `IpcCommandDispatcher` which maps types to handlers
   - Delete file on success, move to `errors/` on failure

### Available IPC commands

| Command | Handler | What it does |
|---------|---------|-------------|
| `schedule_task` | `ScheduleTaskHandler` | Validate, authorize, calculate `next_run`, insert into `scheduled_tasks` |
| `pause_task` | `PauseTaskHandler` | Set task `status = 'paused'` (skipped by scheduler) |
| `resume_task` | `ResumeTaskHandler` | Set task `status = 'active'` |
| `cancel_task` | `CancelTaskHandler` | Delete task and its run logs from DB |
| `refresh_groups` | `RefreshGroupsHandler` | Re-sync WhatsApp group metadata |
| `register_group` | `RegisterGroupHandler` | Register a new group for message processing |
| `clear_session` | `ClearSessionHandler` | Archive and reset Claude session |
| `resume_session` | `ResumeSessionHandler` | Restore an archived session |
| `search_sessions` | `SearchSessionsHandler` | Query archived sessions |
| `archive_session` | `ArchiveSessionHandler` | Archive current transcript |

---

## GroupQueue: Concurrency Control

**File:** `src/group-queue.ts`

All three loops feed work into `GroupQueue`, which enforces per-group ordering and a global container limit.

### Key settings

| Setting | Default | Purpose |
|---------|---------|---------|
| `MAX_CONCURRENT_CONTAINERS` | 5 | Max simultaneous containers |
| `MAX_RETRIES` | 5 | Max retry attempts per group |
| `BASE_RETRY_MS` | 5000 | Base for exponential backoff (5s, 10s, 20s, 40s, 80s) |

### Per-group state

```typescript
{
  active: boolean;         // Container currently running
  pendingMessages: boolean; // New messages waiting
  pendingTasks: QueuedTask[]; // Scheduled tasks waiting
  process: ChildProcess | null;
  containerName: string | null;
  groupFolder: string | null;
  retryCount: number;
}
```

### Enqueue behavior

**Messages** (`enqueueMessageCheck`):
- If container active for this group: set `pendingMessages = true` (will be drained after current work)
- If at concurrency limit: add to `waitingGroups` Set
- Otherwise: start container immediately

**Tasks** (`enqueueTask`):
- Dedup check: skip if same `taskId` is already queued
- If container active: queue task AND close the idle container's stdin (so the task runs next)
- If at concurrency limit: add to `waitingGroups` Set
- Otherwise: run task immediately

### Drain behavior

When a container finishes (`runForGroup` or `runTask` completes):

1. **Tasks first** — If `pendingTasks` has entries, run the next task (tasks won't be rediscovered from DB like messages can be)
2. **Then messages** — If `pendingMessages` is true, start a new container for messages
3. **Then waiting groups** — If nothing pending for this group, check `waitingGroups` Set and start the next waiting group (tasks prioritized over messages)

### IPC transport

`GroupQueue` delegates file-based IPC to `IpcTransport` (`src/ipc-transport.ts`):

- `sendMessage(groupFolder, text)` — Atomic write (tmp + rename) of a JSON file to the container's input directory
- `closeStdin(groupFolder)` — Writes a `_close` sentinel file to signal the container to exit

---

## Scheduled Task Lifecycle

### Creation

```
Container agent calls MCP tool -> writes JSON to data/ipc/{group}/tasks/
    -> IPC Watcher picks up file
    -> IpcCommandDispatcher routes to ScheduleTaskHandler
    -> Validates fields (prompt, schedule_type, schedule_value, targetJid)
    -> Authorization: canScheduleTask(sourceGroup, targetFolder)
    -> Validates schedule format:
         cron:     CronExpressionParser.parse() must succeed
         interval: parseInt() must be > 0
         once:     new Date() must be valid
    -> Calculates initial next_run
    -> Generates ID: task-{timestamp}-{random}
    -> INSERT into scheduled_tasks with status='active'
```

### Execution

```
Scheduler loop (60s) -> getDueTasks() finds tasks where next_run <= NOW()
    -> claimTask(id) atomically sets next_run = NULL
         (prevents re-queuing if task runs longer than 60s)
    -> GroupQueue.enqueueTask() (respects concurrency limit)
    -> runTask() spawns container with task prompt
    -> Streams output -> forwards to user via sendMessage()
    -> Calculates next next_run based on schedule type
    -> updateTaskAfterRun() sets next_run, last_run, last_result
    -> logTaskRun() records in task_run_logs
    -> If next_run is NULL -> status becomes 'completed'
```

### Pause

```
Container writes pause_task IPC -> IPC Watcher -> PauseTaskHandler
    -> Authorization: canManageTask(sourceGroup, taskGroupFolder)
    -> UPDATE scheduled_tasks SET status = 'paused'
    -> Scheduler skips paused tasks (claimTask fails: status != 'active')
```

### Resume

```
Container writes resume_task IPC -> IPC Watcher -> ResumeTaskHandler
    -> Authorization: canManageTask(sourceGroup, taskGroupFolder)
    -> UPDATE scheduled_tasks SET status = 'active'
    -> Task will execute at its existing next_run time
```

### Cancellation

```
Container writes cancel_task IPC -> IPC Watcher -> CancelTaskHandler
    -> Authorization: canManageTask(sourceGroup, taskGroupFolder)
    -> DELETE FROM task_run_logs WHERE task_id = ?
    -> DELETE FROM scheduled_tasks WHERE id = ?
```

---

## Idle Timer

**File:** `src/idle-timer.ts`

Both the message loop and scheduler use the same `createIdleTimer()` utility to prevent zombie containers.

**Behavior:** After each container result output, the idle timer resets. If no output arrives within `IDLE_TIMEOUT` (default: 30 minutes), the timer writes a `_close` sentinel to the container's IPC input directory. The container's `MessageStream` detects this file and exits gracefully.

**Why it exists:** Containers block on `waitForIpcMessage()` waiting for follow-up messages. Without the idle timer, an idle container would hang indefinitely, consuming a concurrency slot.

---

## Startup Recovery

**File:** `src/index.ts` — `recoverPendingMessages()`

On startup, G2 checks for messages that were "seen" (cursor advanced) but never processed (container crashed before completion):

1. For each registered group, query messages since `lastAgentTimestamp[group]`
2. For non-main groups, verify a trigger is present in the pending messages
3. If unprocessed messages exist with a valid trigger, enqueue via `queue.enqueueMessageCheck()`

This handles the crash window between advancing `lastTimestamp` and completing agent processing.

---

## Database Schema

### scheduled_tasks

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | `task-{timestamp}-{random}` |
| `group_folder` | TEXT | Target group folder name |
| `chat_jid` | TEXT | Target chat JID for output |
| `prompt` | TEXT | Agent prompt to execute |
| `schedule_type` | TEXT | `'cron'`, `'interval'`, or `'once'` |
| `schedule_value` | TEXT | Cron expression, milliseconds, or ISO timestamp |
| `context_mode` | TEXT | `'group'` (with session) or `'isolated'` (fresh) |
| `next_run` | TEXT | ISO timestamp of next execution, NULL if claimed/completed |
| `last_run` | TEXT | ISO timestamp of last execution |
| `last_result` | TEXT | Truncated result or error from last run |
| `status` | TEXT | `'active'`, `'paused'`, or `'completed'` |
| `created_at` | TEXT | ISO timestamp |

### task_run_logs

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `task_id` | TEXT FK | References `scheduled_tasks.id` |
| `run_at` | TEXT | ISO timestamp of run start |
| `duration_ms` | INTEGER | Execution time |
| `status` | TEXT | `'success'` or `'error'` |
| `result` | TEXT | Agent output |
| `error` | TEXT | Error message if failed |

---

## Timing Configuration

**File:** `src/config.ts`

| Constant | Default | Env Override | Purpose |
|----------|---------|-------------|---------|
| `POLL_INTERVAL` | 2s | — | Message loop polling |
| `SCHEDULER_POLL_INTERVAL` | 60s | — | Scheduler loop polling |
| `IPC_POLL_INTERVAL` | 1s (base; fallback = 10x) | — | IPC fallback poll (primary is `fs.watch`) |
| `IDLE_TIMEOUT` | 30 min | `IDLE_TIMEOUT` | Container idle cutoff |
| `CONTAINER_TIMEOUT` | 30 min | `CONTAINER_TIMEOUT` | Max container runtime |
| `MAX_CONCURRENT_CONTAINERS` | 5 | `MAX_CONCURRENT_CONTAINERS` | Global concurrency cap |
| `TIMEZONE` | System TZ | `TZ` | Cron expression timezone |

---

## Authorization

**File:** `src/authorization.ts`

All task operations are gated by authorization context `{ sourceGroup, isMain }`:

| Operation | Main Group | Non-Main Group |
|-----------|-----------|----------------|
| Schedule task for own group | yes | yes |
| Schedule task for other group | yes | no |
| Pause/resume/cancel own tasks | yes | yes |
| Pause/resume/cancel other tasks | yes | no |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/poll-loop.ts` | `startPollLoop()` — shared loop abstraction |
| `src/idle-timer.ts` | `createIdleTimer()` — shared idle timer |
| `src/ipc-transport.ts` | `IpcTransport` — file-based IPC write operations |
| `src/task-snapshots.ts` | `refreshTasksSnapshot()` — write task list for containers |
| `src/task-scheduler.ts` | Scheduler loop and `runTask()` execution |
| `src/ipc.ts` | IPC watcher (fs.watch + fallback poll) |
| `src/ipc-handlers/` | Individual IPC command handlers |
| `src/group-queue.ts` | Concurrency queue with per-group state |
| `src/db.ts` | `getDueTasks()`, `claimTask()`, `updateTaskAfterRun()`, `logTaskRun()` |
| `src/config.ts` | Timing constants and timezone resolution |
| `src/authorization.ts` | Permission checks for task operations |
