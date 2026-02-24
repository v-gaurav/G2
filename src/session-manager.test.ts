import { describe, it, expect, beforeEach, vi } from 'vitest';

import { database } from './db.js';
import { SessionManager } from './session-manager.js';

// Mock archive-utils to avoid filesystem dependency
vi.mock('./ipc-handlers/archive-utils.js', () => ({
  readAndFormatTranscript: vi.fn(() => '# Transcript\n\nMocked content'),
}));

let sm: SessionManager;

beforeEach(() => {
  database._initTest();
  sm = new SessionManager(database.sessionRepo);
});

describe('loadFromDb', () => {
  it('loads sessions from DB into memory', () => {
    database.setSession('group-a', 'sess-1');
    database.setSession('group-b', 'sess-2');

    sm.loadFromDb();

    expect(sm.get('group-a')).toBe('sess-1');
    expect(sm.get('group-b')).toBe('sess-2');
  });

  it('starts empty when DB has no sessions', () => {
    sm.loadFromDb();
    expect(sm.getAll()).toEqual({});
  });
});

describe('get', () => {
  it('returns undefined for non-existent session', () => {
    expect(sm.get('nonexistent')).toBeUndefined();
  });

  it('returns session after set', () => {
    sm.set('group-a', 'sess-1');
    expect(sm.get('group-a')).toBe('sess-1');
  });
});

describe('set', () => {
  it('sets session in memory and DB', () => {
    sm.set('group-a', 'sess-1');

    // Memory
    expect(sm.get('group-a')).toBe('sess-1');
    // DB
    expect(database.getSession('group-a')).toBe('sess-1');
  });

  it('overwrites existing session', () => {
    sm.set('group-a', 'sess-1');
    sm.set('group-a', 'sess-2');

    expect(sm.get('group-a')).toBe('sess-2');
    expect(database.getSession('group-a')).toBe('sess-2');
  });
});

describe('delete', () => {
  it('removes session from memory and DB', () => {
    sm.set('group-a', 'sess-1');
    sm.delete('group-a');

    expect(sm.get('group-a')).toBeUndefined();
    expect(database.getSession('group-a')).toBeUndefined();
  });

  it('does not throw when deleting non-existent session', () => {
    expect(() => sm.delete('nonexistent')).not.toThrow();
  });
});

describe('getAll', () => {
  it('returns a copy of all sessions', () => {
    sm.set('group-a', 'sess-1');
    sm.set('group-b', 'sess-2');

    const all = sm.getAll();
    expect(all).toEqual({ 'group-a': 'sess-1', 'group-b': 'sess-2' });

    // Verify it's a copy (mutation doesn't affect internal state)
    all['group-c'] = 'sess-3';
    expect(sm.get('group-c')).toBeUndefined();
  });
});

// --- Archive lifecycle ---

describe('archive', () => {
  it('inserts a conversation archive', () => {
    sm.archive('group-a', 'sess-1', 'my-archive', 'transcript content');

    const archives = sm.getArchives('group-a');
    expect(archives).toHaveLength(1);
    expect(archives[0].name).toBe('my-archive');
    expect(archives[0].session_id).toBe('sess-1');
  });
});

describe('getArchives', () => {
  it('returns archives for a group', () => {
    sm.archive('group-a', 'sess-1', 'first', 'content1');
    sm.archive('group-a', 'sess-2', 'second', 'content2');
    sm.archive('group-b', 'sess-3', 'other', 'content3');

    const archives = sm.getArchives('group-a');
    expect(archives).toHaveLength(2);
  });

  it('returns empty array for group with no archives', () => {
    expect(sm.getArchives('group-x')).toHaveLength(0);
  });
});

describe('getArchiveById', () => {
  it('returns archive by ID', () => {
    sm.archive('group-a', 'sess-1', 'my-archive', 'transcript content');
    const archives = sm.getArchives('group-a');
    const archive = sm.getArchiveById(archives[0].id);
    expect(archive).toBeDefined();
    expect(archive!.name).toBe('my-archive');
    expect(archive!.content).toBe('transcript content');
  });

  it('returns undefined for non-existent ID', () => {
    expect(sm.getArchiveById(999)).toBeUndefined();
  });
});

describe('search', () => {
  it('searches archives by content', () => {
    sm.archive('group-a', 'sess-1', 'first', 'hello world');
    sm.archive('group-a', 'sess-2', 'second', 'goodbye world');
    sm.archive('group-a', 'sess-3', 'third', 'hello again');

    const results = sm.search('group-a', 'hello');
    expect(results).toHaveLength(2);
  });

  it('returns all archives for empty query', () => {
    sm.archive('group-a', 'sess-1', 'first', 'content1');
    sm.archive('group-a', 'sess-2', 'second', 'content2');

    const results = sm.search('group-a', '');
    expect(results).toHaveLength(2);
  });
});

describe('deleteArchive', () => {
  it('deletes an archive by ID', () => {
    sm.archive('group-a', 'sess-1', 'my-archive', 'content');
    const archives = sm.getArchives('group-a');
    sm.deleteArchive(archives[0].id);
    expect(sm.getArchives('group-a')).toHaveLength(0);
  });
});

describe('clear', () => {
  it('deletes the current session', () => {
    sm.set('group-a', 'sess-1');
    sm.clear('group-a');
    expect(sm.get('group-a')).toBeUndefined();
  });

  it('archives current session when saveName provided', () => {
    sm.set('group-a', 'sess-1');
    sm.clear('group-a', 'my-save');

    expect(sm.get('group-a')).toBeUndefined();
    const archives = sm.getArchives('group-a');
    expect(archives).toHaveLength(1);
    expect(archives[0].name).toBe('my-save');
    expect(archives[0].session_id).toBe('sess-1');
  });

  it('does not archive when no current session', () => {
    sm.clear('group-a', 'my-save');
    expect(sm.getArchives('group-a')).toHaveLength(0);
  });
});

describe('resume', () => {
  it('restores archived session and removes archive', () => {
    sm.archive('group-a', 'old-sess', 'saved', 'content');
    const archives = sm.getArchives('group-a');

    const restoredId = sm.resume('group-a', archives[0].id);

    expect(restoredId).toBe('old-sess');
    expect(sm.get('group-a')).toBe('old-sess');
    expect(sm.getArchives('group-a')).toHaveLength(0);
  });

  it('archives current session before resuming when saveName provided', () => {
    sm.set('group-a', 'current-sess');
    sm.archive('group-a', 'old-sess', 'saved', 'content');
    const archives = sm.getArchives('group-a');

    sm.resume('group-a', archives[0].id, 'backup');

    expect(sm.get('group-a')).toBe('old-sess');
    const newArchives = sm.getArchives('group-a');
    expect(newArchives).toHaveLength(1);
    expect(newArchives[0].session_id).toBe('current-sess');
    expect(newArchives[0].name).toBe('backup');
  });

  it('throws for non-existent archive ID', () => {
    expect(() => sm.resume('group-a', 999)).toThrow('Conversation archive entry not found');
  });
});
