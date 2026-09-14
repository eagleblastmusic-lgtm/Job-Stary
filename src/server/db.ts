import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class JobDatabase {
  readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    const migrationDir = resolve(process.cwd(), 'migrations');
    const migrations = readdirSync(migrationDir).filter(name => /^\d+_[a-zA-Z0-9_-]+\.sql$/.test(name)).sort();
    if (migrations.length === 0) throw new Error('Brak wykonywalnych migracji bazy danych.');

    for (const file of migrations) {
      const version = file.slice(0, -4);
      const applied = this.db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version);
      if (applied) continue;
      const sql = readFileSync(resolve(migrationDir, file), 'utf8');
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        this.db.exec(sql);
        this.db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(version);
        this.db.exec('COMMIT;');
      } catch (error) {
        this.db.exec('ROLLBACK;');
        throw new Error(`Migracja ${file} nie powiodła się: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  close(): void {
    this.db.close();
  }
}
