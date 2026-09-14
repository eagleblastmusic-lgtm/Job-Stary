import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deleteStoredFile, resolveStoredFilePath, storeCvUpload } from '../server/files.js';
import { HttpError } from '../server/http.js';
import type { MalwareScanner } from '../server/malwareScanner.js';

const encoded = (text: string): string => Buffer.from(text, 'utf8').toString('base64');
const noScan = { requireMalwareScan: false } as const;

async function expectUploadError(run: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(run, error => error instanceof HttpError && error.status >= 400 && error.code === code);
}

test('text CV uses a portable storage key and is stored privately', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-upload-'));
  try {
    const result = await storeCvUpload({ dataDir: dir, userId: 'user-1', filename: 'cv.txt', mimeType: 'text/plain', base64: encoded('Excel\nUDT\nPrawo jazdy B'), maxBytes: 1024 * 1024, ...noScan });
    assert.equal(result.originalName, 'cv.txt');
    assert.match(result.extractedText ?? '', /Excel/);
    assert.equal(result.sha256.length, 64);
    assert.match(result.storageKey, /^uploads\/user-1\/[a-f0-9-]+\.txt$/);
    assert.equal(result.storageKey.includes(dir), false);
    assert.equal(await readFile(resolveStoredFilePath(dir, result.storageKey), 'utf8'), 'Excel\nUDT\nPrawo jazdy B');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('stored file deletion resolves the key under DATA_DIR only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-upload-delete-'));
  try {
    const result = await storeCvUpload({ dataDir: dir, userId: 'user-1', filename: 'cv.txt', mimeType: 'text/plain', base64: encoded('portable'), maxBytes: 1024, ...noScan });
    const path = resolveStoredFilePath(dir, result.storageKey);
    await deleteStoredFile(dir, result.storageKey);
    await assert.rejects(readFile(path), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('storage key resolver rejects traversal and absolute paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-upload-path-'));
  const sentinel = resolve(dir, 'outside.txt');
  try {
    await writeFile(sentinel, 'keep me');
    assert.throws(() => resolveStoredFilePath(dir, 'uploads/user-1/../../outside.txt'), /Invalid upload storage key|escapes/);
    assert.throws(() => resolveStoredFilePath(dir, sentinel), /Absolute upload storage keys/);
    await assert.rejects(deleteStoredFile(dir, 'uploads/user-1/../../outside.txt'));
    assert.equal(await readFile(sentinel, 'utf8'), 'keep me');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('upload rejects MIME/extension mismatch and spoofed PDF signature', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-upload-'));
  try {
    await expectUploadError(() => storeCvUpload({ dataDir: dir, userId: 'user-1', filename: 'cv.exe', mimeType: 'text/plain', base64: encoded('hello'), maxBytes: 1024, ...noScan }), 'UPLOAD_EXTENSION_MISMATCH');
    await expectUploadError(() => storeCvUpload({ dataDir: dir, userId: 'user-1', filename: 'cv.pdf', mimeType: 'application/pdf', base64: encoded('not really a pdf'), maxBytes: 1024, ...noScan }), 'UPLOAD_SIGNATURE_MISMATCH');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('clean malware scan allows extraction and storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-upload-clean-'));
  let scannedPath = '';
  const scanner: MalwareScanner = async path => { scannedPath = path; return { status: 'CLEAN' }; };
  try {
    const result = await storeCvUpload({ dataDir: dir, userId: 'user-1', filename: 'cv.txt', mimeType: 'text/plain', base64: encoded('Excel'), maxBytes: 1024, malwareScanner: scanner, requireMalwareScan: true });
    assert.equal(scannedPath, resolveStoredFilePath(dir, result.storageKey));
    assert.equal(result.extractedText, 'Excel');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('infected upload is rejected and deleted before extraction/persistence can continue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-upload-infected-'));
  const scanner: MalwareScanner = async () => ({ status: 'INFECTED' });
  try {
    await expectUploadError(() => storeCvUpload({ dataDir: dir, userId: 'user-1', filename: 'cv.txt', mimeType: 'text/plain', base64: encoded('malicious payload'), maxBytes: 1024, malwareScanner: scanner, requireMalwareScan: true }), 'UPLOAD_MALWARE_DETECTED');
    assert.deepEqual(await readdir(join(dir, 'uploads', 'user-1')), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('infected DOCX is scanned before archive structure processing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-upload-infected-docx-'));
  const scanner: MalwareScanner = async () => ({ status: 'INFECTED' });
  const fakeDocx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('not-a-valid-office-archive')]);
  try {
    await expectUploadError(() => storeCvUpload({ dataDir: dir, userId: 'user-1', filename: 'cv.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64: fakeDocx.toString('base64'), maxBytes: 1024, malwareScanner: scanner, requireMalwareScan: true }), 'UPLOAD_MALWARE_DETECTED');
    assert.deepEqual(await readdir(join(dir, 'uploads', 'user-1')), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('configured scanner failure rejects and deletes the upload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-upload-scan-error-'));
  const scanner: MalwareScanner = async () => ({ status: 'ERROR', reason: 'timeout' });
  try {
    await expectUploadError(() => storeCvUpload({ dataDir: dir, userId: 'user-1', filename: 'cv.txt', mimeType: 'text/plain', base64: encoded('unscanned'), maxBytes: 1024, malwareScanner: scanner, requireMalwareScan: false }), 'UPLOAD_MALWARE_SCAN_UNAVAILABLE');
    assert.deepEqual(await readdir(join(dir, 'uploads', 'user-1')), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('required malware scan fails closed before writing when no scanner exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-upload-no-scanner-'));
  try {
    await expectUploadError(() => storeCvUpload({ dataDir: dir, userId: 'user-1', filename: 'cv.txt', mimeType: 'text/plain', base64: encoded('candidate data'), maxBytes: 1024, requireMalwareScan: true }), 'UPLOAD_MALWARE_SCAN_UNAVAILABLE');
    await assert.rejects(readdir(join(dir, 'uploads', 'user-1')), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
