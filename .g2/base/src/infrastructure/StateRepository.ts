import BetterSqlite3 from 'better-sqlite3';

export class StateRepository {
  constructor(private db: BetterSqlite3.Database) {}

  getRouterState(key: string): string | undefined {
    const row = this.db
      .prepare('SELECT value FROM router_state WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  setRouterState(key: string, value: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
    ).run(key, value);
  }
}
