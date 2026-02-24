# Intent: src/index.ts modifications

## What changed
Added Telegram as a channel option alongside WhatsApp, using the `Orchestrator` + `addChannel()` pattern.

## Key sections

### Imports (top of file)
- Added: `TelegramChannel` from `./messaging/telegram/TelegramChannel.js`
- Added: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ONLY` from `./infrastructure/Config.js`
- Kept: All current imports (`WhatsAppChannel` from `./messaging/whatsapp/WhatsAppChannel.js`, `Orchestrator` from `./app.js`, `database` from `./infrastructure/Database.js`, `logger` from `./infrastructure/Logger.js`, `NewMessage` from `./types.js`)

### main()
- Changed: WhatsApp creation wrapped in `if (!TELEGRAM_ONLY)` conditional
- Added: conditional Telegram creation (`if (TELEGRAM_BOT_TOKEN)`) with `orchestrator.addChannel(telegram)`
- Unchanged: `channelOpts` shared callback object (uses `database.messageRepo.storeMessage` and `database.chatRepo.storeChatMetadata`)
- Unchanged: `await orchestrator.start()` at the end

## Invariants
- The `Orchestrator` class (in `app.ts`) is completely unchanged — it's channel-agnostic
- All orchestrator internals (ChannelRegistry, SessionManager, message processing, idle timers, trigger validation) are untouched
- The `getAvailableGroups` and `_setRegisteredGroups` exports are unchanged
- The `isDirectRun` guard at bottom is unchanged

## Must-keep
- The `Orchestrator` re-export from `./app.js`
- The `getAvailableGroups` and `_setRegisteredGroups` exports
- The `isDirectRun` guard at bottom
- The `channelOpts` pattern with `registeredGroups: () => orchestrator.getRegisteredGroups()`
