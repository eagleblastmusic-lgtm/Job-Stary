import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Użycie: node scripts/provision-admin.mjs admin@example.pl');
  process.exit(2);
}

const dataDir = resolve(process.env.DATA_DIR ?? './data');
const databasePath = resolve(process.env.DATABASE_PATH ?? `${dataDir}/job.sqlite`);
const db = new DatabaseSync(databasePath);

try {
  const user = db.prepare('SELECT id,email,role FROM users WHERE lower(email)=lower(?)').get(email);
  if (!user) {
    console.error(`Nie znaleziono istniejącego konta: ${email}`);
    process.exitCode = 1;
  } else {
    const timestamp = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE users SET role='ADMIN', updated_at=? WHERE id=?").run(timestamp, user.id);
      db.prepare('INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,metadata,created_at) VALUES(?,?,?,?,?,?,?)').run(
        randomUUID(), user.id, 'ADMIN_PROVISIONED_OUT_OF_BAND', 'user', user.id, JSON.stringify({ previousRole: user.role, method: 'local-cli' }), timestamp
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    console.log(`ADMIN_PROVISIONED ${user.email}`);
  }
} finally {
  db.close();
}
