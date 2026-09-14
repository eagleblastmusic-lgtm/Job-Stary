import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { JobDatabase } from './db.js';
import { loadConfig, type AppConfig } from './config.js';
import { AppStore, type UserRecord } from './store.js';
import { assertEmail, assertPassword, hashPassword, hashSessionToken, MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH, newSessionToken, normalizeEmail, parseCookies, verifyLoginPassword, verifyPassword } from './auth.js';
import { deleteStoredFile, storeCvUpload } from './files.js';
import { cvToPdf } from './pdf.js';
import { boundedStringArrayField, boundedStringField, HttpError, nullableBooleanField, nullableNumberField, readJson, sendJson, sendText, serveStatic, stringField } from './http.js';
import { inferCareerFactsFromText } from '../domain/careerTruth.js';
import { normalizeText } from '../domain/ontology.js';
import { parseJobText } from '../domain/jobParser.js';
import { decideJob } from '../domain/decisionEngine.js';
import { buildApplicationPackage, buildCvDocument } from '../domain/cvEngine.js';
import { canTransitionApplication } from '../domain/statusTransitions.js';
import type { ApplicationStatus, CareerFactStatus, CareerProfile } from '../domain/types.js';
import { AiGateway } from './aiGateway.js';

const LEGAL_VERSION = '2026-09-05-test-v1';
const JOB_TEXT_MAX_CHARS = 100_000;
const JOB_JSON_MAX_BYTES = 256 * 1024;

interface AppRuntime {
  server: Server;
  db: JobDatabase;
  store: AppStore;
  config: AppConfig;
  close: () => Promise<void>;
}

interface RateEntry { count: number; resetAt: number }
type RateMap = Map<string, RateEntry>;

function securityHeaders(res: ServerResponse, config: AppConfig): void {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  if (config.nodeEnv === 'production') res.setHeader('strict-transport-security', 'max-age=31536000');
}

function clientIp(req: IncomingMessage, config: AppConfig): string {
  if (config.trustProxy) {
    const header = req.headers['x-forwarded-for'];
    const forwarded = Array.isArray(header) ? header[0] : header;
    const candidate = forwarded?.split(',')[0]?.trim();
    if (candidate && isIP(candidate)) return candidate;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function enforceRate(rateMap: RateMap, key: string, limit: number, windowMs: number): void {
  const time = Date.now();
  const current = rateMap.get(key);
  if (!current || current.resetAt <= time) {
    rateMap.set(key, { count: 1, resetAt: time + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) throw new HttpError(429, 'Za dużo prób. Spróbuj ponownie później.', 'RATE_LIMITED');
}

function enforceOrigin(req: IncomingMessage, config: AppConfig): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? 'GET')) return;
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new HttpError(403, 'Nieprawidłowe źródło żądania.', 'ORIGIN_REJECTED');
  }
  const origin = req.headers.origin;
  if (origin && origin !== config.appOrigin) throw new HttpError(403, 'Nieprawidłowe źródło żądania.', 'ORIGIN_REJECTED');
}

function mapStoreNotFound<T>(operation: () => T, storeMessage: string, clientMessage = storeMessage): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof Error && error.message === storeMessage) throw new HttpError(404, clientMessage, 'NOT_FOUND');
    throw error;
  }
}

function cookieForSession(raw: string, config: AppConfig): string {
  const parts = [`job_session=${encodeURIComponent(raw)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${config.sessionDays * 86400}`];
  if (config.nodeEnv === 'production') parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie(config: AppConfig): string {
  return `job_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.nodeEnv === 'production' ? '; Secure' : ''}`;
}

function currentUser(req: IncomingMessage, store: AppStore): UserRecord | null {
  const raw = parseCookies(req.headers.cookie).job_session;
  if (!raw) return null;
  return store.getUserBySession(hashSessionToken(raw));
}

function requireUser(req: IncomingMessage, store: AppStore): UserRecord {
  const user = currentUser(req, store);
  if (!user) throw new HttpError(401, 'Zaloguj się, aby kontynuować.', 'UNAUTHENTICATED');
  return user;
}

function requireAdmin(req: IncomingMessage, store: AppStore): UserRecord {
  const user = requireUser(req, store);
  if (user.role !== 'ADMIN') throw new HttpError(403, 'Brak uprawnień administratora.', 'FORBIDDEN');
  return user;
}

function parseProfile(body: Record<string, unknown>): CareerProfile {
  const shiftsRaw = body.shiftPreferences;
  const shifts = shiftsRaw && typeof shiftsRaw === 'object' && !Array.isArray(shiftsRaw) ? shiftsRaw as Record<string, unknown> : {};
  const salaryModeRaw = body.salaryMode;
  const salaryMode = salaryModeRaw === 'DISCLOSED_ONLY' ? 'DISCLOSED_ONLY' : 'EXCLUDE_LOWER';
  return {
    desiredRoles: boundedStringArrayField(body, 'desiredRoles', 20, 120),
    location: boundedStringField(body, 'location', 200, false),
    commuteKm: nullableNumberField(body, 'commuteKm'),
    remotePreferences: boundedStringArrayField(body, 'remotePreferences', 10, 80),
    salaryMin: nullableNumberField(body, 'salaryMin'),
    salaryMode,
    contractPreferences: boundedStringArrayField(body, 'contractPreferences', 10, 80),
    shiftPreferences: {
      nights: nullableBooleanField(shifts, 'nights'),
      weekends: nullableBooleanField(shifts, 'weekends')
    },
    availability: boundedStringField(body, 'availability', 200, false)
  };
}

function recommendationLabel(value: string): string {
  return ({ APPLY_NOW: 'APLIKUJ TERAZ', APPLY: 'WARTO APLIKOWAĆ', CONSIDER: 'ROZWAŻ', PROBABLY_SKIP: 'RACZEJ ODPUŚĆ', LOW_FIT: 'NISKIE DOPASOWANIE' } as Record<string, string>)[value] ?? value;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string, store: AppStore, config: AppConfig, _ai: AiGateway, rateMap: RateMap): Promise<boolean> {
  if (!pathname.startsWith('/api/')) return false;
  enforceOrigin(req, config);
  const method = req.method ?? 'GET';

  if (method === 'GET' && pathname === '/api/health') {
    const timestamp = new Date().toISOString();
    try {
      store.diagnostics();
      sendJson(res, 200, { ok: true, service: 'job', version: '0.1.0', database: 'ok', now: timestamp });
    } catch {
      sendJson(res, 503, { ok: false, service: 'job', version: '0.1.0', database: 'unavailable', now: timestamp });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/legal') {
    sendJson(res, 200, { legalVersion: LEGAL_VERSION, termsUrl: '/terms.html', privacyUrl: '/privacy.html' }); return true;
  }

  if (method === 'POST' && pathname === '/api/auth/register') {
    enforceRate(rateMap, `register:${clientIp(req, config)}`, 15, 15 * 60_000);
    const body = await readJson(req);
    const email = normalizeEmail(stringField(body, 'email') ?? '');
    const password = stringField(body, 'password') ?? '';
    const name = boundedStringField(body, 'name', 80, true, 2) ?? '';
    assertEmail(email); assertPassword(password);
    if (body.acceptTerms !== true || body.acceptPrivacy !== true) throw new HttpError(400, 'Aby utworzyć konto, zaakceptuj warunki i informację o prywatności.', 'REQUIRED_CONSENT_MISSING');
    if (store.getUserByEmail(email)) throw new HttpError(409, 'Konto z tym adresem już istnieje.', 'EMAIL_EXISTS');
    const role = config.adminEmails.has(email) ? 'ADMIN' : 'USER';
    const user = store.createUser({ email, passwordHash: hashPassword(password), name, role });
    store.recordConsent(user.id, 'TERMS', true, LEGAL_VERSION);
    store.recordConsent(user.id, 'PRIVACY', true, LEGAL_VERSION);
    store.recordConsent(user.id, 'ANALYTICS', body.analyticsConsent === true, LEGAL_VERSION);
    const token = newSessionToken();
    const expires = new Date(Date.now() + config.sessionDays * 86400_000).toISOString();
    store.createSession(user.id, token.hash, expires);
    store.analytics(user.id, 'signup_completed'); store.audit(user.id, 'ACCOUNT_CREATED', 'user', user.id);
    res.setHeader('set-cookie', cookieForSession(token.raw, config));
    sendJson(res, 201, { user: { id: user.id, email: user.email, name: user.name, role: user.role } }); return true;
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    enforceRate(rateMap, `login:${clientIp(req, config)}`, 20, 15 * 60_000);
    const body = await readJson(req);
    const email = normalizeEmail(stringField(body, 'email') ?? '');
    const password = stringField(body, 'password') ?? '';
    if (!email || email.length > MAX_EMAIL_LENGTH || !password || password.length > MAX_PASSWORD_LENGTH) {
      throw new HttpError(401, 'Nieprawidłowy e-mail lub hasło.', 'INVALID_CREDENTIALS');
    }
    const user = store.getUserByEmail(email);
    if (!verifyLoginPassword(password, user?.passwordHash)) throw new HttpError(401, 'Nieprawidłowy e-mail lub hasło.', 'INVALID_CREDENTIALS');
    if (!user) throw new HttpError(401, 'Nieprawidłowy e-mail lub hasło.', 'INVALID_CREDENTIALS');
    const token = newSessionToken();
    const expires = new Date(Date.now() + config.sessionDays * 86400_000).toISOString();
    store.createSession(user.id, token.hash, expires);
    store.audit(user.id, 'LOGIN', 'user', user.id);
    res.setHeader('set-cookie', cookieForSession(token.raw, config));
    sendJson(res, 200, { user: { id: user.id, email: user.email, name: user.name, role: user.role } }); return true;
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    const raw = parseCookies(req.headers.cookie).job_session;
    if (raw) store.deleteSession(hashSessionToken(raw));
    res.setHeader('set-cookie', clearSessionCookie(config));
    sendJson(res, 200, { ok: true }); return true;
  }

  if (method === 'GET' && pathname === '/api/me') {
    const user = requireUser(req, store);
    sendJson(res, 200, { user: { id: user.id, email: user.email, name: user.name, role: user.role, locale: user.locale, timezone: user.timezone }, profile: store.getProfile(user.id), subscription: store.getSubscription(user.id) }); return true;
  }

  if (method === 'GET' && pathname === '/api/consents') {
    const user = requireUser(req, store);
    sendJson(res, 200, { legalVersion: LEGAL_VERSION, consents: store.listConsents(user.id) }); return true;
  }

  if (method === 'PUT' && pathname === '/api/consents/analytics') {
    const user = requireUser(req, store); const body = await readJson(req);
    if (typeof body.granted !== 'boolean') throw new HttpError(400, 'Pole granted musi być wartością true albo false.', 'INVALID_CONSENT_VALUE');
    const consent = store.recordConsent(user.id, 'ANALYTICS', body.granted, LEGAL_VERSION);
    sendJson(res, 200, { consent }); return true;
  }

  if (method === 'PUT' && pathname === '/api/profile') {
    const user = requireUser(req, store); const body = await readJson(req); const profile = parseProfile(body);
    store.updateProfile(user.id, profile); store.analytics(user.id, 'onboarding_completed');
    sendJson(res, 200, { profile }); return true;
  }

  if (method === 'GET' && pathname === '/api/career-truth') {
    const user = requireUser(req, store);
    sendJson(res, 200, { facts: store.listFacts(user.id), experiences: store.listExperiences(user.id), education: store.listEducation(user.id) }); return true;
  }

  if (method === 'POST' && pathname === '/api/career-truth/facts') {
    const user = requireUser(req, store); const body = await readJson(req);
    const value = boundedStringField(body, 'value', 500, true, 1) ?? '';
    const type = boundedStringField(body, 'type', 50, true, 1) ?? 'SKILL';
    const fact = store.insertFact(user.id, { type, value, normalizedValue: normalizeText(value), level: boundedStringField(body, 'level', 100, false), source: 'USER', status: 'CONFIRMED', confidence: 1, evidence: 'Dodane i potwierdzone przez użytkownika.', allowedForCv: true });
    store.analytics(user.id, 'career_fact_confirmed'); sendJson(res, 201, { fact }); return true;
  }

  const factStatusMatch = pathname.match(/^\/api\/career-truth\/facts\/([^/]+)\/status$/);
  if (method === 'PATCH' && factStatusMatch) {
    const user = requireUser(req, store); const body = await readJson(req);
    const status = boundedStringField(body, 'status', 32) as CareerFactStatus;
    if (!['CONFIRMED','INFERRED','UNKNOWN','NOT_POSSESSED','EXPIRED','CONFLICTING'].includes(status)) throw new HttpError(400, 'Nieprawidłowy status faktu.');
    const fact = mapStoreNotFound(() => store.updateFactStatus(user.id, factStatusMatch[1] ?? '', status, status === 'CONFIRMED'), 'Nie znaleziono faktu zawodowego.');
    store.analytics(user.id, status === 'CONFIRMED' ? 'career_fact_confirmed' : 'career_fact_corrected');
    sendJson(res, 200, { fact }); return true;
  }

  const factDeleteMatch = pathname.match(/^\/api\/career-truth\/facts\/([^/]+)$/);
  if (method === 'DELETE' && factDeleteMatch) {
    const user = requireUser(req, store);
    const factId = factDeleteMatch[1] ?? '';
    mapStoreNotFound(() => store.deleteFact(user.id, factId), 'Nie znaleziono faktu zawodowego.');
    store.analytics(user.id, 'career_fact_removed'); store.audit(user.id, 'CAREER_FACT_REMOVED', 'career_fact', factId);
    sendJson(res, 200, { ok: true }); return true;
  }

  if (method === 'POST' && pathname === '/api/experiences') {
    const user = requireUser(req, store); const body = await readJson(req);
    const employer = boundedStringField(body, 'employer', 200, true, 1) ?? '';
    const title = boundedStringField(body, 'title', 200, true, 1) ?? '';
    const current = body.current === true;
    const experience = store.addExperience(user.id, {
      employer, title, normalizedTitle: normalizeText(title), startDate: boundedStringField(body, 'startDate', 32, false), endDate: current ? null : boundedStringField(body, 'endDate', 32, false),
      current, description: boundedStringField(body, 'description', 10_000, false), achievements: boundedStringArrayField(body, 'achievements', 30, 1_000)
    });
    sendJson(res, 201, { experience }); return true;
  }

  const experienceDeleteMatch = pathname.match(/^\/api\/experiences\/([^/]+)$/);
  if (method === 'DELETE' && experienceDeleteMatch) {
    const user = requireUser(req, store);
    const experienceId = experienceDeleteMatch[1] ?? '';
    mapStoreNotFound(() => store.deleteExperience(user.id, experienceId), 'Nie znaleziono doświadczenia.');
    store.analytics(user.id, 'experience_removed'); store.audit(user.id, 'EXPERIENCE_REMOVED', 'career_experience', experienceId);
    sendJson(res, 200, { ok: true }); return true;
  }

  if (method === 'POST' && pathname === '/api/education') {
    const user = requireUser(req, store); const body = await readJson(req);
    const institution = boundedStringField(body, 'institution', 200, true, 1) ?? '';
    const education = store.addEducation(user.id, {
      institution,
      field: boundedStringField(body, 'field', 200, false),
      degree: boundedStringField(body, 'degree', 120, false),
      startDate: boundedStringField(body, 'startDate', 32, false),
      endDate: boundedStringField(body, 'endDate', 32, false),
      description: boundedStringField(body, 'description', 10_000, false)
    });
    store.analytics(user.id, 'education_added');
    sendJson(res, 201, { education }); return true;
  }

  const educationDeleteMatch = pathname.match(/^\/api\/education\/([^/]+)$/);
  if (method === 'DELETE' && educationDeleteMatch) {
    const user = requireUser(req, store);
    const educationId = educationDeleteMatch[1] ?? '';
    mapStoreNotFound(() => store.deleteEducation(user.id, educationId), 'Nie znaleziono wykształcenia.');
    store.analytics(user.id, 'education_removed'); store.audit(user.id, 'EDUCATION_REMOVED', 'education', educationId);
    sendJson(res, 200, { ok: true }); return true;
  }

  if (method === 'POST' && pathname === '/api/cv/upload') {
    const user = requireUser(req, store); const body = await readJson(req, config.maxUploadBytes * 2);
    const upload = await storeCvUpload({ dataDir: config.dataDir, userId: user.id, filename: boundedStringField(body, 'filename', 255) ?? 'cv', mimeType: boundedStringField(body, 'mimeType', 100) ?? 'application/octet-stream', base64: stringField(body, 'base64') ?? '', maxBytes: config.maxUploadBytes });
    store.recordUpload(user.id, upload);
    const inferred = upload.extractedText ? inferCareerFactsFromText(upload.extractedText, `CV:${upload.id}`) : [];
    const created = store.upsertInferredFacts(user.id, inferred.map(f => ({ ...f, level: null })));
    store.analytics(user.id, 'cv_uploaded'); if (upload.extractedText) store.analytics(user.id, 'cv_parsed');
    store.audit(user.id, 'CV_UPLOADED', 'uploaded_file', upload.id, { mimeType: upload.mimeType, sizeBytes: upload.sizeBytes });
    sendJson(res, 201, { upload: { id: upload.id, originalName: upload.originalName, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes, extracted: Boolean(upload.extractedText) }, inferredFacts: created }); return true;
  }

  if (method === 'POST' && pathname === '/api/jobs/parse') {
    const user = requireUser(req, store); enforceRate(rateMap, `jobparse:${user.id}`, 60, 3600_000); const body = await readJson(req, JOB_JSON_MAX_BYTES);
    const text = boundedStringField(body, 'text', JOB_TEXT_MAX_CHARS, true, 20) ?? '';
    const parsed = parseJobText(text); const jobId = store.createJob(user.id, text, parsed);
    store.analytics(user.id, 'job_added'); store.analytics(user.id, 'job_parsed');
    sendJson(res, 201, { jobId, job: parsed }); return true;
  }

  const decisionMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/decide$/);
  if (method === 'POST' && decisionMatch) {
    const user = requireUser(req, store); const found = store.getJob(user.id, decisionMatch[1] ?? '');
    if (!found) throw new HttpError(404, 'Nie znaleziono oferty.', 'NOT_FOUND');
    const decision = decideJob(store.getProfile(user.id), store.listFacts(user.id), found.job); const decisionId = store.saveDecision(user.id, found.id, decision);
    store.analytics(user.id, 'decision_viewed', { recommendation: decision.recommendation });
    sendJson(res, 200, { decisionId, decision: { ...decision, label: recommendationLabel(decision.recommendation) } }); return true;
  }

  const overrideMatch = pathname.match(/^\/api\/decisions\/([^/]+)\/override$/);
  if (method === 'POST' && overrideMatch) {
    const user = requireUser(req, store); const body = await readJson(req); const override = boundedStringField(body, 'override', 50, true, 1) ?? '';
    mapStoreNotFound(() => store.setDecisionOverride(user.id, overrideMatch[1] ?? '', override, boundedStringField(body, 'reason', 2_000, false)), 'Nie znaleziono decyzji.');
    store.analytics(user.id, 'decision_overridden', { override }); sendJson(res, 200, { ok: true }); return true;
  }

  const packageMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/application-package$/);
  if (method === 'POST' && packageMatch) {
    const user = requireUser(req, store); const found = store.getJob(user.id, packageMatch[1] ?? ''); if (!found) throw new HttpError(404, 'Nie znaleziono oferty.', 'NOT_FOUND');
    const cv = buildCvDocument({ name: user.name, profile: store.getProfile(user.id), facts: store.listFacts(user.id), experiences: store.listExperiences(user.id), education: store.listEducation(user.id) });
    const pack = buildApplicationPackage(cv, found.job); store.analytics(user.id, 'application_package_created'); store.analytics(user.id, 'cv_generated');
    sendJson(res, 200, { package: pack, pdfUrl: `/api/cv/base.pdf?jobId=${encodeURIComponent(found.id)}` }); return true;
  }

  if (method === 'GET' && pathname === '/api/cv/base.pdf') {
    const user = requireUser(req, store);
    const cv = buildCvDocument({ name: user.name, profile: store.getProfile(user.id), facts: store.listFacts(user.id), experiences: store.listExperiences(user.id), education: store.listEducation(user.id) });
    const pdf = await cvToPdf(cv, config.pdfRendererBin);
    store.analytics(user.id, 'cv_exported'); res.statusCode = 200; res.setHeader('content-type', 'application/pdf'); res.setHeader('content-disposition', 'attachment; filename="cv.pdf"'); res.setHeader('content-length', pdf.length); res.end(pdf); return true;
  }

  if (method === 'GET' && pathname === '/api/applications') {
    const user = requireUser(req, store); sendJson(res, 200, { applications: store.listApplications(user.id) }); return true;
  }

  if (method === 'POST' && pathname === '/api/applications') {
    const user = requireUser(req, store); const body = await readJson(req);
    const jobId = boundedStringField(body, 'jobId', 100) ?? '';
    const statusRaw = (boundedStringField(body, 'status', 32, false) ?? 'SAVED') as ApplicationStatus;
    if (!['SAVED','APPLIED','CONTACTED','INTERVIEW','OFFER','CLOSED'].includes(statusRaw)) throw new HttpError(400, 'Nieprawidłowy status aplikacji.');
    if (!store.getJob(user.id, jobId)) throw new HttpError(404, 'Nie znaleziono oferty.', 'NOT_FOUND');
    const applicationId = store.createApplication(user.id, jobId, statusRaw); store.analytics(user.id, 'application_created', { status: statusRaw });
    sendJson(res, 201, { applicationId }); return true;
  }

  const applicationStatusMatch = pathname.match(/^\/api\/applications\/([^/]+)\/status$/);
  if (method === 'PATCH' && applicationStatusMatch) {
    const user = requireUser(req, store); const body = await readJson(req); const status = boundedStringField(body, 'status', 32) as ApplicationStatus;
    if (!['SAVED','APPLIED','CONTACTED','INTERVIEW','OFFER','CLOSED'].includes(status)) throw new HttpError(400, 'Nieprawidłowy status aplikacji.');
    const application = store.getApplication(user.id, applicationStatusMatch[1] ?? ''); if (!application) throw new HttpError(404, 'Nie znaleziono aplikacji.', 'NOT_FOUND');
    if (!canTransitionApplication(application.status, status)) throw new HttpError(400, `Niedozwolona zmiana statusu: ${application.status} → ${status}`, 'INVALID_STATUS_TRANSITION');
    mapStoreNotFound(() => store.updateApplicationStatus(user.id, application.id, status), 'Nie znaleziono aplikacji.');
    sendJson(res, 200, { ok: true }); return true;
  }

  const outcomeMatch = pathname.match(/^\/api\/applications\/([^/]+)\/outcomes$/);
  if (method === 'POST' && outcomeMatch) {
    const user = requireUser(req, store); const body = await readJson(req); const outcomeType = boundedStringField(body, 'outcomeType', 32) ?? '';
    const allowed = ['NO_RESPONSE','CONTACTED','INTERVIEW','REJECTED','OFFER','WAITING']; if (!allowed.includes(outcomeType)) throw new HttpError(400, 'Nieprawidłowy wynik rekrutacji.');
    const outcome = mapStoreNotFound(() => store.addOutcome(user.id, outcomeMatch[1] ?? '', outcomeType), 'Nie znaleziono aplikacji.');
    store.analytics(user.id, 'outcome_recorded', { outcomeType }); sendJson(res, 201, { outcome }); return true;
  }

  if (method === 'GET' && pathname === '/api/billing') {
    const user = requireUser(req, store); sendJson(res, 200, { subscription: store.getSubscription(user.id), products: [{ key: 'FREE', label: 'Free' }, { key: 'TRIAL', label: '7 dni premium' }, { key: 'PRO_MONTHLY', label: 'Pro miesięczny', price: null }, { key: 'JOB_SPRINT_90', label: '90-dniowy Job Sprint', price: null }], checkoutConfigured: false }); return true;
  }

  if (method === 'GET' && pathname === '/api/export') {
    const user = requireUser(req, store); store.audit(user.id, 'DATA_EXPORTED', 'user', user.id); sendJson(res, 200, store.exportUserData(user.id)); return true;
  }

  if (method === 'DELETE' && pathname === '/api/account') {
    const user = requireUser(req, store); enforceRate(rateMap, `account-delete:${user.id}`, 5, 15 * 60_000); const body = await readJson(req);
    const confirmation = boundedStringField(body, 'confirmation', 32) ?? '';
    if (confirmation !== 'USUŃ KONTO') throw new HttpError(400, 'Wpisz dokładnie: USUŃ KONTO');
    const password = stringField(body, 'password', false) ?? '';
    if (!password || password.length > MAX_PASSWORD_LENGTH || !verifyPassword(password, user.passwordHash)) {
      store.audit(user.id, 'ACCOUNT_DELETION_REAUTH_FAILED', 'user', user.id);
      throw new HttpError(401, 'Podaj poprawne aktualne hasło, aby usunąć konto.', 'REAUTH_FAILED');
    }
    for (const storageKey of store.listUploadPaths(user.id)) await deleteStoredFile(config.dataDir, storageKey);
    store.audit(user.id, 'ACCOUNT_DELETION_REQUESTED', 'user', user.id); store.deleteUser(user.id);
    await rm(resolve(config.dataDir, 'uploads', user.id), { recursive: true, force: true });
    res.setHeader('set-cookie', clearSessionCookie(config)); sendJson(res, 200, { ok: true }); return true;
  }

  if (method === 'GET' && pathname === '/api/admin/diagnostics') {
    requireAdmin(req, store); sendJson(res, 200, store.diagnostics()); return true;
  }

  sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Nie znaleziono endpointu.' } }); return true;
}

export function createJobApp(overrides: Partial<AppConfig> = {}): AppRuntime {
  const config = loadConfig(overrides); const db = new JobDatabase(config.databasePath); const store = new AppStore(db); const ai = new AiGateway(db, config); const rateMap: RateMap = new Map();
  store.purgeExpiredSessions();
  const publicDir = resolve(process.cwd(), 'dist/public');
  const server = createServer(async (req, res) => {
    const requestId = randomUUID(); securityHeaders(res, config); res.setHeader('x-request-id', requestId);
    if ((req.url ?? '/').startsWith('/api/')) {
      res.setHeader('cache-control', 'no-store');
      res.setHeader('pragma', 'no-cache');
    }
    try {
      const url = new URL(req.url ?? '/', config.appOrigin);
      if (await handleApi(req, res, url.pathname, store, config, ai, rateMap)) return;
      if (await serveStatic(res, publicDir, url.pathname)) return;
      if (!url.pathname.includes('.')) {
        if (await serveStatic(res, publicDir, '/index.html')) return;
      }
      sendText(res, 404, 'Nie znaleziono strony.');
    } catch (error) {
      const http = error instanceof HttpError ? error : new HttpError(500, 'Wystąpił błąd serwera.', 'INTERNAL_ERROR');
      if (!(error instanceof HttpError)) console.error(`[${requestId}]`, error);
      if (!res.headersSent) sendJson(res, http.status, { error: { code: http.code, message: http.message, requestId } }); else res.end();
    }
  });
  return { server, db, store, config, close: async () => { await new Promise<void>((resolveClose, reject) => server.close(err => err ? reject(err) : resolveClose())); db.close(); } };
}
