import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
vi.mock('../config.js', () => ({
  DATA_DIR: '/tmp/g2-test-data',
  GROUPS_DIR: '/tmp/g2-test-groups',
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => ''),
      readdirSync: vi.fn(() => []),
      statSync: vi.fn(() => ({ isDirectory: () => false })),
      copyFileSync: vi.fn(),
    },
  };
});

// Mock mount-security
vi.mock('../mount-security.js', () => ({
  validateAdditionalMounts: vi.fn(() => []),
}));

import fs from 'fs';
import { DefaultMountFactory } from './default-mount-factory.js';
import type { IContainerRuntime } from './container-runtime.js';
import type { RegisteredGroup } from '../types.js';

function createMockRuntime(): IContainerRuntime {
  return {
    bin: 'mock-runtime',
    readonlyMountArgs: vi.fn((host: string, container: string) => ['-v', `${host}:${container}:ro`]),
    readwriteMountArgs: vi.fn((host: string, container: string) => ['-v', `${host}:${container}`]),
    stopContainer: vi.fn((name: string) => `mock-runtime stop ${name}`),
    ensureRunning: vi.fn(),
    cleanupOrphans: vi.fn(),
  };
}

const testGroup: RegisteredGroup = {
  name: 'Test Group',
  folder: 'test-group',
  trigger: '@G2',
  added_at: new Date().toISOString(),
};

describe('DefaultMountFactory', () => {
  let mockRuntime: IContainerRuntime;
  let factory: DefaultMountFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntime = createMockRuntime();
    factory = new DefaultMountFactory(mockRuntime);
  });

  describe('buildMounts for non-main group', () => {
    it('includes group folder mount', () => {
      const mounts = factory.buildMounts(testGroup, false);
      const groupMount = mounts.find(m => m.containerPath === '/workspace/group');
      expect(groupMount).toBeDefined();
      expect(groupMount!.readonly).toBe(false);
      expect(groupMount!.hostPath).toContain('test-group');
    });

    it('includes Claude sessions mount', () => {
      const mounts = factory.buildMounts(testGroup, false);
      const sessionsMount = mounts.find(m => m.containerPath === '/home/node/.claude');
      expect(sessionsMount).toBeDefined();
      expect(sessionsMount!.readonly).toBe(false);
    });

    it('includes IPC mount', () => {
      const mounts = factory.buildMounts(testGroup, false);
      const ipcMount = mounts.find(m => m.containerPath === '/workspace/ipc');
      expect(ipcMount).toBeDefined();
      expect(ipcMount!.readonly).toBe(false);
    });

    it('includes agent-runner source mount (readonly)', () => {
      const mounts = factory.buildMounts(testGroup, false);
      const agentRunnerMount = mounts.find(m => m.containerPath === '/app/src');
      expect(agentRunnerMount).toBeDefined();
      expect(agentRunnerMount!.readonly).toBe(true);
    });

    it('does not include project root mount', () => {
      const mounts = factory.buildMounts(testGroup, false);
      const projectMount = mounts.find(m => m.containerPath === '/workspace/project');
      expect(projectMount).toBeUndefined();
    });

    it('includes global dir if it exists', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (typeof p === 'string' && p.includes('global')) return true;
        return false;
      });

      const mounts = factory.buildMounts(testGroup, false);
      const globalMount = mounts.find(m => m.containerPath === '/workspace/global');
      expect(globalMount).toBeDefined();
      expect(globalMount!.readonly).toBe(true);
    });
  });

  describe('buildMounts for main group', () => {
    it('includes project root mount', () => {
      const mounts = factory.buildMounts(testGroup, true);
      const projectMount = mounts.find(m => m.containerPath === '/workspace/project');
      expect(projectMount).toBeDefined();
      expect(projectMount!.readonly).toBe(false);
    });

    it('includes group folder mount', () => {
      const mounts = factory.buildMounts(testGroup, true);
      const groupMount = mounts.find(m => m.containerPath === '/workspace/group');
      expect(groupMount).toBeDefined();
    });

    it('does not include global dir mount for main', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const mounts = factory.buildMounts(testGroup, true);
      const globalMount = mounts.find(m => m.containerPath === '/workspace/global');
      // Main group does NOT get the global dir (it gets the whole project)
      expect(globalMount).toBeUndefined();
    });
  });

  describe('session directory setup', () => {
    it('creates session directory', () => {
      factory.buildMounts(testGroup, false);
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('sessions/test-group/.claude'),
        { recursive: true },
      );
    });

    it('writes settings.json when it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      factory.buildMounts(testGroup, false);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('settings.json'),
        expect.stringContaining('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'),
      );
    });
  });

  describe('IPC directory setup', () => {
    it('creates IPC subdirectories', () => {
      factory.buildMounts(testGroup, false);
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('ipc/test-group/messages'),
        { recursive: true },
      );
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('ipc/test-group/tasks'),
        { recursive: true },
      );
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('ipc/test-group/input'),
        { recursive: true },
      );
    });
  });

  describe('AWS credentials mount', () => {
    it('includes .aws mount when directory exists', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (typeof p === 'string' && p.includes('.aws')) return true;
        return false;
      });

      const mounts = factory.buildMounts(testGroup, false);
      const awsMount = mounts.find(m => m.containerPath === '/home/node/.aws');
      expect(awsMount).toBeDefined();
      expect(awsMount!.readonly).toBe(true);
    });

    it('skips .aws mount when directory does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const mounts = factory.buildMounts(testGroup, false);
      const awsMount = mounts.find(m => m.containerPath === '/home/node/.aws');
      expect(awsMount).toBeUndefined();
    });
  });

  describe('additional mounts', () => {
    it('calls validateAdditionalMounts when containerConfig has mounts', async () => {
      const { validateAdditionalMounts } = await import('../mount-security.js');
      const groupWithMounts: RegisteredGroup = {
        ...testGroup,
        containerConfig: {
          additionalMounts: [
            { hostPath: '/extra/path' },
          ],
        },
      };

      factory.buildMounts(groupWithMounts, false);
      expect(validateAdditionalMounts).toHaveBeenCalledWith(
        [{ hostPath: '/extra/path' }],
        'Test Group',
        false,
      );
    });
  });
});
