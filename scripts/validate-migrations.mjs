import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(process.cwd(), 'migrations');
const files = readdirSync(directory).filter(name => /^\d+_[a-zA-Z0-9_-]+\.sql$/.test(name)).sort();
if (files.length === 0) throw new Error('No executable SQLite migrations found.');

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')));');
for (const file of files) {
  const version = file.slice(0, -4);
  const sql = readFileSync(resolve(directory, file), 'utf8');
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(sql);
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (?)').run(version);
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const applied = Number(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count);
if (applied !== files.length) throw new Error(`Expected ${files.length} applied migrations, found ${applied}.`);
const fk = db.prepare('PRAGMA foreign_key_check').all();
if (fk.length > 0) throw new Error(`Foreign key check failed: ${JSON.stringify(fk)}`);
const integrity = db.prepare('PRAGMA integrity_check').get();
if (!integrity || !Object.values(integrity).includes('ok')) throw new Error(`Integrity check failed: ${JSON.stringify(integrity)}`);
db.close();
console.log(`Migration validation: PASS (${files.length} migrations)`);
