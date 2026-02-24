import { MAIN_GROUP_FOLDER } from './config.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeSessionHistorySnapshot,
} from './container-runner.js';
import type { AvailableGroup } from './container-runner.js';
import { getConversationArchives } from './db.js';
import { GroupQueue } from './group-queue.js';
import { logger } from './logger.js';
import { SessionManager } from './session-manager.js';
import { refreshTasksSnapshot } from './task-snapshots.js';
import { RegisteredGroup } from './types.js';

export class AgentExecutor {
  constructor(private deps: {
    sessionManager: SessionManager;
    queue: GroupQueue;
    getAvailableGroups: () => AvailableGroup[];
    getRegisteredGroups: () => Record<string, RegisteredGroup>;
  }) {}

  async execute(
    group: RegisteredGroup,
    prompt: string,
    chatJid: string,
    onOutput?: (output: ContainerOutput) => Promise<void>,
  ): Promise<'success' | 'error'> {
    const isMain = group.folder === MAIN_GROUP_FOLDER;
    const sessionId = this.deps.sessionManager.get(group.folder);

    // Update tasks snapshot for container to read (filtered by group)
    refreshTasksSnapshot(group.folder, isMain);

    // Update available groups snapshot (main group only can see all groups)
    const availableGroups = this.deps.getAvailableGroups();
    writeGroupsSnapshot(
      group.folder,
      isMain,
      availableGroups,
      new Set(Object.keys(this.deps.getRegisteredGroups())),
    );

    // Update session history snapshot for container to read
    const conversationArchives = getConversationArchives(group.folder);
    writeSessionHistorySnapshot(
      group.folder,
      conversationArchives.map((s) => ({
        id: s.id,
        name: s.name,
        session_id: s.session_id,
        archived_at: s.archived_at,
      })),
    );

    // Wrap onOutput to track session ID from streamed results
    const wrappedOnOutput = onOutput
      ? async (output: ContainerOutput) => {
          if (output.newSessionId) {
            this.deps.sessionManager.set(group.folder, output.newSessionId);
          }
          await onOutput(output);
        }
      : undefined;

    try {
      const output = await runContainerAgent(
        group,
        {
          prompt,
          sessionId,
          groupFolder: group.folder,
          chatJid,
          isMain,
        },
        (proc, containerName) => this.deps.queue.registerProcess(chatJid, proc, containerName, group.folder),
        wrappedOnOutput,
      );

      if (output.newSessionId) {
        this.deps.sessionManager.set(group.folder, output.newSessionId);
      }

      if (output.status === 'error') {
        logger.error(
          { group: group.name, error: output.error },
          'Container agent error',
        );
        return 'error';
      }

      return 'success';
    } catch (err) {
      logger.error({ group: group.name, err }, 'Agent error');
      return 'error';
    }
  }
}
