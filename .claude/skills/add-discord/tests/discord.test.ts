import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('discord skill package', () => {
  const skillDir = path.resolve(__dirname, '..');

  it('has a valid manifest', () => {
    const manifestPath = path.join(skillDir, 'manifest.yaml');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = fs.readFileSync(manifestPath, 'utf-8');
    expect(content).toContain('skill: discord');
    expect(content).toContain('version: 2.0.0');
    expect(content).toContain('discord.js');
  });

  it('has all files declared in adds', () => {
    const addFile = path.join(skillDir, 'add', 'src', 'messaging', 'discord', 'DiscordChannel.ts');
    expect(fs.existsSync(addFile)).toBe(true);

    const content = fs.readFileSync(addFile, 'utf-8');
    expect(content).toContain('class DiscordChannel');
    expect(content).toContain('implements Channel');

    // Test file for the channel
    const testFile = path.join(skillDir, 'add', 'src', 'messaging', 'discord', 'DiscordChannel.test.ts');
    expect(fs.existsSync(testFile)).toBe(true);

    const testContent = fs.readFileSync(testFile, 'utf-8');
    expect(testContent).toContain("describe('DiscordChannel'");
  });

  it('has all files declared in modifies', () => {
    const indexFile = path.join(skillDir, 'modify', 'src', 'index.ts');
    const configFile = path.join(skillDir, 'modify', 'src', 'infrastructure', 'Config.ts');
    const routingTestFile = path.join(skillDir, 'modify', 'src', 'routing.test.ts');

    expect(fs.existsSync(indexFile)).toBe(true);
    expect(fs.existsSync(configFile)).toBe(true);
    expect(fs.existsSync(routingTestFile)).toBe(true);

    const indexContent = fs.readFileSync(indexFile, 'utf-8');
    expect(indexContent).toContain('DiscordChannel');
    expect(indexContent).toContain('DISCORD_BOT_TOKEN');
    expect(indexContent).toContain('DISCORD_ONLY');

    const configContent = fs.readFileSync(configFile, 'utf-8');
    expect(configContent).toContain('DISCORD_BOT_TOKEN');
    expect(configContent).toContain('DISCORD_ONLY');
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

    // Core exports still present
    expect(content).toContain('function getAvailableGroups()');
    expect(content).toContain('async function main()');

    // Test helper preserved
    expect(content).toContain('_setRegisteredGroups');

    // Direct-run guard preserved
    expect(content).toContain('isDirectRun');

    // DDD imports
    expect(content).toContain("from './app.js'");
    expect(content).toContain("from './infrastructure/Database.js'");
    expect(content).toContain("from './infrastructure/Logger.js'");
    expect(content).toContain("from './messaging/whatsapp/WhatsAppChannel.js'");
  });

  it('modified index.ts includes Discord channel creation', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'index.ts'),
      'utf-8',
    );

    // Discord channel import and creation
    expect(content).toContain("from './messaging/discord/DiscordChannel.js'");
    expect(content).toContain("from './infrastructure/Config.js'");

    // Conditional channel creation
    expect(content).toContain('if (!DISCORD_ONLY)');
    expect(content).toContain('if (DISCORD_BOT_TOKEN)');

    // Uses orchestrator.addChannel pattern
    expect(content).toContain('orchestrator.addChannel(whatsapp)');
    expect(content).toContain('orchestrator.addChannel(discord)');
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

    // readEnvFile defined in the same file
    expect(content).toContain('export function readEnvFile');

    // Discord exports added
    expect(content).toContain('export const DISCORD_BOT_TOKEN');
    expect(content).toContain('export const DISCORD_ONLY');
  });

  it('modified routing.test.ts includes Discord JID tests', () => {
    const content = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'routing.test.ts'),
      'utf-8',
    );

    expect(content).toContain("Discord JID: starts with dc:");
    expect(content).toContain("dc:1234567890123456");
    expect(content).toContain("dc:");

    // Uses DDD database pattern
    expect(content).toContain("database._initTest()");
    expect(content).toContain("database.chatRepo.storeChatMetadata");
    expect(content).toContain("from './infrastructure/Database.js'");
  });
});
