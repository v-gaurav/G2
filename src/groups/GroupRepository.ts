import BetterSqlite3 from 'better-sqlite3';

import { RegisteredGroup } from '../types.js';

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export class GroupRepository {
  constructor(private db: BetterSqlite3.Database) {}

  getRegisteredGroup(jid: string): (RegisteredGroup & { jid: string }) | undefined {
    const row = this.db
      .prepare('SELECT * FROM registered_groups WHERE jid = ?')
      .get(jid) as
      | {
          jid: string;
          name: string;
          folder: string;
          trigger_pattern: string;
          added_at: string;
          container_config: string | null;
          requires_trigger: number | null;
          channel: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      jid: row.jid,
      name: row.name,
      folder: row.folder,
      trigger: row.trigger_pattern,
      added_at: row.added_at,
      channel: row.channel || 'whatsapp',
      containerConfig: row.container_config
        ? safeParse(row.container_config) ?? undefined
        : undefined,
      requiresTrigger: row.requires_trigger === null ? undefined : row.requires_trigger === 1,
    };
  }

  setRegisteredGroup(jid: string, group: RegisteredGroup): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger, channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      jid,
      group.name,
      group.folder,
      group.trigger,
      group.added_at,
      group.containerConfig ? JSON.stringify(group.containerConfig) : null,
      group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
      group.channel || 'whatsapp',
    );
  }

  getAllRegisteredGroups(): Record<string, RegisteredGroup> {
    const rows = this.db
      .prepare('SELECT * FROM registered_groups')
      .all() as Array<{
      jid: string;
      name: string;
      folder: string;
      trigger_pattern: string;
      added_at: string;
      container_config: string | null;
      requires_trigger: number | null;
      channel: string | null;
    }>;
    const result: Record<string, RegisteredGroup> = {};
    for (const row of rows) {
      result[row.jid] = {
        name: row.name,
        folder: row.folder,
        trigger: row.trigger_pattern,
        added_at: row.added_at,
        channel: row.channel || 'whatsapp',
        containerConfig: row.container_config
          ? safeParse(row.container_config) ?? undefined
          : undefined,
        requiresTrigger: row.requires_trigger === null ? undefined : row.requires_trigger === 1,
      };
    }
    return result;
  }
}
