import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JobDatabase } from '../server/db.js';

const legacyMigrations = ['0001_init.sql', '0002_hardening.sql', '0003_analytics_consent.sql'];

test('0004 migrates legacy Linux and Windows absolute upload paths to portable keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-storage-migration-'));
  const path = resolve(dir, 'legacy.sqlite');
  try {
    const legacy = new DatabaseSync(path);
    try {
      legacy.exec('PRAGMA foreign_keys = ON;');
      for (const file of legacyMigrations) {
        legacy.exec(await readFile(resolve(process.cwd(), 'migrations', file), 'utf8'));
        legacy.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (?)').run(file.slice(0, -4));
      }
      const timestamp = new Date().toISOString();
      legacy.prepare(`INSERT INTO users(id,email,password_hash,name,locale,timezone,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        'user-linux', 'linux@example.test', 'hash', 'Linux', 'pl-PL', 'Europe/Warsaw', 'USER', timestamp, timestamp
      );
      legacy.prepare(`INSERT INTO users(id,email,password_hash,name,locale,timezone,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        'user-windows', 'windows@example.test', 'hash', 'Windows', 'pl-PL', 'Europe/Warsaw', 'USER', timestamp, timestamp
      );
      legacy.prepare(`INSERT INTO uploaded_files(id,user_id,kind,original_name,mime_type,storage_key,size_bytes,sha256,extracted_text,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        'upload-linux', 'user-linux', 'CV', 'cv.txt', 'text/plain', '/srv/job/data/uploads/user-linux/cv.txt', 2, 'aa', 'CV', timestamp
      );
      legacy.prepare(`INSERT INTO uploaded_files(id,user_id,kind,original_name,mime_type,storage_key,size_bytes,sha256,extracted_text,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        'upload-windows', 'user-windows', 'CV', 'cv.txt', 'text/plain', 'C:\\job\\data\\uploads\\user-windows\\cv.txt', 2, 'bb', 'CV', timestamp
      );
    } finally {
      legacy.close();
    }

    const upgraded = new JobDatabase(path);
    try {
      const linux = upgraded.db.prepare('SELECT storage_key FROM uploaded_files WHERE id=?').get('upload-linux') as { storage_key: string } | undefined;
      const windows = upgraded.db.prepare('SELECT storage_key FROM uploaded_files WHERE id=?').get('upload-windows') as { storage_key: string } | undefined;
      assert.equal(linux?.storage_key, 'uploads/user-linux/cv.txt');
      assert.equal(windows?.storage_key, 'uploads/user-windows/cv.txt');
      const migration = upgraded.db.prepare("SELECT version FROM schema_migrations WHERE version='0004_portable_upload_storage_keys'").get() as { version: string } | undefined;
      assert.equal(migration?.version, '0004_portable_upload_storage_keys');
    } finally {
      upgraded.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
