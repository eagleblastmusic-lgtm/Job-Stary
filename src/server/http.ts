import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

export const DEFAULT_JSON_MAX_BYTES = 64 * 1024;

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code = 'REQUEST_ERROR') { super(message); }
}

export async function readJson(req: IncomingMessage, maxBytes = DEFAULT_JSON_MAX_BYTES): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new HttpError(413, 'Żądanie jest zbyt duże.', 'PAYLOAD_TOO_LARGE');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Nieprawidłowy JSON.', 'INVALID_JSON');
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(payload));
  res.end(payload);
}

export function sendText(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.statusCode = status;
  res.setHeader('content-type', contentType);
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

export async function serveStatic(res: ServerResponse, publicDir: string, requestPath: string): Promise<boolean> {
  const decoded = decodeURIComponent(requestPath.split('?')[0] ?? '/');
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const safe = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
  const path = join(publicDir, safe);
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    const body = await readFile(path);
    res.statusCode = 200;
    res.setHeader('content-type', MIME[extname(path).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('content-length', body.length);
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

export const stringField = (body: Record<string, unknown>, key: string, required = true): string | null => {
  const value = body[key];
  if (value === null || value === undefined || value === '') {
    if (required) throw new HttpError(400, `Brak pola: ${key}.`, 'VALIDATION_ERROR');
    return null;
  }
  if (typeof value !== 'string') throw new HttpError(400, `Pole ${key} musi być tekstem.`, 'VALIDATION_ERROR');
  return value.trim();
};

export function boundedStringField(body: Record<string, unknown>, key: string, maxLength: number, required = true, minLength = 0): string | null {
  const value = stringField(body, key, required);
  if (value === null) return null;
  if (value.length > maxLength) throw new HttpError(400, `Pole ${key} może mieć maksymalnie ${maxLength} znaków.`, 'FIELD_TOO_LONG');
  if (value.length < minLength) throw new HttpError(400, `Pole ${key} musi mieć co najmniej ${minLength} znaków.`, 'VALIDATION_ERROR');
  return value;
}

export const stringArrayField = (body: Record<string, unknown>, key: string): string[] => {
  const value = body[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new HttpError(400, `Pole ${key} musi być listą tekstową.`, 'VALIDATION_ERROR');
  return value.map(item => item.trim()).filter(Boolean);
};

export function boundedStringArrayField(body: Record<string, unknown>, key: string, maxItems: number, maxItemLength: number): string[] {
  const raw = body[key];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some(item => typeof item !== 'string')) throw new HttpError(400, `Pole ${key} musi być listą tekstową.`, 'VALIDATION_ERROR');
  if (raw.length > maxItems) throw new HttpError(400, `Pole ${key} może zawierać maksymalnie ${maxItems} elementów.`, 'TOO_MANY_ITEMS');
  const values = raw.map(item => item.trim()).filter(Boolean);
  if (values.some(item => item.length > maxItemLength)) throw new HttpError(400, `Element pola ${key} może mieć maksymalnie ${maxItemLength} znaków.`, 'FIELD_TOO_LONG');
  return values;
}

export function boundedObjectField(body: Record<string, unknown>, key: string, maxKeys: number, maxBytes: number): Record<string, unknown> {
  const value = body[key];
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, `Pole ${key} musi być obiektem.`, 'VALIDATION_ERROR');
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length > maxKeys) throw new HttpError(400, `Pole ${key} może zawierać maksymalnie ${maxKeys} właściwości.`, 'TOO_MANY_ITEMS');
  if (Buffer.byteLength(JSON.stringify(object), 'utf8') > maxBytes) throw new HttpError(400, `Pole ${key} jest zbyt duże.`, 'FIELD_TOO_LONG');
  return object;
}

export const nullableNumberField = (body: Record<string, unknown>, key: string): number | null => {
  const value = body[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, `Pole ${key} musi być liczbą.`, 'VALIDATION_ERROR');
  return value;
};

export const nullableBooleanField = (body: Record<string, unknown>, key: string): boolean | null => {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') throw new HttpError(400, `Pole ${key} musi być wartością logiczną.`, 'VALIDATION_ERROR');
  return value;
};
