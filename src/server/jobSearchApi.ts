import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from './config.js';
import type { JobDatabase } from './db.js';
import type { AppStore } from './store.js';
import { HttpError, sendJson } from './http.js';
import { requireExtendedUser } from './extendedAuth.js';
import { FeatureFlagService } from './featureFlagService.js';
import { JobSearchService } from './jobSearchService.js';

function parseRadius(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, 'Promień musi być liczbą.', 'INVALID_JOB_SEARCH_RADIUS');
  return parsed;
}

export async function handleJobSearchApi(req: IncomingMessage, res: ServerResponse, pathname: string, store: AppStore, db: JobDatabase, config: AppConfig): Promise<boolean> {
  if (pathname !== '/api/job-search') return false;
  if ((req.method ?? 'GET') !== 'GET') {
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' } });
    return true;
  }
  const user = requireExtendedUser(req, store);
  const flags = new FeatureFlagService(db);
  if (!flags.isEnabled('job_feed', { userId: user.id, role: user.role })) throw new HttpError(404, 'Wyszukiwarka ofert nie jest obecnie dostępna.', 'FEATURE_DISABLED');
  const url = new URL(req.url ?? pathname, config.appOrigin);
  const query = (url.searchParams.get('q') ?? '').trim();
  const location = (url.searchParams.get('location') ?? '').trim() || null;
  const radiusKm = parseRadius(url.searchParams.get('radiusKm'));
  if (query.length < 2) throw new HttpError(400, 'Wpisz co najmniej 2 znaki wyszukiwanej pracy.', 'INVALID_JOB_SEARCH_QUERY');
  const service = new JobSearchService(db, store, config);
  try {
    const result = await service.search(user.id, { query, location, radiusKm });
    store.analytics(user.id, 'federated_job_search', {
      queryLength: query.length,
      hasLocation: Boolean(location),
      radiusKm,
      providerCount: result.providers.length,
      importedCount: result.importedCount,
      newCanonicalCount: result.newCanonicalCount
    });
    sendJson(res, 200, result);
  } catch (error) {
    if (error instanceof Error) throw new HttpError(400, error.message, 'INVALID_JOB_SEARCH');
    throw error;
  }
  return true;
}
