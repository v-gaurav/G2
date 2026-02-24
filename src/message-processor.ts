import {
  ASSISTANT_NAME,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
} from './config.js';
import { safeParse } from './safe-parse.js';
import { AgentExecutor } from './agent-executor.js';
import { ChannelRegistry } from './channel-registry.js';
import {
  getMessagesSince,
  getNewMessages,
  getRouterState,
  setRouterState,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { createIdleTimer } from './idle-timer.js';
import { startPollLoop } from './poll-loop.js';
import { formatMessages } from './router.js';
import { hasTrigger } from './trigger-validator.js';
import { NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

export class MessageProcessor {
  private lastTimestamp = '';
  private lastAgentTimestamp: Record<string, string> = {};

  constructor(private deps: {
    registeredGroups: () => Record<string, RegisteredGroup>;
    channelRegistry: ChannelRegistry;
    queue: GroupQueue;
    agentExecutor: AgentExecutor;
  }) {}

  loadState(): void {
    this.lastTimestamp = getRouterState('last_timestamp') || '';
    const agentTs = getRouterState('last_agent_timestamp');
    const parsed = agentTs ? safeParse<Record<string, string>>(agentTs) : null;
    if (agentTs && !parsed) {
      logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    }
    this.lastAgentTimestamp = parsed ?? {};
  }

  saveState(): void {
    setRouterState('last_timestamp', this.lastTimestamp);
    setRouterState(
      'last_agent_timestamp',
      JSON.stringify(this.lastAgentTimestamp),
    );
  }

  startPolling(): { stop: () => void } {
    logger.info(`G2 running (trigger: @${ASSISTANT_NAME})`);

    return startPollLoop('Message', POLL_INTERVAL, async () => {
      const jids = Object.keys(this.deps.registeredGroups());
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
        const group = this.deps.registeredGroups()[chatJid];
        if (!group) continue;

        const channel = this.deps.channelRegistry.findByJid(chatJid);
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

        if (this.deps.queue.sendMessage(chatJid, formatted)) {
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
          this.deps.queue.enqueueMessageCheck(chatJid);
        }
      }
    });
  }

  async processGroupMessages(chatJid: string): Promise<boolean> {
    const group = this.deps.registeredGroups()[chatJid];
    if (!group) return true;

    const channel = this.deps.channelRegistry.findByJid(chatJid);
    if (!channel) {
      console.log(`Warning: no channel owns JID ${chatJid}, skipping messages`);
      return true;
    }

    const sinceTimestamp = this.lastAgentTimestamp[chatJid] || '';
    const missedMessages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);

    if (missedMessages.length === 0) return true;

    const prompt = formatMessages(missedMessages);

    // Advance cursor so the piping path in startPolling won't re-fetch
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
      this.deps.queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);

    await channel.setTyping?.(chatJid, true);
    let hadError = false;
    let outputSentToUser = false;

    const output = await this.deps.agentExecutor.execute(group, prompt, chatJid, async (result) => {
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

  recoverPendingMessages(): void {
    for (const [chatJid, group] of Object.entries(this.deps.registeredGroups())) {
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
      this.deps.queue.enqueueMessageCheck(chatJid);
    }
  }
}
