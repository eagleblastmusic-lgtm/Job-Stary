import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JobDatabase } from './db.js';
import type { AppConfig } from './config.js';
import { AppStore } from './store.js';
import { hashSessionToken, parseCookies } from './auth.js';
import { boundedStringField, HttpError, readJson, sendJson } from './http.js';
import { FeatureFlagService } from './featureFlagService.js';
import { LocalLabourService, type LocalLabourAreaLinkInput, type LocalLabourSnapshotInput } from './localLabourService.js';
import type { ShortageStatus } from '../domain/localLabour.js';

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

function numberField(body: Record<string, unknown>, key: string, required = false): number | null {
  const value = body[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `Pole ${key} jest wymagane.`, 'VALIDATION_ERROR');
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, `Pole ${key} musi być liczbą.`, 'VALIDATION_ERROR');
  return value;
}

function stringArrayField(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length > 200)) throw new HttpError(400, `Pole ${key} musi być listą krótkich tekstów.`, 'VALIDATION_ERROR');
  return value as string[];
}

function shortageStatus(value: unknown): ShortageStatus {
  if (value === undefined || value === null || value === '') return 'UNKNOWN';
  if (value === 'BIG_DEFICIT' || value === 'DEFICIT' || value === 'BALANCE' || value === 'SURPLUS' || value === 'UNKNOWN') return value;
  throw new HttpError(400, 'Nieprawidłowy status popytu/podaży.', 'VALIDATION_ERROR');
}

function translateServiceError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  if (error instanceof Error && /Najpierw uzupełnij|Nie znamy|Nieprawidł|musi używać HTTPS|nie należy do dozwolonego/.test(error.message)) {
    throw new HttpError(400, error.message, 'LOCAL_LABOUR_VALIDATION');
  }
  throw error;
}

export async function handleLocalLabourApi(req: IncomingMessage, res: ServerResponse, pathname: string, store: AppStore, db: JobDatabase, config: AppConfig): Promise<boolean> {
  if (pathname !== '/api/local-labour' && !pathname.startsWith('/api/admin/local-labour/')) return false;
  enforceOrigin(req, config);
  const method = req.method ?? 'GET';
  const user = requireUser(req, store);
  const service = new LocalLabourService(db);

  if (pathname.startsWith('/api/admin/local-labour/')) {
    if (user.role !== 'ADMIN') throw new HttpError(403, 'Brak uprawnień administratora.', 'FORBIDDEN');
    if (method !== 'PUT') { sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' } }); return true; }
    const body = await readJson(req);
    try {
      if (pathname === '/api/admin/local-labour/snapshot') {
        const sourceName = boundedStringField(body, 'sourceName', 40, true) as LocalLabourSnapshotInput['sourceName'];
        if (!['BAROMETR_ZAWODOW','GUS_BDL','OTHER_OFFICIAL'].includes(sourceName)) throw new HttpError(400, 'Nieprawidłowe źródło danych.', 'VALIDATION_ERROR');
        const areaType = boundedStringField(body, 'areaType', 30, true) as LocalLabourSnapshotInput['areaType'];
        if (!['POWIAT','CITY','VOIVODESHIP'].includes(areaType)) throw new HttpError(400, 'Nieprawidłowy typ obszaru.', 'VALIDATION_ERROR');
        const year = numberField(body, 'year', true) as number;
        service.upsertSnapshot({
          areaName: boundedStringField(body, 'areaName', 200, true) ?? '', areaType,
          roleName: boundedStringField(body, 'roleName', 200, true) ?? '', roleAliases: stringArrayField(body, 'roleAliases'), year,
          shortageStatus: shortageStatus(body.shortageStatus), registeredUnemployed: numberField(body, 'registeredUnemployed'),
          offersPup: numberField(body, 'offersPup'), offersCbop: numberField(body, 'offersCbop'), offersOnline: numberField(body, 'offersOnline'),
          salaryMin: numberField(body, 'salaryMin'), salaryMax: numberField(body, 'salaryMax'), requiredCredentials: stringArrayField(body, 'requiredCredentials'),
          sourceName, sourceUrl: boundedStringField(body, 'sourceUrl', 2_000, true) ?? '', sourceLicense: boundedStringField(body, 'sourceLicense', 200, false),
          sourceUpdatedAt: boundedStringField(body, 'sourceUpdatedAt', 100, false)
        });
        store.audit(user.id, 'LOCAL_LABOUR_SNAPSHOT_UPSERTED', 'local_labour', null, { sourceName, year });
        sendJson(res, 200, { ok: true }); return true;
      }
      if (pathname === '/api/admin/local-labour/area-link') {
        const input: LocalLabourAreaLinkInput = {
          fromArea: boundedStringField(body, 'fromArea', 200, true) ?? '', toArea: boundedStringField(body, 'toArea', 200, true) ?? '',
          distanceKm: numberField(body, 'distanceKm', true) as number,
          sourceName: boundedStringField(body, 'sourceName', 200, true) ?? '', sourceUrl: boundedStringField(body, 'sourceUrl', 2_000, true) ?? ''
        };
        service.upsertAreaLink(input);
        store.audit(user.id, 'LOCAL_LABOUR_AREA_LINK_UPSERTED', 'local_labour', null, { fromArea: input.fromArea, toArea: input.toArea, distanceKm: input.distanceKm });
        sendJson(res, 200, { ok: true }); return true;
      }
    } catch (error) { translateServiceError(error); }
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' } }); return true;
  }

  const flags = new FeatureFlagService(db);
  if (!flags.isEnabled('local_labour', { userId: user.id, role: user.role })) throw new HttpError(404, 'Lokalna analiza rynku nie jest obecnie dostępna.', 'FEATURE_DISABLED');
  if (method !== 'GET') { sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' } }); return true; }
  const url = new URL(req.url ?? pathname, config.appOrigin);
  const role = url.searchParams.get('role');
  const area = url.searchParams.get('area');
  if ((role?.length ?? 0) > 200 || (area?.length ?? 0) > 200) throw new HttpError(400, 'Zbyt długa wartość filtra.', 'VALIDATION_ERROR');
  try {
    const report = service.build(user.id, role, area);
    store.analytics(user.id, 'local_labour_opened', { confidence: report.confidence, accessibleAreas: report.accessibleAreas.length, radiusSignal: report.plusTenKm.status });
    sendJson(res, 200, { report });
  } catch (error) { translateServiceError(error); }
  return true;
}
