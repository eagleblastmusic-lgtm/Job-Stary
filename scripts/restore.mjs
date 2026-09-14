import { DatabaseSync } from 'node:sqlite';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const sourceArg = arg('--source', null);
if (!sourceArg) throw new Error('Pass --source <backup-directory>.');
const source = resolve(sourceArg);
const dataDir = resolve(arg('--data-dir', process.env.DATA_DIR ?? './data'));
const databasePath = resolve(arg('--database', process.env.DATABASE_PATH ?? `${dataDir}/job.sqlite`));
const force = process.argv.includes('--force');
const sourceDb = resolve(source, 'job.sqlite');
await stat(sourceDb);
const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));
if (manifest.format !== 1) throw new Error('Unsupported backup format.');

if (!force) {
  try {
    await stat(databasePath);
    throw new Error('Target database already exists. Re-run with --force after taking a fresh backup.');
  } catch (error) {
    if (error instanceof Error && !error.message.includes('ENOENT') && !error.message.includes('no such file')) throw error;
  }
}
await mkdir(dataDir, { recursive: true, mode: 0o700 });
if (force) {
  await rm(databasePath, { force: true });
  await rm(`${databasePath}-wal`, { force: true });
  await rm(`${databasePath}-shm`, { force: true });
}
await cp(sourceDb, databasePath);
const sourceUploads = resolve(source, 'uploads');
try {
  await stat(sourceUploads);
  const targetUploads = resolve(dataDir, 'uploads');
  if (force) await rm(targetUploads, { recursive: true, force: true });
  await cp(sourceUploads, targetUploads, { recursive: true });
} catch { /* backup had no uploads */ }

const db = new DatabaseSync(databasePath);
try {
  const integrity = db.prepare('PRAGMA integrity_check').get();
  if (!integrity || !Object.values(integrity).includes('ok')) throw new Error(`Restored database failed integrity check: ${JSON.stringify(integrity)}`);
} finally { db.close(); }
console.log(`Restored backup from ${source}`);
