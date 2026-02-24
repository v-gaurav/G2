# Intent: src/routing.test.ts modifications

## What changed
Added Telegram JID pattern tests and Telegram-specific getAvailableGroups tests.

## Key sections

### JID ownership patterns
- Added: `Telegram JID: starts with tg:` test
- Added: `Telegram group JID: starts with tg: and has negative ID` test

### getAvailableGroups
- Added: `includes Telegram chat JIDs` test
- Added: `returns Telegram group JIDs with negative IDs` test
- Added: `marks registered Telegram chats correctly` test
- Added: `mixes WhatsApp and Telegram chats ordered by activity` test

## Invariants
- All existing WhatsApp JID pattern tests unchanged
- All existing getAvailableGroups tests unchanged (DM exclusion, sentinel exclusion, registration marking, ordering, empty array)
- Import pattern: `database` from `./infrastructure/Database.js`, functions from `./index.js`
- `database._initTest()` in beforeEach (not `_initTestDatabase()`)
- `database.chatRepo.storeChatMetadata(...)` calls (not bare `storeChatMetadata(...)`)

## Must-keep
- All existing test cases
- The `beforeEach` setup pattern
- The `database.chatRepo.storeChatMetadata` call pattern
- The `channel` field in registered group objects
