import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.js';

export const MAX_EMAIL_LENGTH = 254;
export const MAX_PASSWORD_LENGTH = 256;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertEmail(email: string): void {
  if (email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Podaj poprawny adres e-mail.', 'INVALID_EMAIL');
  }
}

export function assertPassword(password: string): void {
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, `Hasło może mieć maksymalnie ${MAX_PASSWORD_LENGTH} znaków.`, 'PASSWORD_TOO_LONG');
  }
  if (password.length < 10) throw new HttpError(400, 'Hasło musi mieć co najmniej 10 znaków.', 'WEAK_PASSWORD');
  if (!/[A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż]/.test(password) || !/\d/.test(password)) {
    throw new HttpError(400, 'Hasło powinno zawierać litery i cyfrę.', 'WEAK_PASSWORD');
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}.${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split('.');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = scryptSync(password, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const DUMMY_LOGIN_HASH = (() => {
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const hash = scryptSync('NieistniejaceKonto123', salt, 64);
  return `${salt.toString('hex')}.${hash.toString('hex')}`;
})();

/**
 * Always performs one scrypt verification for normal-sized login input,
 * including when the account does not exist, reducing the timing difference
 * between an unknown email and a wrong password for a real account.
 */
export function verifyLoginPassword(password: string, stored: string | null | undefined): boolean {
  const valid = verifyPassword(password, stored ?? DUMMY_LOGIN_HASH);
  return Boolean(stored) && valid;
}

export function newSessionToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export function hashSessionToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(header.split(';').map(part => {
    const index = part.indexOf('=');
    if (index < 0) return [part.trim(), ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}
