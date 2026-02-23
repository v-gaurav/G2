import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  getAllSessions,
  getSession,
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
