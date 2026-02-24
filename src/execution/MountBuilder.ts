/**
 * IMountFactory — abstraction for building container volume mounts.
 * Decouples mount logic from container-runner so it can be tested and swapped.
 *
 * DefaultMountFactory — builds container volume mounts.
 * Uses an IContainerRuntime for mount arg generation.
 *
 * prepare() handles side effects (directory creation, file writes).
 * buildMounts() is pure — returns mount list assuming dirs already exist.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { GROUPS_DIR } from '../infrastructure/Config.js';
import { GroupPaths } from '../groups/GroupPaths.js';
import { validateAdditionalMounts } from './MountSecurity.js';
import type { RegisteredGroup } from '../types.js';
import type { IContainerRuntime } from './ContainerRuntime.js';

export interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

export interface IMountFactory {
  /** Create directories, write settings, sync skills — all side effects. */
  prepare(group: RegisteredGroup, isMain: boolean): void;

  /** Build the full list of volume mounts for a container run. Pure — assumes dirs exist. */
  buildMounts(group: RegisteredGroup, isMain: boolean): VolumeMount[];
}

function getHomeDir(): string {
  const home = process.env.HOME || os.homedir();
  if (!home) {
    throw new Error(
      'Unable to determine home directory: HOME environment variable is not set and os.homedir() returned empty',
    );
  }
  return home;
}

export class DefaultMountFactory implements IMountFactory {
  constructor(private readonly runtime: IContainerRuntime) {}

  /**
   * Create directories, write settings.json, sync skills — all side effects.
   * Must be called before buildMounts() for the first run.
   */
  prepare(group: RegisteredGroup, _isMain: boolean): void {
    // Per-group Claude sessions directory
    const groupSessionsDir = GroupPaths.sessionsDir(group.folder);
    fs.mkdirSync(groupSessionsDir, { recursive: true });

    const settingsFile = path.join(groupSessionsDir, 'settings.json');
    if (!fs.existsSync(settingsFile)) {
      fs.writeFileSync(settingsFile, JSON.stringify({
        env: {
          CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
          CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
        },
      }, null, 2) + '\n');
    }

    // Sync skills from container/skills/ into each group's .claude/skills/
    const skillsSrc = path.join(process.cwd(), 'container', 'skills');
    const skillsDst = path.join(groupSessionsDir, 'skills');
    if (fs.existsSync(skillsSrc)) {
      for (const skillDir of fs.readdirSync(skillsSrc)) {
        const srcDir = path.join(skillsSrc, skillDir);
        if (!fs.statSync(srcDir).isDirectory()) continue;
        const dstDir = path.join(skillsDst, skillDir);
        fs.mkdirSync(dstDir, { recursive: true });
        for (const file of fs.readdirSync(srcDir)) {
          const srcFile = path.join(srcDir, file);
          const dstFile = path.join(dstDir, file);
          fs.copyFileSync(srcFile, dstFile);
        }
      }
    }

    // Per-group IPC namespace directories
    fs.mkdirSync(GroupPaths.ipcMessagesDir(group.folder), { recursive: true });
    fs.mkdirSync(GroupPaths.ipcTasksDir(group.folder), { recursive: true });
    fs.mkdirSync(GroupPaths.ipcInputDir(group.folder), { recursive: true });
    fs.mkdirSync(GroupPaths.ipcResponsesDir(group.folder), { recursive: true });
  }

  /**
   * Build the full list of volume mounts for a container run.
   * Pure: returns mount list assuming directories already exist (call prepare() first).
   */
  buildMounts(group: RegisteredGroup, isMain: boolean): VolumeMount[] {
    const mounts: VolumeMount[] = [];
    const projectRoot = process.cwd();

    if (isMain) {
      mounts.push({
        hostPath: projectRoot,
        containerPath: '/workspace/project',
        readonly: false,
      });

      mounts.push({
        hostPath: GroupPaths.groupDir(group.folder),
        containerPath: '/workspace/group',
        readonly: false,
      });
    } else {
      mounts.push({
        hostPath: GroupPaths.groupDir(group.folder),
        containerPath: '/workspace/group',
        readonly: false,
      });

      const globalDir = path.join(GROUPS_DIR, 'global');
      if (fs.existsSync(globalDir)) {
        mounts.push({
          hostPath: globalDir,
          containerPath: '/workspace/global',
          readonly: true,
        });
      }
    }

    // Per-group Claude sessions directory
    mounts.push({
      hostPath: GroupPaths.sessionsDir(group.folder),
      containerPath: '/home/node/.claude',
      readonly: false,
    });

    // Per-group IPC namespace
    mounts.push({
      hostPath: GroupPaths.ipcDir(group.folder),
      containerPath: '/workspace/ipc',
      readonly: false,
    });

    // Mount agent-runner source from host
    const agentRunnerSrc = path.join(projectRoot, 'container', 'agent-runner', 'src');
    mounts.push({
      hostPath: agentRunnerSrc,
      containerPath: '/app/src',
      readonly: true,
    });

    // Mount AWS credentials directory (read-only) when using Bedrock
    const awsDir = path.join(getHomeDir(), '.aws');
    if (fs.existsSync(awsDir)) {
      mounts.push({
        hostPath: awsDir,
        containerPath: '/home/node/.aws',
        readonly: true,
      });
    }

    // Additional mounts validated against external allowlist
    if (group.containerConfig?.additionalMounts) {
      const validatedMounts = validateAdditionalMounts(
        group.containerConfig.additionalMounts,
        group.name,
        isMain,
      );
      mounts.push(...validatedMounts);
    }

    return mounts;
  }
}
