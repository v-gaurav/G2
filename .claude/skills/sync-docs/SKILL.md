---
name: sync-docs
description: Synchronize documentation with actual codebase structure after refactoring. Scans source files, cross-references all doc files, and fixes stale paths, missing files, outdated descriptions, and inaccurate language.
---

# Sync Documentation After Refactoring

Run this skill after any major refactoring to ensure all documentation reflects the actual codebase.

## Step 1: Scan the Actual Codebase

Build a map of every source file and what it contains.

### Source files

```bash
# All non-test TypeScript files in src/ (the authoritative file list)
find src -name '*.ts' ! -name '*.test.ts' | sort
```

For each file, note:
- Exported classes, interfaces, functions, constants (read the file)
- Which directory it's in (`src/`, `src/channels/`, `src/interfaces/`, `src/ipc-handlers/`, etc.)

### Container files

```bash
find container -name '*.ts' -o -name '*.md' -o -name 'Dockerfile' -o -name '*.sh' | sort
```

### Group structure

```bash
ls -la groups/
ls groups/*/CLAUDE.md 2>/dev/null
```

### Skill intent files

```bash
find .claude/skills -name '*.intent.md' 2>/dev/null
```

## Step 2: Read All Documentation Files

Read every documentation file that references codebase structure:

| File | What to check |
|------|--------------|
| `CLAUDE.md` | Key Files tables — every non-test `src/` file should appear |
| `README.md` | Architecture "Key files" list, philosophy language |
| `docs/SPEC.md` | Folder Structure tree — must mirror actual `src/` layout |
| `docs/REQUIREMENTS.md` | Design Patterns section — must name actual interfaces, classes, modules |
| `.claude/skills/*/modify/*.intent.md` | File paths in intent headers must still exist |

Also read these for any stale `src/` file references (they usually don't have them, but check):
- `docs/SECURITY.md`
- `docs/DEBUG_CHECKLIST.md`

## Step 3: Cross-Reference and Identify Issues

For each documentation file, check for these categories of staleness:

### 3a. Missing files (source file exists but not documented)

Compare the `find src` output against what's listed in:
- `CLAUDE.md` Key Files tables
- `docs/SPEC.md` Folder Structure tree

Every non-test `.ts` file in `src/` should appear in both. If a file is missing from the docs, add it with an accurate description based on reading its exports.

### 3b. Ghost references (doc mentions a file that doesn't exist)

For every `src/...` path mentioned in any doc file, verify the file actually exists. Remove or update references to deleted/renamed files.

### 3c. Stale descriptions

For files that exist in both the codebase and docs, verify the description is still accurate. Read the file's exports and compare against the documented purpose. Update if the file's role has changed.

### 3d. Missing directories

If new directories were added under `src/` (e.g., `src/interfaces/`, `src/ipc-handlers/`), they need:
- A section in `CLAUDE.md` Key Files
- A directory entry in `docs/SPEC.md` Folder Structure
- Mention in `docs/REQUIREMENTS.md` Design Patterns if they represent a pattern

### 3e. Stale language

Check for phrases that may no longer be accurate after refactoring:
- "handful of files", "a few source files", "minimal glue code" — may understate a now-modular codebase
- "no abstraction layers" — inaccurate if interfaces/ directory exists
- Any count of files that's now wrong

Grep for these patterns:
```bash
grep -rn 'handful\|few source\|few files\|minimal glue\|no abstraction' CLAUDE.md README.md docs/REQUIREMENTS.md docs/SPEC.md
```

### 3f. Stale intent files

For each `.intent.md` file under `.claude/skills/`, verify the source file path in its header (`# Intent: src/foo.ts modifications`) still exists. If the file was renamed or moved, the intent file header is stale.

```bash
for f in $(find .claude/skills -name '*.intent.md'); do
  # Extract the referenced path from the filename (e.g., src/config.ts.intent.md -> src/config.ts)
  dir=$(dirname "$f" | sed 's|.claude/skills/[^/]*/modify/||')
  base=$(basename "$f" .intent.md)
  ref="$dir/$base"
  [ -f "$ref" ] || echo "STALE: $f references $ref (not found)"
done
```

### 3g. Container skill paths

Verify `container/skills/` paths in docs match actual structure:
```bash
find container/skills -type f | sort
```

## Step 4: Apply Fixes

For each issue found, make the edit directly. Follow these rules:

- **CLAUDE.md**: Organize Key Files into categorized tables by directory (Core, Channels & Routing, Container & Execution, IPC Handlers, Interfaces, Security & Validation, Other). Every non-test source file gets a row.
- **README.md**: The Architecture "Key files" list should be a curated summary (not exhaustive) — list the most important files plus directory-level entries for `src/interfaces/` and `src/ipc-handlers/`.
- **docs/SPEC.md**: The Folder Structure tree must show every file and directory exactly as they exist on disk.
- **docs/REQUIREMENTS.md**: The Design Patterns section should name actual classes/interfaces/functions. Architecture Decisions subsections should reference the modules that implement them.
- **Language fixes**: Replace stale phrases with accurate ones. Don't overstate or understate the codebase size.

## Step 5: Verify

After all edits, do a final sanity check:

```bash
# Every src/ file path mentioned in docs should exist
grep -roh 'src/[a-zA-Z0-9_\-/]*\.ts' CLAUDE.md README.md docs/SPEC.md docs/REQUIREMENTS.md | sort -u | while read f; do
  [ -f "$f" ] || echo "BROKEN REF: $f"
done

# Every container/ path mentioned in docs should exist
grep -roh 'container/[a-zA-Z0-9_\-/]*\.[a-z]*' CLAUDE.md README.md docs/SPEC.md docs/REQUIREMENTS.md | sort -u | while read f; do
  [ -f "$f" ] || echo "BROKEN REF: $f"
done
```

If any broken refs remain, fix them.

## What This Skill Does NOT Do

- Does not update `groups/*/CLAUDE.md` (those are per-group agent memory, not project docs)
- Does not update `docs/SDK_DEEP_DIVE.md` (SDK reference, not codebase structure)
- Does not update `docs/APPLE-CONTAINER-NETWORKING.md` (networking guide, not codebase structure)
- Does not update `docs/g2-architecture-final.md` or `docs/g2-nanorepo-architecture.md` (skills system architecture, not source structure)
- Does not modify source code — only documentation files
