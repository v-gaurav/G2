import { describe, it, expect, beforeEach } from 'vitest';

import { database } from '../infrastructure/Database.js';
import { TaskManager } from './TaskService.js';

let tm: TaskManager;

beforeEach(() => {
  database._initTest();
  tm = new TaskManager(database.taskRepo);
});

// --- create ---

describe('create', () => {
  it('creates a task with cron schedule', () => {
    const id = tm.create({
      groupFolder: 'main',
      chatJid: 'main@g.us',
      prompt: 'cron task',
      scheduleType: 'cron',
      scheduleValue: '0 9 * * *',
      contextMode: 'isolated',
    });

    const task = tm.getById(id);
    expect(task).toBeDefined();
    expect(task!.schedule_type).toBe('cron');
    expect(task!.next_run).toBeTruthy();
    expect(new Date(task!.next_run!).getTime()).toBeGreaterThan(Date.now() - 60000);
  });

  it('creates a task with interval schedule', () => {
    const before = Date.now();
    const id = tm.create({
      groupFolder: 'main',
      chatJid: 'main@g.us',
      prompt: 'interval task',
      scheduleType: 'interval',
      scheduleValue: '3600000',
      contextMode: 'isolated',
    });

    const task = tm.getById(id);
    expect(task).toBeDefined();
    const nextRun = new Date(task!.next_run!).getTime();
    expect(nextRun).toBeGreaterThanOrEqual(before + 3600000 - 1000);
    expect(nextRun).toBeLessThanOrEqual(Date.now() + 3600000 + 1000);
  });

  it('creates a task with once schedule', () => {
    const id = tm.create({
      groupFolder: 'main',
      chatJid: 'main@g.us',
      prompt: 'once task',
      scheduleType: 'once',
      scheduleValue: '2025-06-01T00:00:00.000Z',
      contextMode: 'isolated',
    });

    const task = tm.getById(id);
    expect(task).toBeDefined();
    expect(task!.next_run).toBe('2025-06-01T00:00:00.000Z');
  });

  it('throws on invalid cron expression', () => {
    expect(() =>
      tm.create({
        groupFolder: 'main',
        chatJid: 'main@g.us',
        prompt: 'bad cron',
        scheduleType: 'cron',
        scheduleValue: 'not a cron',
        contextMode: 'isolated',
      }),
    ).toThrow('Invalid cron expression');
  });

  it('throws on invalid interval (non-numeric)', () => {
    expect(() =>
      tm.create({
        groupFolder: 'main',
        chatJid: 'main@g.us',
        prompt: 'bad interval',
        scheduleType: 'interval',
        scheduleValue: 'abc',
        contextMode: 'isolated',
      }),
    ).toThrow('Invalid interval');
  });

  it('throws on invalid interval (zero)', () => {
    expect(() =>
      tm.create({
        groupFolder: 'main',
        chatJid: 'main@g.us',
        prompt: 'zero interval',
        scheduleType: 'interval',
        scheduleValue: '0',
        contextMode: 'isolated',
      }),
    ).toThrow('Invalid interval');
  });

  it('throws on invalid once timestamp', () => {
    expect(() =>
      tm.create({
        groupFolder: 'main',
        chatJid: 'main@g.us',
        prompt: 'bad once',
        scheduleType: 'once',
        scheduleValue: 'not-a-date',
        contextMode: 'isolated',
      }),
    ).toThrow('Invalid timestamp');
  });
});

// --- getAll / getForGroup ---

describe('getAll and getForGroup', () => {
  it('returns all tasks', () => {
    tm.create({ groupFolder: 'main', chatJid: 'main@g.us', prompt: 'a', scheduleType: 'once', scheduleValue: '2025-06-01T00:00:00.000Z', contextMode: 'isolated' });
    tm.create({ groupFolder: 'other', chatJid: 'other@g.us', prompt: 'b', scheduleType: 'once', scheduleValue: '2025-06-01T00:00:00.000Z', contextMode: 'isolated' });

    expect(tm.getAll()).toHaveLength(2);
  });

  it('filters by group folder', () => {
    tm.create({ groupFolder: 'main', chatJid: 'main@g.us', prompt: 'a', scheduleType: 'once', scheduleValue: '2025-06-01T00:00:00.000Z', contextMode: 'isolated' });
    tm.create({ groupFolder: 'other', chatJid: 'other@g.us', prompt: 'b', scheduleType: 'once', scheduleValue: '2025-06-01T00:00:00.000Z', contextMode: 'isolated' });

    expect(tm.getForGroup('main')).toHaveLength(1);
    expect(tm.getForGroup('main')[0].prompt).toBe('a');
  });
});

// --- pause / resume / cancel ---

describe('lifecycle', () => {
  let taskId: string;

  beforeEach(() => {
    taskId = tm.create({
      groupFolder: 'main',
      chatJid: 'main@g.us',
      prompt: 'lifecycle task',
      scheduleType: 'once',
      scheduleValue: '2025-06-01T00:00:00.000Z',
      contextMode: 'isolated',
    });
  });

  it('pauses a task', () => {
    tm.pause(taskId);
    expect(tm.getById(taskId)!.status).toBe('paused');
  });

  it('resumes a paused task', () => {
    tm.pause(taskId);
    tm.resume(taskId);
    expect(tm.getById(taskId)!.status).toBe('active');
  });

  it('cancels (deletes) a task', () => {
    tm.cancel(taskId);
    expect(tm.getById(taskId)).toBeUndefined();
  });
});

// --- getDueTasks / claim ---

describe('getDueTasks and claim', () => {
  it('returns tasks with next_run in the past', () => {
    tm.create({
      groupFolder: 'main',
      chatJid: 'main@g.us',
      prompt: 'due now',
      scheduleType: 'once',
      scheduleValue: new Date(Date.now() - 60000).toISOString(),
      contextMode: 'isolated',
    });

    const due = tm.getDueTasks();
    expect(due).toHaveLength(1);
  });

  it('claim returns true and nullifies next_run', () => {
    const id = tm.create({
      groupFolder: 'main',
      chatJid: 'main@g.us',
      prompt: 'claimable',
      scheduleType: 'once',
      scheduleValue: new Date(Date.now() - 60000).toISOString(),
      contextMode: 'isolated',
    });

    expect(tm.claim(id)).toBe(true);
    expect(tm.getById(id)!.next_run).toBeNull();

    // Second claim fails (already claimed)
    expect(tm.claim(id)).toBe(false);
  });
});

// --- completeRun ---

describe('completeRun', () => {
  it('logs success and computes next_run for cron task', () => {
    const id = tm.create({
      groupFolder: 'main',
      chatJid: 'main@g.us',
      prompt: 'cron task',
      scheduleType: 'cron',
      scheduleValue: '0 9 * * *',
      contextMode: 'isolated',
    });

    const task = tm.getById(id)!;
    tm.completeRun(task, 1000, 'Result text', null);

    const updated = tm.getById(id)!;
    expect(updated.last_result).toContain('Result text');
    expect(updated.next_run).toBeTruthy();
    expect(updated.status).toBe('active');
  });

  it('logs error and computes next_run for interval task', () => {
    const id = tm.create({
      groupFolder: 'main',
      chatJid: 'main@g.us',
      prompt: 'interval task',
      scheduleType: 'interval',
      scheduleValue: '3600000',
      contextMode: 'isolated',
    });

    const task = tm.getById(id)!;
    tm.completeRun(task, 500, null, 'Something failed');

    const updated = tm.getById(id)!;
    expect(updated.last_result).toContain('Error: Something failed');
    expect(updated.next_run).toBeTruthy();
  });

  it('marks once task as completed (no next_run)', () => {
    const id = tm.create({
      groupFolder: 'main',
      chatJid: 'main@g.us',
      prompt: 'once task',
      scheduleType: 'once',
      scheduleValue: '2025-06-01T00:00:00.000Z',
      contextMode: 'isolated',
    });

    const task = tm.getById(id)!;
    tm.completeRun(task, 200, 'Done', null);

    const updated = tm.getById(id)!;
    expect(updated.next_run).toBeNull();
    expect(updated.status).toBe('completed');
  });
});

// --- getAuthorized ---

describe('getAuthorized', () => {
  it('returns task when authorized (main group)', () => {
    const id = tm.create({
      groupFolder: 'other',
      chatJid: 'other@g.us',
      prompt: 'task',
      scheduleType: 'once',
      scheduleValue: '2025-06-01T00:00:00.000Z',
      contextMode: 'isolated',
    });

    const task = tm.getAuthorized(id, 'main', true);
    expect(task.id).toBe(id);
  });

  it('returns task when authorized (own group)', () => {
    const id = tm.create({
      groupFolder: 'other',
      chatJid: 'other@g.us',
      prompt: 'task',
      scheduleType: 'once',
      scheduleValue: '2025-06-01T00:00:00.000Z',
      contextMode: 'isolated',
    });

    const task = tm.getAuthorized(id, 'other', false);
    expect(task.id).toBe(id);
  });

  it('throws when task not found', () => {
    expect(() => tm.getAuthorized('nonexistent', 'main', true)).toThrow('Task not found');
  });

  it('throws when unauthorized', () => {
    const id = tm.create({
      groupFolder: 'main',
      chatJid: 'main@g.us',
      prompt: 'task',
      scheduleType: 'once',
      scheduleValue: '2025-06-01T00:00:00.000Z',
      contextMode: 'isolated',
    });

    expect(() => tm.getAuthorized(id, 'other', false)).toThrow('Unauthorized');
  });
});
