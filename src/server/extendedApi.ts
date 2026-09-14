import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JobDatabase } from './db.js';
import type { AppConfig } from './config.js';
import { AppStore, type UserRecord } from './store.js';
import { hashSessionToken, parseCookies } from './auth.js';
import { boundedStringField, HttpError, readJson, sendJson } from './http.js';
import { FeatureFlagService } from './featureFlagService.js';
import { TodayService } from './todayService.js';
import { NotificationService, type NotificationPreferences } from './notificationService.js';
import { InterviewPackService } from './interviewPackService.js';
import { JobFeedService, JobSourceRegistryService, type JobFeedState } from './jobFeedService.js';
import { UserProvidedJobConnector } from '../domain/jobSources.js';
import type { FeatureFlagKey } from '../domain/featureFlags.js';

function requireUser(req: IncomingMessage, store: AppStore): UserRecord {
  const raw = parseCookies(req.headers.cookie).job_session;
  if (!raw) throw new HttpError(401, 'Zaloguj się, aby kontynuować.', 'UNAUTHENTICATED');
  const user = store.getUserBySession(hashSessionToken(raw));
  if (!user) throw new HttpError(401, 'Zaloguj się, aby kontynuować.', 'UNAUTHENTICATED');
  return user;
}

function requireAdmin(user: UserRecord): void {
  if (user.role !== 'ADMIN') throw new HttpError(403, 'Brak uprawnień administratora.', 'FORBIDDEN');
}

function enforceOrigin(req: IncomingMessage, config: AppConfig): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? 'GET')) return;
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new HttpError(403, 'Nieprawidłowe źródło żądania.', 'ORIGIN_REJECTED');
  const origin = req.headers.origin;
  if (origin && origin !== config.appOrigin) throw new HttpError(403, 'Nieprawidłowe źródło żądania.', 'ORIGIN_REJECTED');
}

function requireFeature(flags: FeatureFlagService, user: UserRecord, key: FeatureFlagKey, message: string): void {
  if (!flags.isEnabled(key, { userId: user.id, role: user.role })) throw new HttpError(404, message, 'FEATURE_DISABLED');
}

function knownNotFound<T>(operation: () => T, message: string): T {
  try { return operation(); }
  catch (error) {
    if (error instanceof Error && error.message === message) throw new HttpError(404, message, 'NOT_FOUND');
    throw error;
  }
}

function booleanSetting(body: Record<string, unknown>, key: keyof NotificationPreferences): boolean {
  const value = body[key];
  if (typeof value !== 'boolean') throw new HttpError(400, `Pole ${key} musi być wartością true albo false.`, 'INVALID_NOTIFICATION_PREFERENCE');
  return value;
}

function feedState(body: Record<string, unknown>): JobFeedState {
  const value = boundedStringField(body, 'state', 30, true);
  if (value === 'RECOMMENDED' || value === 'SAVED' || value === 'HIDDEN' || value === 'NOT_INTERESTED') return value;
  throw new HttpError(400, 'Nieprawidłowy stan oferty.', 'INVALID_FEED_STATE');
}

function extendedUserExport(store: AppStore, db: JobDatabase, userId: string): Record<string, unknown> {
  const data = store.exportUserData(userId);
  data.daily_actions = db.db.prepare('SELECT * FROM daily_actions WHERE user_id=? ORDER BY created_at').all(userId);
  data.notification_preferences = db.db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').all(userId);
  data.notifications = db.db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at').all(userId);
  data.job_source_observations = db.db.prepare('SELECT * FROM job_source_observations WHERE user_id=? ORDER BY first_seen_at').all(userId);
  data.job_feed_states = db.db.prepare('SELECT * FROM job_feed_states WHERE user_id=? ORDER BY updated_at').all(userId);
  return data;
}

export async function handleExtendedApi(req: IncomingMessage, res: ServerResponse, pathname: string, store: AppStore, db: JobDatabase, config: AppConfig): Promise<boolean> {
  const method = req.method ?? 'GET';
  const interviewMatch = pathname.match(/^\/api\/applications\/([^/]+)\/interview-pack$/);
  const feedStateMatch = pathname.match(/^\/api\/job-feed\/([^/]+)\/state$/);
  const sourceAdminMatch = pathname.match(/^\/api\/admin\/job-sources\/([^/]+)$/);
  if (pathname !== '/api/features' && pathname !== '/api/export' && !pathname.startsWith('/api/today') && !pathname.startsWith('/api/notifications') && !pathname.startsWith('/api/job-feed') && !pathname.startsWith('/api/admin/job-sources') && !interviewMatch) return false;
  enforceOrigin(req, config);
  const user = requireUser(req, store);
  const flags = new FeatureFlagService(db);

  if (method === 'GET' && pathname === '/api/features') {
    sendJson(res, 200, { features: flags.effective({ userId: user.id, role: user.role }) }); return true;
  }
  if (method === 'GET' && pathname === '/api/export') {
    store.audit(user.id, 'DATA_EXPORTED', 'user', user.id);
    sendJson(res, 200, extendedUserExport(store, db, user.id)); return true;
  }

  if (pathname.startsWith('/api/admin/job-sources')) {
    requireAdmin(user);
    const registry = new JobSourceRegistryService(db);
    if (method === 'GET' && pathname === '/api/admin/job-sources') {
      sendJson(res, 200, { sources: registry.list() }); return true;
    }
    if (method === 'PATCH' && sourceAdminMatch) {
      const body = await readJson(req);
      if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'Pole enabled musi być wartością true albo false.', 'VALIDATION_ERROR');
      knownNotFound(() => registry.setEnabled(sourceAdminMatch[1] ?? '', body.enabled as boolean), 'Nie znaleziono źródła ofert.');
      store.audit(user.id, 'JOB_SOURCE_TOGGLED', 'job_source', sourceAdminMatch[1] ?? null, { enabled: body.enabled });
      sendJson(res, 200, { sources: registry.list() }); return true;
    }
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' } }); return true;
  }

  if (pathname.startsWith('/api/job-feed')) {
    requireFeature(flags, user, 'job_feed', 'Feed ofert nie jest obecnie dostępny.');
    const feed = new JobFeedService(db, store);
    const registry = new JobSourceRegistryService(db);
    if (method === 'GET' && pathname === '/api/job-feed') {
      const url = new URL(req.url ?? pathname, config.appOrigin);
      const rawLimit = Number(url.searchParams.get('limit') ?? 25);
      const rawOffset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number.isFinite(rawLimit) ? rawLimit : 25;
      const offset = Number.isFinite(rawOffset) ? rawOffset : 0;
      sendJson(res, 200, { jobs: feed.list(user.id, limit, offset), limit: Math.max(1, Math.min(50, Math.floor(limit))), offset: Math.max(0, Math.floor(offset)) }); return true;
    }
    if (method === 'GET' && pathname === '/api/job-feed/sources') {
      sendJson(res, 200, { sources: registry.list().filter(source => source.enabled === 1) }); return true;
    }
    if (method === 'POST' && pathname === '/api/job-feed/import-user') {
      const body = await readJson(req);
      const rawText = boundedStringField(body, 'rawText', 50_000, true, 20) ?? '';
      const sourceUrl = boundedStringField(body, 'sourceUrl', 2_000, false);
      const externalId = boundedStringField(body, 'externalId', 500, false);
      const publishedAt = boundedStringField(body, 'publishedAt', 100, false);
      const connector = new UserProvidedJobConnector([{ rawText, sourceUrl, externalId, publishedAt }]);
      let results;
      try { results = await feed.importFromConnector(user.id, connector); }
      catch (error) {
        if (error instanceof Error && error.message === 'Źródło ofert jest wyłączone.') throw new HttpError(503, error.message, 'JOB_SOURCE_DISABLED');
        throw error;
      }
      store.analytics(user.id, 'job_feed_imported', { canonicalCount: results.filter(result => result.createdCanonicalJob).length });
      sendJson(res, 201, { results, jobs: feed.list(user.id, 25, 0) }); return true;
    }
    if (method === 'PATCH' && feedStateMatch) {
      const body = await readJson(req);
      const state = feedState(body);
      knownNotFound(() => feed.setState(user.id, feedStateMatch[1] ?? '', state), 'Nie znaleziono oferty.');
      store.analytics(user.id, 'job_feed_state_changed', { state });
      sendJson(res, 200, { jobs: feed.list(user.id, 25, 0) }); return true;
    }
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' } }); return true;
  }

  if (interviewMatch) {
    requireFeature(flags, user, 'interview_pack', 'Pakiet przygotowania do rozmowy nie jest obecnie dostępny.');
    if (method !== 'GET') { sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' } }); return true; }
    const service = new InterviewPackService(store);
    const pack = knownNotFound(() => service.generate(user.id, interviewMatch[1] ?? ''), 'Nie znaleziono aplikacji.');
    store.analytics(user.id, 'interview_pack_opened');
    sendJson(res, 200, { pack }); return true;
  }

  if (pathname.startsWith('/api/notifications')) {
    requireFeature(flags, user, 'notifications', 'Powiadomienia nie są obecnie dostępne.');
    const notifications = new NotificationService(db);
    if (method === 'GET' && pathname === '/api/notifications/preferences') {
      sendJson(res, 200, { preferences: notifications.getPreferences(user.id) }); return true;
    }
    if (method === 'PUT' && pathname === '/api/notifications/preferences') {
      const body = await readJson(req);
      const preferences = notifications.setPreferences(user.id, {
        followUp: booleanSetting(body, 'followUp'), deadlines: booleanSetting(body, 'deadlines'),
        interviews: booleanSetting(body, 'interviews'), matchedJobs: booleanSetting(body, 'matchedJobs')
      });
      store.analytics(user.id, 'notification_preferences_updated');
      sendJson(res, 200, { preferences }); return true;
    }
    if (method === 'GET' && pathname === '/api/notifications') {
      const items = notifications.list(user.id, user.timezone);
      sendJson(res, 200, { notifications: items, unreadCount: items.filter(item => !item.readAt).length }); return true;
    }
    const readMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (method === 'PATCH' && readMatch) {
      const notification = knownNotFound(() => notifications.markRead(user.id, readMatch[1] ?? ''), 'Nie znaleziono powiadomienia.');
      sendJson(res, 200, { notification }); return true;
    }
    const dismissMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/dismiss$/);
    if (method === 'PATCH' && dismissMatch) {
      const notification = knownNotFound(() => notifications.dismiss(user.id, dismissMatch[1] ?? ''), 'Nie znaleziono powiadomienia.');
      sendJson(res, 200, { notification }); return true;
    }
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' } }); return true;
  }

  requireFeature(flags, user, 'today', 'Funkcja DZISIAJ nie jest obecnie dostępna.');
  const today = new TodayService(db);
  if (method === 'GET' && pathname === '/api/today') {
    sendJson(res, 200, { actions: today.listToday(user.id, user.timezone) }); return true;
  }
  if (method === 'POST' && pathname === '/api/today/recommendations') {
    const body = await readJson(req); const rawBudget = body.timeBudgetMinutes;
    if (typeof rawBudget !== 'number' || ![10, 30, 60, 120].includes(rawBudget)) throw new HttpError(400, 'Wybierz dostępny budżet czasu: 10, 30, 60 albo 120 minut.', 'INVALID_TIME_BUDGET');
    const actions = today.recommend(user.id, user.timezone, rawBudget);
    store.analytics(user.id, 'today_opened', { timeBudgetMinutes: rawBudget, actionCount: actions.length });
    sendJson(res, 200, { actions, timeBudgetMinutes: rawBudget }); return true;
  }
  const acceptMatch = pathname.match(/^\/api\/today\/actions\/([^/]+)\/accept$/);
  if (method === 'PATCH' && acceptMatch) {
    const action = knownNotFound(() => today.accept(user.id, acceptMatch[1] ?? ''), 'Nie znaleziono działania na dziś.');
    store.analytics(user.id, 'today_action_accepted', { actionType: action.type }); sendJson(res, 200, { action }); return true;
  }
  const completeMatch = pathname.match(/^\/api\/today\/actions\/([^/]+)\/complete$/);
  if (method === 'PATCH' && completeMatch) {
    const body = await readJson(req); const outcome = boundedStringField(body, 'outcome', 500, false);
    const action = knownNotFound(() => today.complete(user.id, completeMatch[1] ?? '', outcome), 'Nie znaleziono działania na dziś.');
    store.analytics(user.id, 'today_action_completed', { actionType: action.type }); sendJson(res, 200, { action }); return true;
  }

  sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' } }); return true;
}
