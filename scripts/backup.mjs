import { DatabaseSync } from 'node:sqlite';
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const dataDir = resolve(arg('--data-dir', process.env.DATA_DIR ?? './data'));
const databasePath = resolve(arg('--database', process.env.DATABASE_PATH ?? `${dataDir}/job.sqlite`));
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve(arg('--output', `./backups/job-${timestamp}`));
await mkdir(output, { recursive: true, mode: 0o700 });

await stat(databasePath);
const destinationDb = resolve(output, 'job.sqlite');
const escaped = destinationDb.replaceAll("'", "''");
const db = new DatabaseSync(databasePath);
try {
  db.exec(`VACUUM INTO '${escaped}'`);
} finally {
  db.close();
}

const uploads = resolve(dataDir, 'uploads');
try { await stat(uploads); await cp(uploads, resolve(output, 'uploads'), { recursive: true }); } catch { /* no uploads yet */ }
const manifest = {
  createdAt: new Date().toISOString(),
  sourceDatabase: basename(databasePath),
  format: 1,
  note: 'Consistent SQLite snapshot created with VACUUM INTO; uploads copied separately.'
};
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log(output);
