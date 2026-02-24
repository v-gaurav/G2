# FAQ

## What happens when a scheduled task fires while a session is already active?

The system never runs two containers for the same group simultaneously. When a scheduled task becomes due and the group already has an active container:

1. The task is queued onto the group's pending task list.
2. The active container's stdin is closed (via IPC close sentinel), signaling it to wind down.
3. Once the active container exits, the queued task runs next — tasks are drained before pending messages.

If the task has `context_mode: 'group'`, it picks up the group's current session ID so the scheduled container shares the same conversation context.

## What is `context_mode` on a scheduled task?

The agent chooses the mode when creating a task via the `schedule_task` IPC command. There are two options:

- **`group`** — The task container resumes the group's current session, sharing ongoing conversation context. Useful for tasks like "check on this later" where continuity matters.
- **`isolated`** (default) — The task runs with no session, starting fresh. Appropriate for standalone recurring jobs like "post a daily summary" that don't need prior conversation history.

If the agent doesn't specify `context_mode`, it defaults to `isolated`.

## Does `context_mode` apply to interactive (self-chat) messages?

No. `context_mode` is only a field on scheduled tasks. When you chat with the agent interactively, `AgentExecutor` always resumes the group's current session via `SessionManager.get()` — effectively `group` mode every time.

## What folders does the main group (self-chat) container have access to?

| Container path | Host path | Access |
|---|---|---|
| `/workspace/project` | `<project-root>` | read-write |
| `/workspace/group` | `<project-root>/groups/main` | read-write |
| `/home/node/.claude` | `<project-root>/data/sessions/main/.claude` | read-write |
| `/workspace/ipc` | `<project-root>/data/ipc/main` | read-write |
| `/app/src` | `<project-root>/container/agent-runner/src` | read-only |
| `/home/node/.aws` | `~/.aws` (if exists) | read-only |

`<project-root>` is the G2 working directory (the directory containing `package.json`).

## What folders does a non-main group container have access to?

| Container path | Host path | Access |
|---|---|---|
| `/workspace/group` | `<project-root>/groups/<folder>` | read-write |
| `/workspace/global` | `<project-root>/groups/global` (if exists) | read-only |
| `/home/node/.claude` | `<project-root>/data/sessions/<folder>/.claude` | read-write |
| `/workspace/ipc` | `<project-root>/data/ipc/<folder>` | read-write |
| `/app/src` | `<project-root>/container/agent-runner/src` | read-only |
| `/home/node/.aws` | `~/.aws` (if exists) | read-only |

The key difference: non-main groups do **not** get `/workspace/project` (no access to G2 source). Instead they get a read-only `/workspace/global` mount for shared resources.
