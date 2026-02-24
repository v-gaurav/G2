import fs from 'fs';

import { AgentExecutor } from './agent-executor.js';
import { ChannelRegistry } from './channel-registry.js';
import type { AvailableGroup } from './container-runner.js';
import { writeGroupsSnapshot } from './container-runner.js';
import { cleanupOrphans, ensureContainerRuntimeRunning } from './container-runtime.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  initDatabase,
  setRegisteredGroup,
} from './db.js';
import { GroupPaths } from './group-paths.js';
import { GroupQueue } from './group-queue.js';
import { startIpcWatcher } from './ipc.js';
import { logger } from './logger.js';
import { MessageProcessor } from './message-processor.js';
import { formatOutbound } from './router.js';
import { SessionManager } from './session-manager.js';
import { startSchedulerLoop } from './task-scheduler.js';
import type { Channel } from './types.js';
import { RegisteredGroup } from './types.js';

export class Orchestrator {
  private sessionManager: SessionManager;
  private registeredGroups: Record<string, RegisteredGroup> = {};

  private channelRegistry: ChannelRegistry;
  private queue: GroupQueue;

  private messageProcessor: MessageProcessor | null = null;
  private messageLoop: { stop: () => void } | null = null;

  constructor(deps?: {
    channelRegistry?: ChannelRegistry;
    queue?: GroupQueue;
    sessionManager?: SessionManager;
  }) {
    this.channelRegistry = deps?.channelRegistry ?? new ChannelRegistry();
    this.queue = deps?.queue ?? new GroupQueue();
    this.sessionManager = deps?.sessionManager ?? new SessionManager();
  }

  /**
   * Add a channel to the registry. Channels must be added before start().
   */
  addChannel(channel: Channel): void {
    this.channelRegistry.register(channel);
  }

  /**
   * Get the channel registry (for subsystems that need channel lookup).
   */
  getChannelRegistry(): ChannelRegistry {
    return this.channelRegistry;
  }

  /**
   * Get registered groups (used by channel callbacks and IPC).
   */
  getRegisteredGroups(): Record<string, RegisteredGroup> {
    return this.registeredGroups;
  }

  /**
   * Get available groups list for the agent.
   * Returns groups ordered by most recent activity.
   */
  getAvailableGroups(): AvailableGroup[] {
    const chats = getAllChats();
    const registeredJids = new Set(Object.keys(this.registeredGroups));

    return chats
      .filter((c) => c.jid !== '__group_sync__' && c.is_group)
      .map((c) => ({
        jid: c.jid,
        name: c.name,
        lastActivity: c.last_message_time,
        isRegistered: registeredJids.has(c.jid),
      }));
  }

  /** @internal - exported for testing */
  _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void {
    this.registeredGroups = groups;
  }

  /**
   * Register a new group (persists to DB and creates group folder).
   */
  registerGroup(jid: string, group: RegisteredGroup): void {
    this.registeredGroups[jid] = group;
    setRegisteredGroup(jid, group);

    // Create group folder
    fs.mkdirSync(GroupPaths.logsDir(group.folder), { recursive: true });

    logger.info(
      { jid, name: group.name, folder: group.folder },
      'Group registered',
    );
  }

  /**
   * Start the orchestrator: initialize DB, connect channels, start subsystems.
   */
  async start(): Promise<void> {
    this.ensureContainerSystemRunning();
    initDatabase();
    logger.info('Database initialized');

    this.sessionManager.loadFromDb();
    this.registeredGroups = getAllRegisteredGroups();
    logger.info(
      { groupCount: Object.keys(this.registeredGroups).length },
      'State loaded',
    );

    // Create composed services
    const agentExecutor = new AgentExecutor({
      sessionManager: this.sessionManager,
      queue: this.queue,
      getAvailableGroups: () => this.getAvailableGroups(),
      getRegisteredGroups: () => this.registeredGroups,
    });

    this.messageProcessor = new MessageProcessor({
      registeredGroups: () => this.registeredGroups,
      channelRegistry: this.channelRegistry,
      queue: this.queue,
      agentExecutor,
    });

    this.messageProcessor.loadState();

    // Graceful shutdown handlers
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));

    // Connect all registered channels
    for (const channel of this.channelRegistry.getAll()) {
      await channel.connect();
    }

    // Start subsystems
    this.startScheduler();
    this.startIpc();
    this.queue.setProcessMessagesFn((groupJid) => this.messageProcessor!.processGroupMessages(groupJid));
    this.messageProcessor.recoverPendingMessages();
    this.messageLoop = this.messageProcessor.startPolling();
  }

  /**
   * Graceful shutdown: stop queue, disconnect channels, exit.
   */
  async shutdown(signal?: string): Promise<void> {
    if (signal) {
      logger.info({ signal }, 'Shutdown signal received');
    }
    if (this.messageLoop) {
      this.messageLoop.stop();
    }
    await this.queue.shutdown(10000);
    await this.channelRegistry.disconnectAll();
    process.exit(0);
  }

  // --- Private: container system ---

  private ensureContainerSystemRunning(): void {
    ensureContainerRuntimeRunning();
    cleanupOrphans();
  }

  // --- Private: subsystem startup ---

  private startScheduler(): void {
    startSchedulerLoop({
      registeredGroups: () => this.registeredGroups,
      getSessions: () => this.sessionManager.getAll(),
      queue: this.queue,
      onProcess: (groupJid, proc, containerName, groupFolder) =>
        this.queue.registerProcess(groupJid, proc, containerName, groupFolder),
      sendMessage: async (jid, rawText) => {
        const channel = this.channelRegistry.findConnectedByJid(jid);
        if (!channel) {
          console.log(`Warning: no channel owns JID ${jid}, cannot send message`);
          return;
        }
        const text = formatOutbound(rawText);
        if (text) await channel.sendMessage(jid, text);
      },
    });
  }

  private startIpc(): void {
    startIpcWatcher({
      sendMessage: (jid, text) => {
        const channel = this.channelRegistry.findConnectedByJid(jid);
        if (!channel) throw new Error(`No channel for JID: ${jid}`);
        return channel.sendMessage(jid, text);
      },
      registeredGroups: () => this.registeredGroups,
      registerGroup: (jid, group) => this.registerGroup(jid, group),
      syncGroupMetadata: (force) => this.channelRegistry.syncAllMetadata(force),
      getAvailableGroups: () => this.getAvailableGroups(),
      writeGroupsSnapshot: (groupFolder, isMain, availableGroups, registeredJids) =>
        writeGroupsSnapshot(groupFolder, isMain, availableGroups, registeredJids),
      sessionManager: this.sessionManager,
      closeStdin: (chatJid) => this.queue.closeStdin(chatJid),
    });
  }
}
