import fs from 'fs';

import {
  ASSISTANT_NAME,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
} from './config.js';
import { safeParse } from './safe-parse.js';
import { ChannelRegistry } from './channel-registry.js';
import type { Channel } from './types.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeSessionHistorySnapshot,
} from './container-runner.js';
import type { AvailableGroup } from './container-runner.js';
import { cleanupOrphans, ensureContainerRuntimeRunning } from './container-runtime.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getConversationArchives,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
} from './db.js';
import { GroupPaths } from './group-paths.js';
import { GroupQueue } from './group-queue.js';
import { createIdleTimer } from './idle-timer.js';
import { startIpcWatcher } from './ipc.js';
import { startPollLoop } from './poll-loop.js';
import { formatMessages, formatOutbound } from './router.js';
import { SessionManager } from './session-manager.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { refreshTasksSnapshot } from './task-snapshots.js';
import { hasTrigger } from './trigger-validator.js';
import { NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

export class Orchestrator {
  private lastTimestamp = '';
  private sessionManager: SessionManager;
  private registeredGroups: Record<string, RegisteredGroup> = {};
  private lastAgentTimestamp: Record<string, string> = {};

  private channelRegistry: ChannelRegistry;
  private queue: GroupQueue;

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
    this.loadState();

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
    this.queue.setProcessMessagesFn((groupJid) => this.processGroupMessages(groupJid));
    this.recoverPendingMessages();
    this.messageLoop = this.startMessageLoop();
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

  // --- Private: state management ---

  private loadState(): void {
    this.lastTimestamp = getRouterState('last_timestamp') || '';
    const agentTs = getRouterState('last_agent_timestamp');
    const parsed = agentTs ? safeParse<Record<string, string>>(agentTs) : null;
    if (agentTs && !parsed) {
      logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    }
    this.lastAgentTimestamp = parsed ?? {};
    this.sessionManager.loadFromDb();
    this.registeredGroups = getAllRegisteredGroups();
    logger.info(
      { groupCount: Object.keys(this.registeredGroups).length },
      'State loaded',
    );
  }

  private saveState(): void {
    setRouterState('last_timestamp', this.lastTimestamp);
    setRouterState(
      'last_agent_timestamp',
      JSON.stringify(this.lastAgentTimestamp),
    );
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

  // --- Private: message processing ---

  /**
   * Process all pending messages for a group.
   * Called by the GroupQueue when it's this group's turn.
   */
  private async processGroupMessages(chatJid: string): Promise<boolean> {
    const group = this.registeredGroups[chatJid];
    if (!group) return true;

    const channel = this.channelRegistry.findByJid(chatJid);
    if (!channel) {
      console.log(`Warning: no channel owns JID ${chatJid}, skipping messages`);
      return true;
    }

    const sinceTimestamp = this.lastAgentTimestamp[chatJid] || '';
    const missedMessages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);

    if (missedMessages.length === 0) return true;

    const prompt = formatMessages(missedMessages);

    // Advance cursor so the piping path in startMessageLoop won't re-fetch
    // these messages. Save the old cursor so we can roll back on error.
    const previousCursor = this.lastAgentTimestamp[chatJid] || '';
    this.lastAgentTimestamp[chatJid] =
      missedMessages[missedMessages.length - 1].timestamp;
    this.saveState();

    logger.info(
      { group: group.name, messageCount: missedMessages.length },
      'Processing messages',
    );

    const idle = createIdleTimer(() => {
      logger.debug({ group: group.name }, 'Idle timeout, closing container stdin');
      this.queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);

    await channel.setTyping?.(chatJid, true);
    let hadError = false;
    let outputSentToUser = false;

    const output = await this.runAgent(group, prompt, chatJid, async (result) => {
      // Streaming output callback — called for each agent result
      if (result.result) {
        const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
        // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
        const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
        logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
        if (text) {
          await channel.sendMessage(chatJid, text);
          outputSentToUser = true;
        }
        // Only reset idle timer on actual results, not session-update markers (result: null)
        idle.reset();
      }

      if (result.status === 'error') {
        hadError = true;
      }
    });

    await channel.setTyping?.(chatJid, false);
    idle.clear();

    if (output === 'error' || hadError) {
      // If we already sent output to the user, don't roll back the cursor —
      // the user got their response and re-processing would send duplicates.
      if (outputSentToUser) {
        logger.warn({ group: group.name }, 'Agent error after output was sent, skipping cursor rollback to prevent duplicates');
        return true;
      }
      // Roll back cursor so retries can re-process these messages
      this.lastAgentTimestamp[chatJid] = previousCursor;
      this.saveState();
      logger.warn({ group: group.name }, 'Agent error, rolled back message cursor for retry');
      return false;
    }

    return true;
  }

  private async runAgent(
    group: RegisteredGroup,
    prompt: string,
    chatJid: string,
    onOutput?: (output: ContainerOutput) => Promise<void>,
  ): Promise<'success' | 'error'> {
    const isMain = group.folder === MAIN_GROUP_FOLDER;
    const sessionId = this.sessionManager.get(group.folder);

    // Update tasks snapshot for container to read (filtered by group)
    refreshTasksSnapshot(group.folder, isMain);

    // Update available groups snapshot (main group only can see all groups)
    const availableGroups = this.getAvailableGroups();
    writeGroupsSnapshot(
      group.folder,
      isMain,
      availableGroups,
      new Set(Object.keys(this.registeredGroups)),
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
            this.sessionManager.set(group.folder, output.newSessionId);
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
        (proc, containerName) => this.queue.registerProcess(chatJid, proc, containerName, group.folder),
        wrappedOnOutput,
      );

      if (output.newSessionId) {
        this.sessionManager.set(group.folder, output.newSessionId);
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

  private startMessageLoop(): { stop: () => void } {
    logger.info(`G2 running (trigger: @${ASSISTANT_NAME})`);

    return startPollLoop('Message', POLL_INTERVAL, async () => {
      const jids = Object.keys(this.registeredGroups);
      const { messages, newTimestamp } = getNewMessages(jids, this.lastTimestamp, ASSISTANT_NAME);

      if (messages.length === 0) return;

      logger.info({ count: messages.length }, 'New messages');

      // Advance the "seen" cursor for all messages immediately
      this.lastTimestamp = newTimestamp;
      this.saveState();

      // Deduplicate by group
      const messagesByGroup = new Map<string, NewMessage[]>();
      for (const msg of messages) {
        const existing = messagesByGroup.get(msg.chat_jid);
        if (existing) {
          existing.push(msg);
        } else {
          messagesByGroup.set(msg.chat_jid, [msg]);
        }
      }

      for (const [chatJid, groupMessages] of messagesByGroup) {
        const group = this.registeredGroups[chatJid];
        if (!group) continue;

        const channel = this.channelRegistry.findByJid(chatJid);
        if (!channel) {
          console.log(`Warning: no channel owns JID ${chatJid}, skipping messages`);
          continue;
        }

        const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

        // For non-main groups, only act on trigger messages.
        // Non-trigger messages accumulate in DB and get pulled as
        // context when a trigger eventually arrives.
        if (!isMainGroup && !hasTrigger(groupMessages, group)) {
          continue;
        }

        // Pull all messages since lastAgentTimestamp so non-trigger
        // context that accumulated between triggers is included.
        const allPending = getMessagesSince(
          chatJid,
          this.lastAgentTimestamp[chatJid] || '',
          ASSISTANT_NAME,
        );
        const messagesToSend =
          allPending.length > 0 ? allPending : groupMessages;
        const formatted = formatMessages(messagesToSend);

        if (this.queue.sendMessage(chatJid, formatted)) {
          logger.debug(
            { chatJid, count: messagesToSend.length },
            'Piped messages to active container',
          );
          this.lastAgentTimestamp[chatJid] =
            messagesToSend[messagesToSend.length - 1].timestamp;
          this.saveState();
          // Show typing indicator while the container processes the piped message
          channel.setTyping?.(chatJid, true);
        } else {
          // No active container — enqueue for a new one
          this.queue.enqueueMessageCheck(chatJid);
        }
      }
    });
  }

  /**
   * Startup recovery: check for unprocessed messages in registered groups.
   * Handles crash between advancing lastTimestamp and processing messages.
   */
  private recoverPendingMessages(): void {
    for (const [chatJid, group] of Object.entries(this.registeredGroups)) {
      const sinceTimestamp = this.lastAgentTimestamp[chatJid] || '';
      const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
      if (pending.length === 0) continue;

      // For non-main groups, only recover if a trigger is present
      const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
      if (!isMainGroup && !hasTrigger(pending, group)) continue;

      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      this.queue.enqueueMessageCheck(chatJid);
    }
  }
}
