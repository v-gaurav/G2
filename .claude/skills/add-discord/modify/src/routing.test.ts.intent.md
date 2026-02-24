# Intent: src/routing.test.ts modifications

## What changed
Added Discord JID pattern tests and Discord-specific getAvailableGroups tests.

## Key sections

### JID ownership patterns
- Added: `Discord JID: starts with dc:` test

### getAvailableGroups
- Added: `includes Discord channel JIDs` test
- Added: `marks registered Discord channels correctly` test
- Added: `mixes WhatsApp and Discord chats ordered by activity` test

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
