import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  archiveSession,
  getAllSessions,
  getSession,
  getSessionHistory,
  setSession,
} from './db.js';
import { SessionManager } from './session-manager.js';

let sm: SessionManager;

beforeEach(() => {
  _initTestDatabase();
  sm = new SessionManager();
});

describe('loadFromDb', () => {
  it('loads sessions from DB into memory', () => {
    setSession('group-a', 'sess-1');
    setSession('group-b', 'sess-2');

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
    expect(getSession('group-a')).toBe('sess-1');
  });

  it('overwrites existing session', () => {
    sm.set('group-a', 'sess-1');
    sm.set('group-a', 'sess-2');

    expect(sm.get('group-a')).toBe('sess-2');
    expect(getSession('group-a')).toBe('sess-2');
  });
});

describe('delete', () => {
  it('removes session from memory and DB', () => {
    sm.set('group-a', 'sess-1');
    sm.delete('group-a');

    expect(sm.get('group-a')).toBeUndefined();
    expect(getSession('group-a')).toBeUndefined();
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

describe('archive', () => {
  it('archives current session to history', () => {
    sm.set('group-a', 'sess-1');
    sm.archive('group-a', 'my-save');

    const history = getSessionHistory('group-a');
    expect(history).toHaveLength(1);
    expect(history[0].session_id).toBe('sess-1');
    expect(history[0].name).toBe('my-save');
  });

  it('does nothing when no session exists', () => {
    sm.archive('group-a', 'no-session');
    const history = getSessionHistory('group-a');
    expect(history).toHaveLength(0);
  });

  it('does nothing when no saveName provided', () => {
    sm.set('group-a', 'sess-1');
    sm.archive('group-a');
    const history = getSessionHistory('group-a');
    expect(history).toHaveLength(0);
  });
});

describe('restore', () => {
  it('restores a session from history', () => {
    // Archive a session manually via DB
    archiveSession('group-a', 'old-sess', 'saved', new Date().toISOString());
    const history = getSessionHistory('group-a');
    const historyId = history[0].id;

    const result = sm.restore('group-a', historyId);

    expect(result).toEqual({ sessionId: 'old-sess' });
    expect(sm.get('group-a')).toBe('old-sess');
    expect(getSession('group-a')).toBe('old-sess');
  });

  it('returns null for non-existent history entry', () => {
    const result = sm.restore('group-a', 99999);
    expect(result).toBeNull();
  });

  it('removes restored entry from history', () => {
    archiveSession('group-a', 'old-sess', 'saved', new Date().toISOString());
    const history = getSessionHistory('group-a');
    const historyId = history[0].id;

    sm.restore('group-a', historyId);

    const historyAfter = getSessionHistory('group-a');
    expect(historyAfter).toHaveLength(0);
  });
});

describe('getHistory', () => {
  it('returns session history for a group', () => {
    archiveSession('group-a', 'sess-1', 'save-1', new Date().toISOString());
    archiveSession('group-a', 'sess-2', 'save-2', new Date().toISOString());

    const history = sm.getHistory('group-a');
    expect(history).toHaveLength(2);
  });

  it('returns empty array for group with no history', () => {
    const history = sm.getHistory('nonexistent');
    expect(history).toHaveLength(0);
  });
});
