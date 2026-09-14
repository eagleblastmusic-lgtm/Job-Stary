import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const KNOWN_KEYS = new Set(['today','interview_pack','skill_roi','career_transition','strategy_engine','job_feed']);
const ALLOWED_ROLLOUTS = new Set([0, 10, 50, 100]);
const key = process.argv[2]?.trim();
const enabledRaw = process.argv[3]?.trim().toLowerCase();
const rollout = Number(process.argv[4] ?? '0');

if (!key || !KNOWN_KEYS.has(key) || !['on','off'].includes(enabledRaw ?? '') || !ALLOWED_ROLLOUTS.has(rollout)) {
  console.error('Użycie: node scripts/set-feature-flag.mjs <key> <on|off> <0|10|50|100>');
  process.exit(2);
}

const enabled = enabledRaw === 'on';
const dataDir = resolve(process.env.DATA_DIR ?? './data');
const databasePath = resolve(process.env.DATABASE_PATH ?? `${dataDir}/job.sqlite`);
const db = new DatabaseSync(databasePath);

try {
  const current = db.prepare('SELECT key,enabled,rollout_percent FROM feature_flags WHERE key=?').get(key);
  if (!current) {
    console.error(`Nie znaleziono feature flag: ${key}`);
    process.exitCode = 1;
  } else {
    const timestamp = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE feature_flags SET enabled=?,rollout_percent=?,updated_at=? WHERE key=?').run(enabled ? 1 : 0, rollout, timestamp, key);
      db.prepare('INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,metadata,created_at) VALUES(?,?,?,?,?,?,?)').run(
        randomUUID(), null, 'FEATURE_FLAG_UPDATED_OUT_OF_BAND', 'feature_flag', key,
        JSON.stringify({ previous: { enabled: current.enabled === 1, rolloutPercent: current.rollout_percent }, next: { enabled, rolloutPercent: rollout }, method: 'local-cli' }),
        timestamp
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    console.log(`FEATURE_FLAG_UPDATED ${key} enabled=${enabled} rollout=${rollout}`);
  }
} finally {
  db.close();
}
