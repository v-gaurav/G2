import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../infrastructure/Logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock child_process — store the mock fn so tests can configure it
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

import { AppleContainerRuntime, DockerRuntime } from './ContainerRuntime.js';
import { logger } from '../infrastructure/Logger.js';

let runtime: AppleContainerRuntime;

beforeEach(() => {
  vi.clearAllMocks();
  runtime = new AppleContainerRuntime();
});

// --- Backward-compat alias ---

describe('DockerRuntime alias', () => {
  it('is the same class as AppleContainerRuntime', () => {
    expect(DockerRuntime).toBe(AppleContainerRuntime);
  });
});

// --- Pure methods ---

describe('readonlyMountArgs', () => {
  it('returns --mount flag with type=bind and readonly', () => {
    const args = runtime.readonlyMountArgs('/host/path', '/container/path');
    expect(args).toEqual([
      '--mount',
      'type=bind,source=/host/path,target=/container/path,readonly',
    ]);
  });
});

describe('readwriteMountArgs', () => {
  it('returns -v flag for read-write mount', () => {
    const args = runtime.readwriteMountArgs('/host/path', '/container/path');
    expect(args).toEqual(['-v', '/host/path:/container/path']);
  });
});

describe('stopContainer', () => {
  it('returns stop command using container binary', () => {
    expect(runtime.stopContainer('g2-test-123')).toBe(
      `${runtime.bin} stop g2-test-123`,
    );
  });
});

describe('bin', () => {
  it('returns container as the runtime binary', () => {
    expect(runtime.bin).toBe('container');
  });
});

// --- ensureRunning ---

describe('ensureRunning', () => {
  it('does nothing when runtime is already running', () => {
    mockExecSync.mockReturnValueOnce('');

    runtime.ensureRunning();

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith(
      `${runtime.bin} system status`,
      { stdio: 'pipe' },
    );
    expect(logger.debug).toHaveBeenCalledWith('Container runtime already running');
  });

  it('auto-starts when system status fails', () => {
    // First call (system status) fails
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('not running');
    });
    // Second call (system start) succeeds
    mockExecSync.mockReturnValueOnce('');

    runtime.ensureRunning();

    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      `${runtime.bin} system start`,
      { stdio: 'pipe', timeout: 30000 },
    );
    expect(logger.info).toHaveBeenCalledWith('Container runtime started');
  });

  it('throws when both status and start fail', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('failed');
    });

    expect(() => runtime.ensureRunning()).toThrow(
      'Container runtime is required but failed to start',
    );
    expect(logger.error).toHaveBeenCalled();
  });
});

// --- cleanupOrphans ---

describe('cleanupOrphans', () => {
  it('stops orphaned g2 containers from JSON output', () => {
    // Apple Container ls returns JSON
    const lsOutput = JSON.stringify([
      { status: 'running', configuration: { id: 'g2-group1-111' } },
      { status: 'stopped', configuration: { id: 'g2-group2-222' } },
      { status: 'running', configuration: { id: 'g2-group3-333' } },
      { status: 'running', configuration: { id: 'other-container' } },
    ]);
    mockExecSync.mockReturnValueOnce(lsOutput);
    // stop calls succeed
    mockExecSync.mockReturnValue('');

    runtime.cleanupOrphans();

    // ls + 2 stop calls (only running g2- containers)
    expect(mockExecSync).toHaveBeenCalledTimes(3);
    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      `${runtime.bin} stop g2-group1-111`,
      { stdio: 'pipe' },
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      3,
      `${runtime.bin} stop g2-group3-333`,
      { stdio: 'pipe' },
    );
    expect(logger.info).toHaveBeenCalledWith(
      { count: 2, names: ['g2-group1-111', 'g2-group3-333'] },
      'Stopped orphaned containers',
    );
  });

  it('does nothing when no orphans exist', () => {
    mockExecSync.mockReturnValueOnce('[]');

    runtime.cleanupOrphans();

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('warns and continues when ls fails', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('container not available');
    });

    runtime.cleanupOrphans(); // should not throw

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to clean up orphaned containers',
    );
  });

  it('continues stopping remaining containers when one stop fails', () => {
    const lsOutput = JSON.stringify([
      { status: 'running', configuration: { id: 'g2-a-1' } },
      { status: 'running', configuration: { id: 'g2-b-2' } },
    ]);
    mockExecSync.mockReturnValueOnce(lsOutput);
    // First stop fails
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('already stopped');
    });
    // Second stop succeeds
    mockExecSync.mockReturnValueOnce('');

    runtime.cleanupOrphans(); // should not throw

    expect(mockExecSync).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith(
      { count: 2, names: ['g2-a-1', 'g2-b-2'] },
      'Stopped orphaned containers',
    );
  });
});
