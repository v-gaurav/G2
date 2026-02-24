import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('telegram skill package', () => {
  const skillDir = path.resolve(__dirname, '..');

  it('has a valid manifest', () => {
    const manifestPath = path.join(skillDir, 'manifest.yaml');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = fs.readFileSync(manifestPath, 'utf-8');
    expect(content).toContain('skill: telegram');
    expect(content).toContain('version: 2.0.0');
    expect(content).toContain('grammy');
  });

  it('has all files declared in adds', () => {
    const addFile = path.join(skillDir, 'add', 'src', 'messaging', 'telegram', 'TelegramChannel.ts');
    expect(fs.existsSync(addFile)).toBe(true);

    const content = fs.readFileSync(addFile, 'utf-8');
    expect(content).toContain('class TelegramChannel');
    expect(content).toContain('implements Channel');

    // Test file for the channel
    const testFile = path.join(skillDir, 'add', 'src', 'messaging', 'telegram', 'TelegramChannel.test.ts');
    expect(fs.existsSync(testFile)).toBe(true);

    const testContent = fs.readFileSync(testFile, 'utf-8');
    expect(testContent).toContain("describe('TelegramChannel'");
  });

  it('has all files declared in modifies', () => {
    const indexFile = path.join(skillDir, 'modify', 'src', 'index.ts');
    const configFile = path.join(skillDir, 'modify', 'src', 'infrastructure', 'Config.ts');
    const routingTestFile = path.join(skillDir, 'modify', 'src', 'routing.test.ts');

    expect(fs.existsSync(indexFile)).toBe(true);
    expect(fs.existsSync(configFile)).toBe(true);
    expect(fs.existsSync(routingTestFile)).toBe(true);

    const indexContent = fs.readFileSync(indexFile, 'utf-8');
    expect(indexContent).toContain('TelegramChannel');
    expect(indexContent).toContain('TELEGRAM_BOT_TOKEN');
    expect(indexContent).toContain('TELEGRAM_ONLY');
    expect(indexContent).toContain('orchestrator.addChannel');

    const configContent = fs.readFileSync(configFile, 'utf-8');
    expect(configContent).toContain('TELEGRAM_BOT_TOKEN');
    expect(configContent).toContain('TELEGRAM_ONLY');
  });

  it('has intent files for modified files', () => {
    expect(fs.existsSync(path.join(skillDir, 'modify', 'src', 'index.ts.intent.md'))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, 'modify', 'src', 'infrastructure', 'Config.ts.intent.md'))).toBe(true);
  });

  it('modified index.ts preserves core structure', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'index.ts'),
      'utf-8',
    );

    // Core DDD imports and structure
    expect(content).toContain("from './app.js'");
    expect(content).toContain("from './infrastructure/Database.js'");
    expect(content).toContain("from './infrastructure/Logger.js'");
    expect(content).toContain('function getAvailableGroups()');
    expect(content).toContain('async function main()');

    // Test helper preserved
    expect(content).toContain('_setRegisteredGroups');

    // Direct-run guard preserved
    expect(content).toContain('isDirectRun');
  });

  it('modified index.ts includes Telegram channel creation', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'index.ts'),
      'utf-8',
    );

    // Telegram imports with DDD paths
    expect(content).toContain("from './messaging/telegram/TelegramChannel.js'");
    expect(content).toContain("from './infrastructure/Config.js'");

    // Conditional channel creation
    expect(content).toContain('if (!TELEGRAM_ONLY)');
    expect(content).toContain('if (TELEGRAM_BOT_TOKEN)');

    // DDD database pattern
    expect(content).toContain('database.messageRepo.storeMessage');
    expect(content).toContain('database.chatRepo.storeChatMetadata');
  });

  it('modified config.ts preserves all existing exports', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'infrastructure', 'Config.ts'),
      'utf-8',
    );

    // All original exports preserved
    expect(content).toContain('export const ASSISTANT_NAME');
    expect(content).toContain('export const POLL_INTERVAL');
    expect(content).toContain('export const TRIGGER_PATTERN');
    expect(content).toContain('export const CONTAINER_IMAGE');
    expect(content).toContain('export const DATA_DIR');
    expect(content).toContain('export const TIMEZONE');
  });
});
