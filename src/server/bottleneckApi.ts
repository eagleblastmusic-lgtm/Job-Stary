import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JobDatabase } from './db.js';
import { AppStore } from './store.js';
import { hashSessionToken, parseCookies } from './auth.js';
import { HttpError, sendJson } from './http.js';
import { FeatureFlagService } from './featureFlagService.js';
import { BottleneckService } from './bottleneckService.js';

export function handleBottleneckApi(req: IncomingMessage, res: ServerResponse, pathname: string, store: AppStore, db: JobDatabase): boolean {
  if (pathname !== '/api/bottleneck') return false;
  if ((req.method ?? 'GET') !== 'GET') {
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' } });
    return true;
  }
  const raw = parseCookies(req.headers.cookie).job_session;
  if (!raw) throw new HttpError(401, 'Zaloguj się, aby kontynuować.', 'UNAUTHENTICATED');
  const user = store.getUserBySession(hashSessionToken(raw));
  if (!user) throw new HttpError(401, 'Zaloguj się, aby kontynuować.', 'UNAUTHENTICATED');
  const flags = new FeatureFlagService(db);
  if (!flags.isEnabled('bottleneck', { userId: user.id, role: user.role })) throw new HttpError(404, 'Analiza wąskiego gardła nie jest obecnie dostępna.', 'FEATURE_DISABLED');

  const report = new BottleneckService(db).build(user.id);
  store.analytics(user.id, 'bottleneck_opened', { confidence: report.overallConfidence, hasPrimary: report.primary !== null });
  sendJson(res, 200, { report });
  return true;
}
