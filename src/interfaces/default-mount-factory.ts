/**
 * DefaultMountFactory — extracts the buildVolumeMounts logic from container-runner.ts.
 * Uses an IContainerRuntime for mount arg generation.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { GROUPS_DIR } from '../config.js';
import { GroupPaths } from '../group-paths.js';
import { validateAdditionalMounts } from '../mount-security.js';
import type { RegisteredGroup } from '../types.js';
import type { IContainerRuntime } from './container-runtime.js';
import type { IMountFactory, VolumeMount } from './mount-factory.js';

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

  buildMounts(group: RegisteredGroup, isMain: boolean): VolumeMount[] {
    const mounts: VolumeMount[] = [];
    const projectRoot = process.cwd();

    if (isMain) {
      // Main gets the entire project root mounted
      mounts.push({
        hostPath: projectRoot,
        containerPath: '/workspace/project',
        readonly: false,
      });

      // Main also gets its group folder as the working directory
      mounts.push({
        hostPath: GroupPaths.groupDir(group.folder),
        containerPath: '/workspace/group',
        readonly: false,
      });
    } else {
      // Other groups only get their own folder
      mounts.push({
        hostPath: GroupPaths.groupDir(group.folder),
        containerPath: '/workspace/group',
        readonly: false,
      });

      // Global memory directory (read-only for non-main)
      const globalDir = path.join(GROUPS_DIR, 'global');
      if (fs.existsSync(globalDir)) {
        mounts.push({
          hostPath: globalDir,
          containerPath: '/workspace/global',
          readonly: true,
        });
      }
    }

    // Per-group Claude sessions directory (isolated from other groups)
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
    mounts.push({
      hostPath: groupSessionsDir,
      containerPath: '/home/node/.claude',
      readonly: false,
    });

    // Per-group IPC namespace
    const groupIpcDir = GroupPaths.ipcDir(group.folder);
    fs.mkdirSync(GroupPaths.ipcMessagesDir(group.folder), { recursive: true });
    fs.mkdirSync(GroupPaths.ipcTasksDir(group.folder), { recursive: true });
    fs.mkdirSync(GroupPaths.ipcInputDir(group.folder), { recursive: true });
    fs.mkdirSync(GroupPaths.ipcResponsesDir(group.folder), { recursive: true });
    mounts.push({
      hostPath: groupIpcDir,
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
