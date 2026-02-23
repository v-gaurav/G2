import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger before imports
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock child_process
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

import { DockerRuntime } from './docker-runtime.js';

describe('DockerRuntime', () => {
  let runtime: DockerRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new DockerRuntime();
  });

  describe('bin', () => {
    it('returns "docker"', () => {
      expect(runtime.bin).toBe('docker');
    });
  });

  describe('readonlyMountArgs', () => {
    it('returns -v flag with :ro suffix', () => {
      const args = runtime.readonlyMountArgs('/host/path', '/container/path');
      expect(args).toEqual(['-v', '/host/path:/container/path:ro']);
    });
  });

  describe('readwriteMountArgs', () => {
    it('returns -v flag without :ro suffix', () => {
      const args = runtime.readwriteMountArgs('/host/path', '/container/path');
      expect(args).toEqual(['-v', '/host/path:/container/path']);
    });
  });

  describe('stopContainer', () => {
    it('returns docker stop command', () => {
      expect(runtime.stopContainer('g2-test-123')).toBe(
        'docker stop g2-test-123',
      );
    });
  });

  describe('ensureRunning', () => {
    it('succeeds when docker info succeeds', () => {
      mockExecSync.mockReturnValueOnce('');
      expect(() => runtime.ensureRunning()).not.toThrow();
    });

    it('throws when docker info fails', () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('Cannot connect to the Docker daemon');
      });
      expect(() => runtime.ensureRunning()).toThrow(
        'Container runtime is required but failed to start',
      );
    });
  });

  describe('cleanupOrphans', () => {
    it('stops orphaned containers', () => {
      mockExecSync.mockReturnValueOnce('g2-group1-111\n');
      mockExecSync.mockReturnValue('');

      runtime.cleanupOrphans();

      expect(mockExecSync).toHaveBeenCalledTimes(2);
    });

    it('does not throw when no containers exist', () => {
      mockExecSync.mockReturnValueOnce('');
      expect(() => runtime.cleanupOrphans()).not.toThrow();
    });

    it('does not throw when ps fails', () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('docker not available');
      });
      expect(() => runtime.cleanupOrphans()).not.toThrow();
    });
  });

  describe('IContainerRuntime conformance', () => {
    it('implements all interface methods', () => {
      expect(typeof runtime.bin).toBe('string');
      expect(typeof runtime.readonlyMountArgs).toBe('function');
      expect(typeof runtime.readwriteMountArgs).toBe('function');
      expect(typeof runtime.stopContainer).toBe('function');
      expect(typeof runtime.ensureRunning).toBe('function');
      expect(typeof runtime.cleanupOrphans).toBe('function');
    });
  });
});
