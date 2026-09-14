import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JobDatabase } from './db.js';
import type { AppConfig } from './config.js';
import { AppStore } from './store.js';
import { boundedStringField, HttpError, readJson, sendJson } from './http.js';
import { FeatureFlagService } from './featureFlagService.js';
import { OutcomeInboxService } from './outcomeInboxService.js';
import { enforceExtendedOrigin, requireExtendedUser } from './extendedAuth.js';

export async function handleOutcomeInboxApi(req: IncomingMessage, res: ServerResponse, pathname: string, store: AppStore, db: JobDatabase, config: AppConfig): Promise<boolean> {
  if (!pathname.startsWith('/api/outcome-inbox')) return false;
  enforceExtendedOrigin(req, config);
  const user = requireExtendedUser(req, store);
  if (!new FeatureFlagService(db).isEnabled('outcome_inbox', { userId: user.id, role: user.role })) throw new HttpError(404, 'Outcome Inbox nie jest obecnie dostępny.', 'FEATURE_DISABLED');
  const service = new OutcomeInboxService(db), method = req.method ?? 'GET';
  if (method === 'GET' && pathname === '/api/outcome-inbox') { sendJson(res, 200, { suggestions: service.list(user.id) }); return true; }
  if (method === 'POST' && pathname === '/api/outcome-inbox/analyze') {
    const body = await readJson(req);
    const applicationId = boundedStringField(body, 'applicationId', 100, true, 1) ?? '';
    const messageText = boundedStringField(body, 'messageText', 20_000, true, 12) ?? '';
    const sourceLabel = boundedStringField(body, 'sourceLabel', 200, false);
    let suggestion;
    try { suggestion = service.analyze(user.id, applicationId, messageText, sourceLabel); }
    catch (error) { if (error instanceof Error && error.message === 'Nie znaleziono aplikacji.') throw new HttpError(404, error.message, 'NOT_FOUND'); throw error; }
    if (!suggestion) { sendJson(res, 200, { suggestion: null, message: 'Nie znaleziono wystarczająco jednoznacznego sygnału. Status aplikacji nie został zmieniony.' }); return true; }
    store.analytics(user.id, 'outcome_inbox_suggested', { suggestionType: suggestion.suggestionType, confidence: suggestion.confidence });
    sendJson(res, 201, { suggestion, message: 'To tylko sugestia. Status nie zmieni się bez Twojego potwierdzenia.' }); return true;
  }
  const confirm = pathname.match(/^\/api\/outcome-inbox\/([^/]+)\/confirm$/);
  if (method === 'PATCH' && confirm) {
    try {
      const suggestion = service.confirm(user.id, confirm[1] ?? '');
      if (!suggestion) throw new HttpError(404, 'Nie znaleziono sugestii.', 'NOT_FOUND');
      store.analytics(user.id, 'outcome_inbox_confirmed', { suggestionType: suggestion.suggestionType });
      sendJson(res, 200, { suggestion }); return true;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && /Nie można bezpiecznie zmienić statusu/.test(error.message)) throw new HttpError(409, error.message, 'INVALID_STATUS_TRANSITION');
      if (error instanceof Error && /Sugestia została odrzucona/.test(error.message)) throw new HttpError(409, error.message, 'SUGGESTION_DISMISSED');
      throw error;
    }
  }
  const dismiss = pathname.match(/^\/api\/outcome-inbox\/([^/]+)\/dismiss$/);
  if (method === 'PATCH' && dismiss) {
    const suggestion = service.dismiss(user.id, dismiss[1] ?? '');
    if (!suggestion) throw new HttpError(404, 'Nie znaleziono sugestii.', 'NOT_FOUND');
    store.analytics(user.id, 'outcome_inbox_dismissed', { suggestionType: suggestion.suggestionType });
    sendJson(res, 200, { suggestion }); return true;
  }
  sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' } }); return true;
}
