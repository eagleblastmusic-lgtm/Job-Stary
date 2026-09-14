import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JobDatabase } from './db.js';
import type { AppConfig } from './config.js';
import { AppStore } from './store.js';
import { hashSessionToken, parseCookies } from './auth.js';
import { boundedStringField, HttpError, readJson, sendJson } from './http.js';
import { FeatureFlagService } from './featureFlagService.js';
import { SkillRoiService } from './skillRoiService.js';

function requireUser(req: IncomingMessage, store: AppStore) {
  const raw = parseCookies(req.headers.cookie).job_session;
  if (!raw) throw new HttpError(401, 'Zaloguj się, aby kontynuować.', 'UNAUTHENTICATED');
  const user = store.getUserBySession(hashSessionToken(raw));
  if (!user) throw new HttpError(401, 'Zaloguj się, aby kontynuować.', 'UNAUTHENTICATED');
  return user;
}
function enforceOrigin(req: IncomingMessage, config: AppConfig): void {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method ?? 'GET')) return;
  const site = req.headers['sec-fetch-site']; if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Nieprawidłowe źródło żądania.', 'ORIGIN_REJECTED');
  const origin = req.headers.origin; if (origin && origin !== config.appOrigin) throw new HttpError(403, 'Nieprawidłowe źródło żądania.', 'ORIGIN_REJECTED');
}
function optionalNumber(body: Record<string, unknown>, key: string, max: number): number | null {
  const value = body[key]; if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new HttpError(400, `Pole ${key} ma nieprawidłową wartość.`, 'VALIDATION_ERROR'); return value;
}

export async function handleSkillRoiApi(req: IncomingMessage, res: ServerResponse, pathname: string, store: AppStore, db: JobDatabase, config: AppConfig): Promise<boolean> {
  if (!pathname.startsWith('/api/skill-roi')) return false;
  enforceOrigin(req, config); const user = requireUser(req, store);
  if (!new FeatureFlagService(db).isEnabled('skill_roi', { userId: user.id, role: user.role })) throw new HttpError(404, 'Skill ROI nie jest obecnie dostępny.', 'FEATURE_DISABLED');
  const service = new SkillRoiService(db); const method = req.method ?? 'GET';
  if (method === 'GET' && pathname === '/api/skill-roi') { sendJson(res, 200, { report: service.build(user.id) }); return true; }
  const match = pathname.match(/^\/api\/skill-roi\/assumptions\/([^/]+)$/);
  if (method === 'PUT' && match) {
    const body = await readJson(req); const skill = boundedStringField(body, 'skill', 200, true, 1) ?? decodeURIComponent(match[1] ?? '');
    const certification = body.certificationRequired;
    if (!(certification === null || certification === undefined || typeof certification === 'boolean')) throw new HttpError(400, 'Pole certificationRequired musi być true, false albo null.', 'VALIDATION_ERROR');
    const saved = service.setAssumption(user.id, { skill, normalizedSkill: decodeURIComponent(match[1] ?? ''), estimatedCost: optionalNumber(body, 'estimatedCost', 1_000_000), estimatedHours: optionalNumber(body, 'estimatedHours', 5000), certificationRequired: certification === undefined ? null : certification as boolean | null, certificationNote: boundedStringField(body, 'certificationNote', 500, false) });
    store.analytics(user.id, 'skill_roi_assumption_updated'); sendJson(res, 200, { assumption: saved, report: service.build(user.id) }); return true;
  }
  sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' } }); return true;
}
