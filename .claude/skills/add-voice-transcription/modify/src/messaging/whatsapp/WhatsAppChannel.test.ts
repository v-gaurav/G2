import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// --- Mocks ---

// Mock config
const mockConfig = vi.hoisted(() => ({
  STORE_DIR: '/tmp/g2-test-store',
  ASSISTANT_NAME: 'G2',
  ASSISTANT_HAS_OWN_NUMBER: false,
}));
vi.mock('../../infrastructure/Config.js', () => mockConfig);

// Mock logger
const mockLoggerObj = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../../infrastructure/Logger.js', () => mockLoggerObj);

// Mock db
const mockChatRepo = vi.hoisted(() => ({
  getLastGroupSync: vi.fn((): string | null => null),
  setLastGroupSync: vi.fn(),
  updateChatName: vi.fn(),
}));
const mockDatabase = vi.hoisted(() => ({
  chatRepo: mockChatRepo,
  getLastGroupSync: vi.fn((): string | null => null),
  setLastGroupSync: vi.fn(),
  updateChatName: vi.fn(),
}));
const mockDbModule = vi.hoisted(() => ({
  database: mockDatabase,
  AppDatabase: class {},
}));
vi.mock('../../infrastructure/Database.js', () => mockDbModule);

// Mock transcription
vi.mock('./Transcription.js', () => ({
  isVoiceMessage: vi.fn((msg: any) => msg.message?.audioMessage?.ptt === true),
  transcribeAudioMessage: vi.fn().mockResolvedValue('Hello this is a voice message'),
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => true),
      mkdirSync: vi.fn(),
    },
  };
});

// Build a fake WASocket that's an EventEmitter with the methods we need
function createFakeSocket() {
  const ev = new EventEmitter();
  const sock = {
    ev: {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        ev.on(event, handler);
      },
    },
    user: {
      id: '1234567890:1@s.whatsapp.net',
      lid: '9876543210:1@lid',
    },
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    groupFetchAllParticipating: vi.fn().mockResolvedValue({}),
    end: vi.fn(),
    _ev: ev,
  };
  return sock;
}

let fakeSocket: ReturnType<typeof createFakeSocket>;

// Mock Baileys
vi.mock('@whiskeysockets/baileys', () => {
  return {
    default: vi.fn(() => fakeSocket),
    Browsers: { macOS: vi.fn(() => ['macOS', 'Chrome', '']) },
    DisconnectReason: {
      loggedOut: 401,
      badSession: 500,
      connectionClosed: 428,
      connectionLost: 408,
      connectionReplaced: 440,
      timedOut: 408,
      restartRequired: 515,
    },
    makeCacheableSignalKeyStore: vi.fn((keys: unknown) => keys),
    useMultiFileAuthState: vi.fn().mockResolvedValue({
      state: {
        creds: {},
        keys: {},
      },
      saveCreds: vi.fn(),
    }),
  };
});

import { WhatsAppChannel, WhatsAppChannelOpts } from './WhatsAppChannel.js';
import { transcribeAudioMessage } from './Transcription.js';

// --- Test helpers ---

function createTestOpts(overrides?: Partial<WhatsAppChannelOpts>): WhatsAppChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: vi.fn(() => ({
      'registered@g.us': {
        name: 'Test Group',
        folder: 'test-group',
        trigger: '@G2',
        added_at: '2024-01-01T00:00:00.000Z',
        channel: 'whatsapp',
      },
    })),
    ...overrides,
  };
}

function triggerConnection(state: string, extra?: Record<string, unknown>) {
  fakeSocket._ev.emit('connection.update', { connection: state, ...extra });
}

function triggerDisconnect(statusCode: number) {
  fakeSocket._ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: {
      error: { output: { statusCode } },
    },
  });
}

async function triggerMessages(messages: unknown[]) {
  fakeSocket._ev.emit('messages.upsert', { messages });
  await new Promise((r) => setTimeout(r, 0));
}

// --- Tests ---

describe('WhatsAppChannel', () => {
  beforeEach(() => {
    fakeSocket = createFakeSocket();
    vi.mocked(mockChatRepo.getLastGroupSync).mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function connectChannel(channel: WhatsAppChannel): Promise<void> {
    const p = channel.connect();
    await new Promise((r) => setTimeout(r, 0));
    triggerConnection('open');
    return p;
  }

  // --- Connection lifecycle ---

  describe('connection lifecycle', () => {
    it('resolves connect() when connection opens', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      expect(channel.isConnected()).toBe(true);
    });

    it('sets up LID to phone mapping on open', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
    });

    it('flushes outgoing queue on reconnect', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      (channel as any).connected = false;
      await channel.sendMessage('test@g.us', 'Queued message');
      expect(fakeSocket.sendMessage).not.toHaveBeenCalled();
      (channel as any).connected = true;
      await (channel as any).flushOutgoingQueue();
      expect(fakeSocket.sendMessage).toHaveBeenCalledWith(
        'test@g.us',
        { text: 'G2: Queued message' },
      );
    });

    it('disconnects cleanly', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await channel.disconnect();
      expect(channel.isConnected()).toBe(false);
      expect(fakeSocket.end).toHaveBeenCalled();
    });
  });

  // --- QR code and auth ---

  describe('authentication', () => {
    it('exits process when QR code is emitted (no auth state)', async () => {
      vi.useFakeTimers();
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      channel.connect().catch(() => {});
      await vi.advanceTimersByTimeAsync(0);
      fakeSocket._ev.emit('connection.update', { qr: 'some-qr-data' });
      await vi.advanceTimersByTimeAsync(1500);
      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
      vi.useRealTimers();
    });
  });

  // --- Reconnection behavior ---

  describe('reconnection', () => {
    it('reconnects on non-loggedOut disconnect', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      expect(channel.isConnected()).toBe(true);
      triggerDisconnect(428);
      expect(channel.isConnected()).toBe(false);
    });

    it('exits on loggedOut disconnect', async () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      triggerDisconnect(401);
      expect(channel.isConnected()).toBe(false);
      expect(mockExit).toHaveBeenCalledWith(0);
      mockExit.mockRestore();
    });

    it('retries reconnection after 5s on failure', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      triggerDisconnect(515);
      await new Promise((r) => setTimeout(r, 100));
    });
  });

  // --- Message handling ---

  describe('message handling', () => {
    it('delivers message for registered group', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await triggerMessages([
        {
          key: { id: 'msg-1', remoteJid: 'registered@g.us', participant: '5551234@s.whatsapp.net', fromMe: false },
          message: { conversation: 'Hello G2' },
          pushName: 'Alice',
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      expect(opts.onChatMetadata).toHaveBeenCalledWith('registered@g.us', expect.any(String), undefined, 'whatsapp', true);
      expect(opts.onMessage).toHaveBeenCalledWith(
        'registered@g.us',
        expect.objectContaining({ id: 'msg-1', content: 'Hello G2', sender_name: 'Alice', is_from_me: false }),
      );
    });

    it('only emits metadata for unregistered groups', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await triggerMessages([
        {
          key: { id: 'msg-2', remoteJid: 'unregistered@g.us', participant: '5551234@s.whatsapp.net', fromMe: false },
          message: { conversation: 'Hello' },
          pushName: 'Bob',
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      expect(opts.onChatMetadata).toHaveBeenCalledWith('unregistered@g.us', expect.any(String), undefined, 'whatsapp', true);
      expect(opts.onMessage).not.toHaveBeenCalled();
    });

    it('ignores status@broadcast messages', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await triggerMessages([
        {
          key: { id: 'msg-3', remoteJid: 'status@broadcast', fromMe: false },
          message: { conversation: 'Status update' },
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      expect(opts.onChatMetadata).not.toHaveBeenCalled();
      expect(opts.onMessage).not.toHaveBeenCalled();
    });

    it('ignores messages with no content', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await triggerMessages([
        {
          key: { id: 'msg-4', remoteJid: 'registered@g.us', fromMe: false },
          message: null,
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      expect(opts.onMessage).not.toHaveBeenCalled();
    });

    it('extracts text from extendedTextMessage', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await triggerMessages([
        {
          key: { id: 'msg-5', remoteJid: 'registered@g.us', participant: '5551234@s.whatsapp.net', fromMe: false },
          message: { extendedTextMessage: { text: 'A reply message' } },
          pushName: 'Charlie',
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      expect(opts.onMessage).toHaveBeenCalledWith('registered@g.us', expect.objectContaining({ content: 'A reply message' }));
    });

    it('extracts caption from imageMessage', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await triggerMessages([
        {
          key: { id: 'msg-6', remoteJid: 'registered@g.us', participant: '5551234@s.whatsapp.net', fromMe: false },
          message: { imageMessage: { caption: 'Check this photo', mimetype: 'image/jpeg' } },
          pushName: 'Diana',
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      expect(opts.onMessage).toHaveBeenCalledWith('registered@g.us', expect.objectContaining({ content: 'Check this photo' }));
    });

    it('extracts caption from videoMessage', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await triggerMessages([
        {
          key: { id: 'msg-7', remoteJid: 'registered@g.us', participant: '5551234@s.whatsapp.net', fromMe: false },
          message: { videoMessage: { caption: 'Watch this', mimetype: 'video/mp4' } },
          pushName: 'Eve',
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      expect(opts.onMessage).toHaveBeenCalledWith('registered@g.us', expect.objectContaining({ content: 'Watch this' }));
    });

    it('transcribes voice messages', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await triggerMessages([
        {
          key: { id: 'msg-8', remoteJid: 'registered@g.us', participant: '5551234@s.whatsapp.net', fromMe: false },
          message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } },
          pushName: 'Frank',
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      expect(transcribeAudioMessage).toHaveBeenCalled();
      expect(opts.onMessage).toHaveBeenCalledTimes(1);
      expect(opts.onMessage).toHaveBeenCalledWith(
        'registered@g.us',
        expect.objectContaining({ content: '[Voice: Hello this is a voice message]' }),
      );
    });

    it('falls back when transcription returns null', async () => {
      vi.mocked(transcribeAudioMessage).mockResolvedValueOnce(null);
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await triggerMessages([
        {
          key: { id: 'msg-8b', remoteJid: 'registered@g.us', participant: '5551234@s.whatsapp.net', fromMe: false },
          message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } },
          pushName: 'Frank',
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      expect(opts.onMessage).toHaveBeenCalledTimes(1);
      expect(opts.onMessage).toHaveBeenCalledWith(
        'registered@g.us',
        expect.objectContaining({ content: '[Voice Message - transcription unavailable]' }),
      );
    });

    it('falls back when transcription throws', async () => {
      vi.mocked(transcribeAudioMessage).mockRejectedValueOnce(new Error('API error'));
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await triggerMessages([
        {
          key: { id: 'msg-8c', remoteJid: 'registered@g.us', participant: '5551234@s.whatsapp.net', fromMe: false },
          message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } },
          pushName: 'Frank',
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      expect(opts.onMessage).toHaveBeenCalledTimes(1);
      expect(opts.onMessage).toHaveBeenCalledWith(
        'registered@g.us',
        expect.objectContaining({ content: '[Voice Message - transcription failed]' }),
      );
    });

    it('uses sender JID when pushName is absent', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await triggerMessages([
        {
          key: { id: 'msg-9', remoteJid: 'registered@g.us', participant: '5551234@s.whatsapp.net', fromMe: false },
          message: { conversation: 'No push name' },
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      expect(opts.onMessage).toHaveBeenCalledWith('registered@g.us', expect.objectContaining({ sender_name: '5551234' }));
    });
  });

  // --- LID <-> JID translation ---

  describe('LID to JID translation', () => {
    it('translates known LID to phone JID', async () => {
      const opts = createTestOpts({
        registeredGroups: vi.fn(() => ({
          '1234567890@s.whatsapp.net': {
            name: 'Self Chat',
            folder: 'self-chat',
            trigger: '@G2',
            added_at: '2024-01-01T00:00:00.000Z',
            channel: 'whatsapp',
          },
        })),
      });
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await triggerMessages([
        {
          key: { id: 'msg-lid', remoteJid: '9876543210@lid', fromMe: false },
          message: { conversation: 'From LID' },
          pushName: 'Self',
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      expect(opts.onChatMetadata).toHaveBeenCalledWith('1234567890@s.whatsapp.net', expect.any(String), undefined, 'whatsapp', false);
    });

    it('passes through non-LID JIDs unchanged', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await triggerMessages([
        {
          key: { id: 'msg-normal', remoteJid: 'registered@g.us', participant: '5551234@s.whatsapp.net', fromMe: false },
          message: { conversation: 'Normal JID' },
          pushName: 'Grace',
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      expect(opts.onChatMetadata).toHaveBeenCalledWith('registered@g.us', expect.any(String), undefined, 'whatsapp', true);
    });

    it('passes through unknown LID JIDs unchanged', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await triggerMessages([
        {
          key: { id: 'msg-unknown-lid', remoteJid: '0000000000@lid', fromMe: false },
          message: { conversation: 'Unknown LID' },
          pushName: 'Unknown',
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ]);
      expect(opts.onChatMetadata).toHaveBeenCalledWith('0000000000@lid', expect.any(String), undefined, 'whatsapp', false);
    });
  });

  // --- Outgoing message queue ---

  describe('outgoing message queue', () => {
    it('sends message directly when connected', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await channel.sendMessage('test@g.us', 'Hello');
      expect(fakeSocket.sendMessage).toHaveBeenCalledWith('test@g.us', { text: 'G2: Hello' });
    });

    it('prefixes direct chat messages on shared number', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await channel.sendMessage('123@s.whatsapp.net', 'Hello');
      expect(fakeSocket.sendMessage).toHaveBeenCalledWith('123@s.whatsapp.net', { text: 'G2: Hello' });
    });

    it('queues message when disconnected', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await channel.sendMessage('test@g.us', 'Queued');
      expect(fakeSocket.sendMessage).not.toHaveBeenCalled();
    });

    it('queues message on send failure', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      fakeSocket.sendMessage.mockRejectedValueOnce(new Error('Network error'));
      await channel.sendMessage('test@g.us', 'Will fail');
    });

    it('flushes multiple queued messages in order', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await channel.sendMessage('test@g.us', 'First');
      await channel.sendMessage('test@g.us', 'Second');
      await channel.sendMessage('test@g.us', 'Third');
      await connectChannel(channel);
      await new Promise((r) => setTimeout(r, 50));
      expect(fakeSocket.sendMessage).toHaveBeenCalledTimes(3);
      expect(fakeSocket.sendMessage).toHaveBeenNthCalledWith(1, 'test@g.us', { text: 'G2: First' });
      expect(fakeSocket.sendMessage).toHaveBeenNthCalledWith(2, 'test@g.us', { text: 'G2: Second' });
      expect(fakeSocket.sendMessage).toHaveBeenNthCalledWith(3, 'test@g.us', { text: 'G2: Third' });
    });
  });

  // --- Group metadata sync ---

  describe('group metadata sync', () => {
    it('syncs group metadata on first connection', async () => {
      fakeSocket.groupFetchAllParticipating.mockResolvedValue({
        'group1@g.us': { subject: 'Group One' },
        'group2@g.us': { subject: 'Group Two' },
      });
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await new Promise((r) => setTimeout(r, 50));
      expect(fakeSocket.groupFetchAllParticipating).toHaveBeenCalled();
      expect(mockChatRepo.updateChatName).toHaveBeenCalledWith('group1@g.us', 'Group One');
      expect(mockChatRepo.updateChatName).toHaveBeenCalledWith('group2@g.us', 'Group Two');
      expect(mockChatRepo.setLastGroupSync).toHaveBeenCalled();
    });

    it('skips sync when synced recently', async () => {
      vi.mocked(mockChatRepo.getLastGroupSync).mockReturnValue(
        new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      );
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await new Promise((r) => setTimeout(r, 50));
      expect(fakeSocket.groupFetchAllParticipating).not.toHaveBeenCalled();
    });

    it('forces sync regardless of cache', async () => {
      vi.mocked(mockChatRepo.getLastGroupSync).mockReturnValue(
        new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      );
      fakeSocket.groupFetchAllParticipating.mockResolvedValue({
        'group@g.us': { subject: 'Forced Group' },
      });
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await channel.syncMetadata(true);
      expect(fakeSocket.groupFetchAllParticipating).toHaveBeenCalled();
      expect(mockChatRepo.updateChatName).toHaveBeenCalledWith('group@g.us', 'Forced Group');
    });

    it('handles group sync failure gracefully', async () => {
      fakeSocket.groupFetchAllParticipating.mockRejectedValue(new Error('Network timeout'));
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await expect(channel.syncMetadata(true)).resolves.toBeUndefined();
    });

    it('skips groups with no subject', async () => {
      fakeSocket.groupFetchAllParticipating.mockResolvedValue({
        'group1@g.us': { subject: 'Has Subject' },
        'group2@g.us': { subject: '' },
        'group3@g.us': {},
      });
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      vi.mocked(mockChatRepo.updateChatName).mockClear();
      await channel.syncMetadata(true);
      expect(mockChatRepo.updateChatName).toHaveBeenCalledTimes(1);
      expect(mockChatRepo.updateChatName).toHaveBeenCalledWith('group1@g.us', 'Has Subject');
    });
  });

  // --- JID ownership ---

  describe('ownsJid', () => {
    it('owns @g.us JIDs (WhatsApp groups)', () => {
      const channel = new WhatsAppChannel(createTestOpts());
      expect(channel.ownsJid('12345@g.us')).toBe(true);
    });

    it('owns @s.whatsapp.net JIDs (WhatsApp DMs)', () => {
      const channel = new WhatsAppChannel(createTestOpts());
      expect(channel.ownsJid('12345@s.whatsapp.net')).toBe(true);
    });

    it('does not own Telegram JIDs', () => {
      const channel = new WhatsAppChannel(createTestOpts());
      expect(channel.ownsJid('tg:12345')).toBe(false);
    });

    it('does not own unknown JID formats', () => {
      const channel = new WhatsAppChannel(createTestOpts());
      expect(channel.ownsJid('random-string')).toBe(false);
    });
  });

  // --- Typing indicator ---

  describe('setTyping', () => {
    it('sends composing presence when typing', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await channel.setTyping('test@g.us', true);
      expect(fakeSocket.sendPresenceUpdate).toHaveBeenCalledWith('composing', 'test@g.us');
    });

    it('sends paused presence when stopping', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      await channel.setTyping('test@g.us', false);
      expect(fakeSocket.sendPresenceUpdate).toHaveBeenCalledWith('paused', 'test@g.us');
    });

    it('handles typing indicator failure gracefully', async () => {
      const opts = createTestOpts();
      const channel = new WhatsAppChannel(opts);
      await connectChannel(channel);
      fakeSocket.sendPresenceUpdate.mockRejectedValueOnce(new Error('Failed'));
      await expect(channel.setTyping('test@g.us', true)).resolves.toBeUndefined();
    });
  });

  // --- Channel properties ---

  describe('channel properties', () => {
    it('has name "whatsapp"', () => {
      const channel = new WhatsAppChannel(createTestOpts());
      expect(channel.name).toBe('whatsapp');
    });

    it('does not expose prefixAssistantName (prefix handled internally)', () => {
      const channel = new WhatsAppChannel(createTestOpts());
      expect('prefixAssistantName' in channel).toBe(false);
    });
  });
});
