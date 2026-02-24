import fs from 'fs';
import path from 'path';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  WASocket,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

import { ASSISTANT_HAS_OWN_NUMBER, ASSISTANT_NAME, STORE_DIR } from '../config.js';
import { database as defaultDatabase } from '../db.js';
import { logger } from '../logger.js';
import type { ChatRepository } from '../repositories/chat-repository.js';
import { Channel, OnInboundMessage, OnChatMetadata, RegisteredGroup } from '../types.js';
import { OutgoingMessageQueue } from './outgoing-message-queue.js';
import { WhatsAppMetadataSync } from './whatsapp-metadata-sync.js';

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface WhatsAppChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  chatRepo?: ChatRepository;
}

export class WhatsAppChannel implements Channel {
  name = 'whatsapp';

  private sock!: WASocket;
  private connected = false;
  private lidToPhoneMap: Record<string, string> = {};
  private messageQueue = new OutgoingMessageQueue();
  private metadataSync: WhatsAppMetadataSync | null = null;
  private reconnectAttempt = 0;

  private opts: WhatsAppChannelOpts;

  constructor(opts: WhatsAppChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.connectInternal(resolve).catch(reject);
    });
  }

  private async connectInternal(onFirstOpen?: () => void): Promise<void> {
    const authDir = path.join(STORE_DIR, 'auth');
    fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: Browsers.macOS('Chrome'),
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.error('WhatsApp authentication required. Run /setup in Claude Code.');
        setTimeout(() => process.exit(1), 1000);
      }

      if (connection === 'close') {
        this.connected = false;
        const reason = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;
        logger.info({ reason, shouldReconnect, queuedMessages: this.messageQueue.size }, 'Connection closed');

        if (shouldReconnect) {
          this.reconnectWithBackoff();
        } else {
          logger.info('Logged out. Run /setup to re-authenticate.');
          process.exit(0);
        }
      } else if (connection === 'open') {
        this.onConnectionOpen(onFirstOpen);
        onFirstOpen = undefined;
      }
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message) continue;
        const rawJid = msg.key.remoteJid;
        if (!rawJid || rawJid === 'status@broadcast') continue;

        // Translate LID JID to phone JID if applicable
        const chatJid = await this.translateJid(rawJid);

        const rawTs = Number(msg.messageTimestamp);
        const timestamp = (rawTs > 0)
          ? new Date(rawTs * 1000).toISOString()
          : new Date().toISOString(); // fallback to now if timestamp missing/invalid

        // Always notify about chat metadata for group discovery
        const isGroup = chatJid.endsWith('@g.us');
        this.opts.onChatMetadata(chatJid, timestamp, undefined, 'whatsapp', isGroup);

        // Only deliver full message for registered groups
        const groups = this.opts.registeredGroups();
        if (groups[chatJid]) {
          const content =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            '';
          const sender = msg.key.participant || msg.key.remoteJid || '';
          const senderName = msg.pushName || sender.split('@')[0];

          const fromMe = msg.key.fromMe || false;
          // Detect bot messages: with own number, fromMe is reliable
          // since only the bot sends from that number.
          // With shared number, bot messages carry the assistant name prefix
          // (even in DMs/self-chat) so we check for that.
          const isBotMessage = ASSISTANT_HAS_OWN_NUMBER
            ? fromMe
            : content.startsWith(`${ASSISTANT_NAME}:`);

          this.opts.onMessage(chatJid, {
            id: msg.key.id || '',
            chat_jid: chatJid,
            sender,
            sender_name: senderName,
            content,
            timestamp,
            is_from_me: fromMe,
            is_bot_message: isBotMessage,
          });
        }
      }
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    // Prefix bot messages with assistant name so users know who's speaking.
    // On a shared number, prefix is also needed in DMs (including self-chat)
    // to distinguish bot output from user messages.
    // Skip only when the assistant has its own dedicated phone number.
    const prefixed = ASSISTANT_HAS_OWN_NUMBER
      ? text
      : `${ASSISTANT_NAME}: ${text}`;

    if (!this.connected) {
      this.messageQueue.enqueue(jid, prefixed);
      logger.info({ jid, length: prefixed.length, queueSize: this.messageQueue.size }, 'WA disconnected, message queued');
      return;
    }
    try {
      await this.sock.sendMessage(jid, { text: prefixed });
      logger.info({ jid, length: prefixed.length }, 'Message sent');
    } catch (err) {
      // If send fails, queue it for retry on reconnect
      this.messageQueue.enqueue(jid, prefixed);
      logger.warn({ jid, err, queueSize: this.messageQueue.size }, 'Failed to send, message queued');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.endsWith('@g.us') || jid.endsWith('@s.whatsapp.net');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.sock?.end(undefined);
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    try {
      const status = isTyping ? 'composing' : 'paused';
      logger.debug({ jid, status }, 'Sending presence update');
      await this.sock.sendPresenceUpdate(status, jid);
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to update typing status');
    }
  }

  /**
   * Sync group metadata from WhatsApp.
   * Fetches all participating groups and stores their names in the database.
   * Called on startup, daily, and on-demand via IPC.
   */
  async syncMetadata(force = false): Promise<void> {
    if (!this.metadataSync) {
      const chatRepo = this.opts.chatRepo ?? defaultDatabase.chatRepo;
      this.metadataSync = new WhatsAppMetadataSync(GROUP_SYNC_INTERVAL_MS, chatRepo);
    }
    return this.metadataSync.sync(
      () => this.sock.groupFetchAllParticipating(),
      force,
    );
  }

  private onConnectionOpen(onFirstOpen?: () => void): void {
    this.connected = true;
    logger.info('Connected to WhatsApp');

    // Announce availability so WhatsApp relays subsequent presence updates (typing indicators)
    this.sock.sendPresenceUpdate('available').catch(() => {});

    // Build LID to phone mapping from auth state for self-chat translation
    if (this.sock.user) {
      const phoneUser = this.sock.user.id.split(':')[0];
      const lidUser = this.sock.user.lid?.split(':')[0];
      if (lidUser && phoneUser) {
        this.lidToPhoneMap[lidUser] = `${phoneUser}@s.whatsapp.net`;
        logger.debug({ lidUser, phoneUser }, 'LID to phone mapping set');
      }
    }

    // Flush any messages queued while disconnected
    this.flushOutgoingQueue().catch((err) =>
      logger.error({ err }, 'Failed to flush outgoing queue'),
    );

    // Lazily create metadataSync on first connection (after DB init)
    if (!this.metadataSync) {
      const chatRepo = this.opts.chatRepo ?? defaultDatabase.chatRepo;
      this.metadataSync = new WhatsAppMetadataSync(GROUP_SYNC_INTERVAL_MS, chatRepo);
    }

    // Sync group metadata on startup (respects 24h cache)
    const fetchGroups = () => this.sock.groupFetchAllParticipating();
    this.metadataSync.sync(fetchGroups).catch((err) =>
      logger.error({ err }, 'Initial group sync failed'),
    );
    // Set up daily sync timer (only once)
    this.metadataSync.startPeriodicSync(fetchGroups);

    // Reset reconnect counter on successful connection
    this.reconnectAttempt = 0;

    // Signal first connection to caller
    if (onFirstOpen) {
      onFirstOpen();
    }
  }

  private reconnectWithBackoff(): void {
    const MAX_RETRIES = 10;
    const BASE_DELAY_MS = 2000;
    const MAX_DELAY_MS = 60000;

    if (this.reconnectAttempt >= MAX_RETRIES) {
      logger.error({ attempts: MAX_RETRIES }, 'Reconnection attempts exhausted');
      return;
    }

    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, this.reconnectAttempt), MAX_DELAY_MS);
    this.reconnectAttempt++;

    logger.info({ attempt: this.reconnectAttempt, delayMs: delay }, 'Reconnecting with backoff');

    setTimeout(() => {
      this.connectInternal().catch((err) => {
        logger.error({ err, attempt: this.reconnectAttempt }, 'Reconnection attempt failed');
        this.reconnectWithBackoff();
      });
    }, delay);
  }

  private async translateJid(jid: string): Promise<string> {
    if (!jid.endsWith('@lid')) return jid;
    const lidUser = jid.split('@')[0].split(':')[0];

    // Check local cache first
    const cached = this.lidToPhoneMap[lidUser];
    if (cached) {
      logger.debug({ lidJid: jid, phoneJid: cached }, 'Translated LID to phone JID (cached)');
      return cached;
    }

    // Query Baileys' signal repository for the mapping
    try {
      const pn = await this.sock.signalRepository?.lidMapping?.getPNForLID(jid);
      if (pn) {
        const phoneJid = `${pn.split('@')[0].split(':')[0]}@s.whatsapp.net`;
        this.lidToPhoneMap[lidUser] = phoneJid;
        logger.info({ lidJid: jid, phoneJid }, 'Translated LID to phone JID (signalRepository)');
        return phoneJid;
      }
    } catch (err) {
      logger.debug({ err, jid }, 'Failed to resolve LID via signalRepository');
    }

    return jid;
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.messageQueue.size > 0) {
      logger.info({ count: this.messageQueue.size }, 'Flushing outgoing message queue');
    }
    await this.messageQueue.flush(async (jid, text) => {
      // Send directly — queued items are already prefixed by sendMessage
      await this.sock.sendMessage(jid, { text });
      logger.info({ jid, length: text.length }, 'Queued message sent');
    });
  }
}
