import { MAIN_GROUP_FOLDER } from '../infrastructure/Config.js';
import {
  ContainerOutput,
  ContainerRunner,
} from './ContainerRunner.js';
import { GroupQueue } from './ExecutionQueue.js';
import { logger } from '../infrastructure/Logger.js';
import { SessionManager } from '../sessions/SessionManager.js';
import { AvailableGroup, SnapshotWriter } from '../scheduling/SnapshotWriter.js';
import { RegisteredGroup } from '../types.js';

export class AgentExecutor {
  private readonly containerRunner: ContainerRunner;
  private readonly snapshotWriter: SnapshotWriter;

  constructor(private deps: {
    sessionManager: SessionManager;
    queue: GroupQueue;
    getAvailableGroups: () => AvailableGroup[];
    getRegisteredGroups: () => Record<string, RegisteredGroup>;
    snapshotWriter: SnapshotWriter;
    containerRunner: ContainerRunner;
  }) {
    this.containerRunner = deps.containerRunner;
    this.snapshotWriter = deps.snapshotWriter;
  }

  async execute(
    group: RegisteredGroup,
    prompt: string,
    chatJid: string,
    onOutput?: (output: ContainerOutput) => Promise<void>,
  ): Promise<'success' | 'error'> {
    const isMain = group.folder === MAIN_GROUP_FOLDER;
    const sessionId = this.deps.sessionManager.get(group.folder);

    // Write all snapshots for the container to read
    const availableGroups = this.deps.getAvailableGroups();
    const conversationArchives = this.deps.sessionManager.getArchives(group.folder);
    this.snapshotWriter.prepareForExecution(
      group.folder,
      isMain,
      availableGroups,
      new Set(Object.keys(this.deps.getRegisteredGroups())),
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
      const output = await this.containerRunner.run(
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
