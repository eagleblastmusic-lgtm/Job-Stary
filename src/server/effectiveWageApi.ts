import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JobDatabase } from './db.js';
import type { AppConfig } from './config.js';
import { AppStore } from './store.js';
import { hashSessionToken, parseCookies } from './auth.js';
import { HttpError, readJson, sendJson } from './http.js';
import { FeatureFlagService } from './featureFlagService.js';
import { EffectiveWageService } from './effectiveWageService.js';
import type { EffectiveWagePreferences } from '../domain/effectiveWage.js';

function requireUser(req: IncomingMessage, store: AppStore) {
  const raw = parseCookies(req.headers.cookie).job_session;
  if (!raw) throw new HttpError(401, 'Zaloguj się, aby kontynuować.', 'UNAUTHENTICATED');
  const user = store.getUserBySession(hashSessionToken(raw));
  if (!user) throw new HttpError(401, 'Zaloguj się, aby kontynuować.', 'UNAUTHENTICATED');
  return user;
}

function enforceOrigin(req: IncomingMessage, config: AppConfig): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? 'GET')) return;
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new HttpError(403, 'Nieprawidłowe źródło żądania.', 'ORIGIN_REJECTED');
  const origin = req.headers.origin;
  if (origin && origin !== config.appOrigin) throw new HttpError(403, 'Nieprawidłowe źródło żądania.', 'ORIGIN_REJECTED');
}

function optionalNumber(body: Record<string, unknown>, key: string, min: number, max: number): number | null {
  const value = body[key];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new HttpError(400, `Pole ${key} ma nieprawidłową wartość.`, 'VALIDATION_ERROR');
  return value;
}

function requiredNumber(body: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new HttpError(400, `Pole ${key} ma nieprawidłową wartość.`, 'VALIDATION_ERROR');
  return value;
}

function preferencesFromBody(body: Record<string, unknown>): EffectiveWagePreferences {
  return {
    commuteRoundTripKm: optionalNumber(body, 'commuteRoundTripKm', 0, 1000),
    commuteMinutesPerDay: optionalNumber(body, 'commuteMinutesPerDay', 0, 1440),
    commuteDaysPerMonth: Math.round(requiredNumber(body, 'commuteDaysPerMonth', 0, 31)),
    vehicleCostPerKm: optionalNumber(body, 'vehicleCostPerKm', 0, 100),
    estimatedNetRatio: optionalNumber(body, 'estimatedNetRatio', 0.01, 1),
    monthlyWorkHours: requiredNumber(body, 'monthlyWorkHours', 1, 300),
    subjectiveTimeValuePerHour: optionalNumber(body, 'subjectiveTimeValuePerHour', 0, 10000)
  };
}

export async function handleEffectiveWageApi(req: IncomingMessage, res: ServerResponse, pathname: string, store: AppStore, db: JobDatabase, config: AppConfig): Promise<boolean> {
  if (!pathname.startsWith('/api/effective-wage')) return false;
  enforceOrigin(req, config);
  const user = requireUser(req, store);
  if (!new FeatureFlagService(db).isEnabled('effective_wage', { userId: user.id, role: user.role })) throw new HttpError(404, 'Kalkulator efektywnego wynagrodzenia nie jest obecnie dostępny.', 'FEATURE_DISABLED');
  const service = new EffectiveWageService(db);
  const method = req.method ?? 'GET';

  if (method === 'GET' && pathname === '/api/effective-wage/preferences') {
    sendJson(res, 200, { preferences: service.getPreferences(user.id) }); return true;
  }
  if (method === 'PUT' && pathname === '/api/effective-wage/preferences') {
    const preferences = service.setPreferences(user.id, preferencesFromBody(await readJson(req)));
    store.analytics(user.id, 'effective_wage_preferences_updated');
    sendJson(res, 200, { preferences }); return true;
  }
  if (method === 'GET' && pathname === '/api/effective-wage/jobs') {
    sendJson(res, 200, { jobs: service.listJobs(user.id) }); return true;
  }
  const calculationMatch = pathname.match(/^\/api\/effective-wage\/jobs\/([^/]+)$/);
  if (method === 'GET' && calculationMatch) {
    const calculation = service.calculate(user.id, calculationMatch[1] ?? '');
    if (!calculation) throw new HttpError(404, 'Nie znaleziono oferty.', 'NOT_FOUND');
    store.analytics(user.id, 'effective_wage_calculated', { salaryPeriod: calculation.job.salaryPeriod, grossNet: calculation.job.grossNet });
    sendJson(res, 200, { calculation }); return true;
  }
  sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' } });
  return true;
}
