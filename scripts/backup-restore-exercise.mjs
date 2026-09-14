import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { JobDatabase } from '../dist/server/db.js';
import { AppStore } from '../dist/server/store.js';
import { resolveStoredFilePath, storeCvUpload } from '../dist/server/files.js';
import { parseJobText } from '../dist/domain/jobParser.js';

const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'job-backup-restore-'));
const sourceData = resolve(root, 'source-data');
const targetData = resolve(root, 'restored-data');
const backupDir = resolve(root, 'backup');
const sourceDbPath = resolve(sourceData, 'job.sqlite');
const targetDbPath = resolve(targetData, 'job.sqlite');
const uploadContents = 'Excel\nPrawo jazdy kat. B\nUDT\nBackup restore exercise';
const uploadHash = createHash('sha256').update(uploadContents).digest('hex');

await mkdir(sourceData, { recursive: true });
let userId = '';
let jobId = '';
let applicationId = '';
let uploadStorageKey = '';

try {
  const sourceDb = new JobDatabase(sourceDbPath);
  try {
    const store = new AppStore(sourceDb);
    const user = store.createUser({ email: 'restore.exercise@example.test', passwordHash: 'exercise-only-hash', name: 'Backup Exercise', role: 'USER' });
    userId = user.id;
    store.recordConsent(user.id, 'TERMS', true, 'exercise-v1');
    store.recordConsent(user.id, 'PRIVACY', true, 'exercise-v1');
    store.recordConsent(user.id, 'ANALYTICS', false, 'exercise-v1');
    store.updateProfile(user.id, {
      desiredRoles: ['Magazynier'],
      location: 'Gdynia',
      commuteKm: 25,
      remotePreferences: ['ONSITE'],
      salaryMin: 6000,
      contractPreferences: ['UMOWA_O_PRACE'],
      shiftPreferences: { nights: false, weekends: null },
      availability: 'od zaraz'
    });
    store.insertFact(user.id, {
      type: 'SKILL',
      value: 'Excel',
      normalizedValue: 'excel',
      level: 'średniozaawansowany',
      source: 'USER',
      status: 'CONFIRMED',
      confidence: 1,
      evidence: 'Ćwiczenie backup/restore',
      allowedForCv: true
    });

    const upload = await storeCvUpload({
      dataDir: sourceData,
      userId: user.id,
      filename: 'cv.txt',
      mimeType: 'text/plain',
      base64: Buffer.from(uploadContents, 'utf8').toString('base64'),
      maxBytes: 1024 * 1024
    });
    uploadStorageKey = upload.storageKey;
    assert.equal(upload.storageKey.includes(sourceData), false, 'storage key must not contain the source filesystem root');
    store.recordUpload(user.id, upload);

    const jobText = [
      'Magazynier — Gdynia',
      'Umowa o pracę, praca stacjonarna.',
      'Wymagane: prawo jazdy kat. B i znajomość Excel.',
      'Mile widziane uprawnienia UDT.',
      'Wynagrodzenie 6500-7500 zł brutto miesięcznie.'
    ].join('\n');
    const parsed = parseJobText(jobText);
    jobId = store.createJob(user.id, jobText, parsed);
    applicationId = store.createApplication(user.id, jobId, 'APPLIED');
    store.addOutcome(user.id, applicationId, 'CONTACTED');
  } finally {
    sourceDb.close();
  }

  await execFileAsync(process.execPath, [
    'scripts/backup.mjs',
    '--data-dir', sourceData,
    '--database', sourceDbPath,
    '--output', backupDir
  ], { cwd: process.cwd() });

  await execFileAsync(process.execPath, [
    'scripts/restore.mjs',
    '--source', backupDir,
    '--data-dir', targetData,
    '--database', targetDbPath
  ], { cwd: process.cwd() });

  assert.notEqual(sourceData, targetData, 'exercise must restore to a different filesystem root');
  const restoredDb = new JobDatabase(targetDbPath);
  try {
    const db = restoredDb.db;
    const user = db.prepare('SELECT email,name FROM users WHERE id=?').get(userId);
    assert.ok(user, 'user must survive restore');
    assert.equal(user.email, 'restore.exercise@example.test');
    assert.equal(user.name, 'Backup Exercise');

    const profile = db.prepare('SELECT desired_roles,location,salary_min FROM career_profiles WHERE user_id=?').get(userId);
    assert.ok(profile, 'career profile must survive restore');
    assert.equal(profile.location, 'Gdynia');
    assert.equal(profile.salary_min, 6000);
    assert.deepEqual(JSON.parse(profile.desired_roles), ['Magazynier']);

    const fact = db.prepare('SELECT value,status,allowed_for_cv FROM career_facts WHERE user_id=? AND normalized_value=?').get(userId, 'excel');
    assert.ok(fact, 'career fact must survive restore');
    assert.equal(fact.value, 'Excel');
    assert.equal(fact.status, 'CONFIRMED');
    assert.equal(fact.allowed_for_cv, 1);

    const consentCount = db.prepare('SELECT COUNT(*) AS count FROM consents WHERE user_id=?').get(userId);
    assert.equal(Number(consentCount?.count ?? 0), 3);
    const analyticsConsent = db.prepare("SELECT granted FROM consents WHERE user_id=? AND consent_type='ANALYTICS' ORDER BY created_at DESC LIMIT 1").get(userId);
    assert.equal(analyticsConsent?.granted, 0);

    const job = db.prepare('SELECT id,raw_text FROM jobs WHERE id=? AND user_id=?').get(jobId, userId);
    assert.equal(job?.id, jobId);
    assert.match(String(job?.raw_text ?? ''), /Magazynier/);
    const application = db.prepare('SELECT id,status FROM applications WHERE id=? AND user_id=?').get(applicationId, userId);
    assert.ok(application, 'application must survive restore');
    assert.equal(application.id, applicationId);
    assert.equal(application.status, 'APPLIED');
    const outcome = db.prepare('SELECT outcome_type FROM outcomes WHERE application_id=?').get(applicationId);
    assert.equal(outcome?.outcome_type, 'CONTACTED');

    const upload = db.prepare('SELECT storage_key,sha256 FROM uploaded_files WHERE user_id=?').get(userId);
    assert.ok(upload, 'upload metadata must survive restore');
    assert.equal(upload.storage_key, uploadStorageKey);
    assert.match(String(upload.storage_key), /^uploads\//);
    assert.equal(String(upload.storage_key).includes(sourceData), false);
    assert.equal(upload.sha256, uploadHash);
    const restoredUploadPath = resolveStoredFilePath(targetData, String(upload.storage_key));
    assert.equal(await readFile(restoredUploadPath, 'utf8'), uploadContents);
    assert.equal(createHash('sha256').update(await readFile(restoredUploadPath)).digest('hex'), uploadHash);

    const migration = db.prepare("SELECT version FROM schema_migrations WHERE version='0004_portable_upload_storage_keys'").get();
    assert.equal(migration?.version, '0004_portable_upload_storage_keys');
    const integrity = db.prepare('PRAGMA integrity_check').get();
    assert.ok(integrity && Object.values(integrity).includes('ok'), 'restored database must pass SQLite integrity_check');
  } finally {
    restoredDb.close();
  }

  console.log('BACKUP_RESTORE_EXERCISE_OK');
} finally {
  await rm(root, { recursive: true, force: true });
}
