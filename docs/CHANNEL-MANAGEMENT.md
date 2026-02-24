# Channel Management

How G2 connects to messaging platforms, routes messages, and supports multi-channel operation.

---

## Overview

G2 uses a pluggable channel architecture to abstract messaging platforms. Each channel implements a minimal interface, registers with a central registry, and routes messages by JID (Jabber ID) pattern. The system currently ships with WhatsApp and is extensible to Telegram, Discord, and other platforms via skills.

```
User ──> Channel (WhatsApp) ──> SQLite ──> Polling Loop ──> Container (Agent)
                                                                  │
                                                            IPC send_message
                                                                  │
                                          Channel Registry ◄──────┘
                                                │
                                          Channel.sendMessage()
                                                │
                                          User ◄─┘
```

---

## Channel Interface

Defined in `src/types.ts:81-92`:

```typescript
interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
  syncMetadata?(force?: boolean): Promise<void>;
}
```

| Method | Required | Purpose |
|--------|----------|---------|
| `name` | yes | Unique identifier (`'whatsapp'`, `'telegram'`, `'discord'`) |
| `connect()` | yes | Initialize connection to the platform |
| `sendMessage()` | yes | Deliver a text message to a JID |
| `isConnected()` | yes | Connection health check |
| `ownsJid()` | yes | JID pattern ownership — determines routing |
| `disconnect()` | yes | Graceful teardown |
| `setTyping()` | no | Typing indicator (composing/paused) |
| `syncMetadata()` | no | Sync chat/group names from platform |

**Callback types** (`src/types.ts:94-106`):

| Type | Purpose |
|------|---------|
| `OnInboundMessage` | Channel delivers a parsed message to the host |
| `OnChatMetadata` | Channel notifies the host about chat discovery (JID, name, timestamp) |

Channels are passive — they receive messages via platform-specific listeners and deliver them through callbacks. The host's polling loop is the active orchestrator.

---

## Channel Registry

`src/channel-registry.ts` — the central routing hub for all channels.

### Registration

```typescript
const channelRegistry = new ChannelRegistry();
channelRegistry.register(whatsapp);   // Enforces unique names
```

Duplicate channel names throw an error. Registration happens once during startup.

### JID-Based Routing

The registry routes outbound messages to the correct channel by asking each channel if it owns the target JID:

| JID Pattern | Channel | `ownsJid()` logic |
|-------------|---------|-------------------|
| `*@g.us` | WhatsApp | Group chat |
| `*@s.whatsapp.net` | WhatsApp | Individual chat |
| `tg:*` | Telegram | Prefixed with `tg:` |
| `dc:*` | Discord | Prefixed with `dc:` |

### Key Methods

| Method | Purpose |
|--------|---------|
| `findByJid(jid)` | Find channel that owns this JID (any state) |
| `findConnectedByJid(jid)` | Find channel that owns this JID **and** is connected |
| `getAll()` | Return all registered channels |
| `syncAllMetadata(force?)` | Trigger metadata sync on all channels that support it |
| `disconnectAll()` | Gracefully disconnect all channels |

`findConnectedByJid()` is used for all outbound sends — a disconnected channel's messages are queued internally by the channel (see [Message Queue](#outgoing-message-queue)).

---

## Inbound Message Flow

### Step 1: Platform Event → Channel Callback

The channel listens for platform-specific events and translates them into the common `NewMessage` type.

**WhatsApp example** (`src/channels/whatsapp.ts:92-143`):

1. Baileys emits `messages.upsert` event
2. Channel filters out empty messages and status broadcasts
3. Translates LID JIDs to phone JIDs for consistency
4. Calls `onChatMetadata()` for all messages (enables group discovery)
5. Calls `onMessage()` only for registered groups
6. Detects bot messages via `fromMe` flag (own number) or assistant name prefix (shared number)

### Step 2: Callback → SQLite

Callbacks defined in `src/index.ts` (`main()` function):

```typescript
onMessage:     (chatJid, msg)  => storeMessage(msg);
onChatMetadata: (chatJid, ts, name, channel, isGroup) => storeChatMetadata(...);
```

Messages are stored in the `messages` table, chat metadata in the `chats` table. The `chats` table tracks `channel` (e.g., `'whatsapp'`, `'telegram'`) and `is_group` per JID.

### Step 3: Polling Loop → Container

`MessageProcessor.startPolling()` (in `src/message-processor.ts`) runs every `POLL_INTERVAL` (2s):

1. `getNewMessages()` fetches messages since `lastTimestamp`
2. Deduplicates by group (one container per group per cycle)
3. Checks trigger pattern (main group always active; others require `@G2` mention)
4. Fetches full message history since `lastAgentTimestamp[group]`
5. `formatMessages()` converts to XML for the agent
6. Enqueues to `GroupQueue` for container processing

### Cursor Management (Exactly-Once Processing)

| Cursor | Scope | Purpose |
|--------|-------|---------|
| `lastTimestamp` | Global | Polling cursor — advanced after reading new messages |
| `lastAgentTimestamp[group]` | Per-group | Advanced **before** running agent to prevent reprocessing |

- On error **before** user output: cursor rolled back for retry
- On error **after** user output: cursor kept to prevent duplicate responses

---

## Outbound Message Flow

### Step 1: Agent → IPC

The agent calls the `send_message` MCP tool, which writes a JSON file to `/workspace/ipc/messages/`:

```json
{
  "type": "message",
  "chatJid": "123456789-987654321@g.us",
  "text": "Hello from agent"
}
```

### Step 2: IPC → Authorization

The host's IPC watcher (`src/ipc.ts`) detects the file and checks authorization (`src/authorization.ts`):

| Caller | Can send to own group | Can send to other groups |
|--------|----------------------|-------------------------|
| Main group | yes | yes |
| Non-main group | yes | no |

Unauthorized sends are blocked and logged.

### Step 3: Authorization → Channel Registry → Channel

```typescript
const channel = channelRegistry.findConnectedByJid(jid);
channel.sendMessage(jid, text);
```

The registry finds the correct channel by JID pattern. The channel handles platform-specific formatting and delivery.

### Step 4: Outbound Formatting

`src/message-formatter.ts` (re-exported via `src/router.ts`) processes agent output before sending:

1. `MessageFormatter.stripInternalTags()` — removes `<internal>...</internal>` reasoning blocks
2. Empty strings after stripping are discarded (no empty messages sent)

### Task Scheduler Output

Scheduled tasks (`src/task-scheduler.ts`) follow the same outbound path. The scheduler calls `channelRegistry.findConnectedByJid()` to route task output. Scheduled task output is not sent automatically — the agent must explicitly use `send_message`.

---

## WhatsApp Channel

`src/channels/whatsapp.ts` — the primary channel implementation.

### Connection

- Uses [Baileys](https://github.com/WhiskeySockets/Baileys) (`@whiskeysockets/baileys`) for WhatsApp Web WebSocket protocol
- Auth state stored in `store/auth/` directory via `useMultiFileAuthState()`
- Requires prior authentication via `/setup` skill (QR code triggers exit if unauthenticated)

### Configuration

| Setting | Source | Purpose |
|---------|--------|---------|
| `ASSISTANT_NAME` | `.env` / `src/config.ts` | Bot name prefix on shared numbers |
| `ASSISTANT_HAS_OWN_NUMBER` | `.env` / `src/config.ts` | If `true`, skip name prefix and use `fromMe` for bot detection |

### Bot Message Detection

Two modes depending on phone number setup:

| Mode | Detection | Prefix |
|------|-----------|--------|
| Own number (`ASSISTANT_HAS_OWN_NUMBER=true`) | `msg.key.fromMe` flag | None — WhatsApp shows the number identity |
| Shared number | Content starts with `{ASSISTANT_NAME}:` | `{ASSISTANT_NAME}: ` prepended to all outbound |

### LID Translation

WhatsApp uses Legacy IDs (LIDs) for multi-device support. The channel translates LID JIDs to phone JIDs (`src/channels/whatsapp.ts:267-292`):

1. Check local cache (`lidToPhoneMap`)
2. Query Baileys' signal repository
3. Fall back to raw LID if unresolvable

### Reconnection

Exponential backoff with jitter (`src/channels/whatsapp.ts:244-265`):

| Parameter | Value |
|-----------|-------|
| Base delay | 2 seconds |
| Max delay | 60 seconds |
| Max retries | 10 |
| Backoff formula | `min(2s * 2^attempt, 60s)` |

Reconnection resets on successful connection. Logged-out status (reason `loggedOut`) triggers process exit instead of reconnect.

### Typing Indicators

`setTyping(jid, isTyping)` sends `composing` or `paused` presence updates. Errors are silently caught (typing is best-effort).

---

## Outgoing Message Queue

`src/channels/outgoing-message-queue.ts` — buffers messages when a channel is disconnected.

### Behavior

- FIFO ordered delivery
- Messages are only removed after successful send (peek-then-shift)
- Prevents duplicate flushing via `flushing` mutex flag
- Flushed automatically when the channel reconnects (`onConnectionOpen`)

### Flow

```
sendMessage() ──> connected? ──yes──> sock.sendMessage()
                      │
                     no
                      │
                      ▼
              messageQueue.enqueue()
                      │
              [channel reconnects]
                      │
                      ▼
              messageQueue.flush() ──> sock.sendMessage() per item
```

Send failures also trigger queueing — if `sock.sendMessage()` throws, the message is queued for retry on reconnect.

---

## Metadata Synchronization

`src/channels/whatsapp-metadata-sync.ts` — syncs group names from WhatsApp into the database.

### Timing

| Event | Behavior |
|-------|----------|
| Startup | Sync immediately (respects 24h cache) |
| Periodic | Every 24 hours via `setInterval` |
| On demand | Via `refresh_groups` IPC command (force bypass cache) |

### Cache

- Last sync timestamp stored in SQLite (`getLastGroupSync()` / `setLastGroupSync()`)
- Corrupted timestamps (NaN) fall through to sync (safe default)
- `force=true` bypasses cache entirely

### Data Flow

1. Call `sock.groupFetchAllParticipating()` to get all WhatsApp groups
2. For each group with a `subject`, call `updateChatName(jid, subject)`
3. Update sync timestamp

---

## Database Schema

Channel-related tables in `store/messages.db` (managed by `src/db.ts`):

### `chats` Table

| Column | Type | Purpose |
|--------|------|---------|
| `jid` | TEXT PRIMARY KEY | Chat identifier (JID) |
| `name` | TEXT | Human-readable chat/group name |
| `last_message_time` | TEXT | ISO timestamp of last message |
| `channel` | TEXT | Source channel (`'whatsapp'`, `'telegram'`, `'discord'`) |
| `is_group` | INTEGER | `1` for group chats, `0` for individual |

### `messages` Table

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT | Message ID (platform-specific) |
| `chat_jid` | TEXT | Foreign key to `chats.jid` |
| `sender` | TEXT | Sender JID |
| `sender_name` | TEXT | Display name (push name) |
| `content` | TEXT | Message text content |
| `timestamp` | TEXT | ISO timestamp |
| `is_from_me` | INTEGER | `1` if sent by the connected account |
| `is_bot_message` | INTEGER | `1` if detected as bot output |

### Channel Detection (Migration)

The `channel` and `is_group` columns are derived from JID patterns:

| JID Pattern | Channel | Is Group |
|-------------|---------|----------|
| `*@g.us` | `whatsapp` | `1` |
| `*@s.whatsapp.net` | `whatsapp` | `0` |
| `tg:*` | `telegram` | `1` |
| `dc:*` | `discord` | `1` |

---

## Adding a New Channel

To add a new messaging platform (e.g., Telegram, Discord):

### 1. Implement the `Channel` Interface

Create `src/channels/{platform}.ts`:

```typescript
export class TelegramChannel implements Channel {
  name = 'telegram';

  async connect(): Promise<void> { /* platform init */ }

  async sendMessage(jid: string, text: string): Promise<void> { /* send */ }

  isConnected(): boolean { /* check */ }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');  // JID pattern ownership
  }

  async disconnect(): Promise<void> { /* cleanup */ }

  // Optional
  async setTyping(jid: string, isTyping: boolean): Promise<void> { /* typing */ }
  async syncMetadata(force?: boolean): Promise<void> { /* sync names */ }
}
```

### 2. Register in Main

In `src/index.ts`:

```typescript
const telegram = new TelegramChannel(channelOpts);
channelRegistry.register(telegram);
await telegram.connect();
```

### 3. JID Routing Auto-Resolves

Once registered, `channelRegistry.findConnectedByJid()` automatically routes messages to the new channel based on `ownsJid()`. No changes needed to the router, IPC layer, or agent code.

### 4. Database Migration

Add a migration to classify existing JIDs:

```sql
UPDATE chats SET channel = 'telegram', is_group = 1 WHERE jid LIKE 'tg:%';
```

### Available Skills

G2 provides skills for adding channels:

| Skill | Platform | JID Pattern |
|-------|----------|-------------|
| `/add-telegram` | Telegram | `tg:*` |
| (add-discord) | Discord | `dc:*` |
| `/add-gmail` | Gmail | Platform-specific |

---

## Graceful Shutdown

On `SIGTERM` or `SIGINT` (`src/orchestrator.ts` — `shutdown()`):

1. `queue.shutdown(10000)` — drain active containers (10s timeout)
2. `channelRegistry.disconnectAll()` — disconnect every channel gracefully
3. `process.exit(0)`

Each channel's `disconnect()` handles platform-specific cleanup (e.g., closing WebSocket connections).

---

## Source Files

| File | Purpose |
|------|---------|
| `src/types.ts` | `Channel` interface, `OnInboundMessage`, `OnChatMetadata` callbacks |
| `src/channel-registry.ts` | `ChannelRegistry` — registration, JID routing, bulk operations |
| `src/channels/whatsapp.ts` | `WhatsAppChannel` — Baileys connection, send/receive, LID translation |
| `src/channels/outgoing-message-queue.ts` | `OutgoingMessageQueue` — FIFO buffer for disconnection resilience |
| `src/channels/whatsapp-metadata-sync.ts` | `WhatsAppMetadataSync` — group name sync with 24h cache |
| `src/message-formatter.ts` | `MessageFormatter` — `formatMessages()`, `formatOutbound()`, `stripInternalTags()` |
| `src/message-router.ts` | `MessageRouter` — high-level routing and send operations over ChannelRegistry |
| `src/router.ts` | Backward-compatible re-exports (delegates to message-formatter and message-router) |
| `src/authorization.ts` | `AuthorizationPolicy` class + standalone guards (`canSendMessage()`, etc.) |
| `src/db.ts` | Composition root delegating to `src/repositories/` for DB operations |
| `src/config.ts` | `ASSISTANT_NAME`, `ASSISTANT_HAS_OWN_NUMBER`, `STORE_DIR` |
| `src/index.ts` | Entry point: channel setup, callback wiring, `main()` bootstrap |
| `src/orchestrator.ts` | `Orchestrator` — composes services, wires subsystems, shutdown |
| `src/message-processor.ts` | `MessageProcessor` — message polling, cursor management, trigger checking |
| `src/agent-executor.ts` | `AgentExecutor` — container execution, session tracking, snapshot writing |
