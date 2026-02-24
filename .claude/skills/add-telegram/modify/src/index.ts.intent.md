# Intent: src/index.ts modifications

## What changed
Added Telegram as a channel option alongside WhatsApp, using the `Orchestrator` + `addChannel()` pattern.

## Key sections

### Imports (top of file)
- Added: `TelegramChannel` from `./channels/telegram.js`
- Added: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ONLY` from `./config.js`
- Kept: All current imports (`WhatsAppChannel`, `Orchestrator`, `storeChatMetadata`, `storeMessage`, `logger`, `NewMessage`)

### main()
- Changed: WhatsApp creation wrapped in `if (!TELEGRAM_ONLY)` conditional
- Added: conditional Telegram creation (`if (TELEGRAM_BOT_TOKEN)`) with `orchestrator.addChannel(telegram)`
- Unchanged: `channelOpts` shared callback object
- Unchanged: `await orchestrator.start()` at the end

## Invariants
- The `Orchestrator` class (in `orchestrator.ts`) is completely unchanged — it's channel-agnostic
- All orchestrator internals (ChannelRegistry, SessionManager, message processing, idle timers, trigger validation) are untouched
- The `getAvailableGroups` and `_setRegisteredGroups` exports are unchanged
- The `isDirectRun` guard at bottom is unchanged

## Must-keep
- The `Orchestrator` re-export
- The `getAvailableGroups` and `_setRegisteredGroups` exports
- The `isDirectRun` guard at bottom
- The `channelOpts` pattern with `registeredGroups: () => orchestrator.getRegisteredGroups()`
