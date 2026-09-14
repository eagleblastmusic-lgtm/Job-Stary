import { randomUUID } from 'node:crypto';
import type { JobDatabase } from './db.js';
import type {
  ApplicationStatus, CareerExperience, CareerFact, CareerFactStatus, CareerProfile,
  EducationRecord, JobDecisionResult, ParsedJob, ParsedJobRequirement, SalaryMode
} from '../domain/types.js';

const now = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);

interface UserRow { id: string; email: string; password_hash: string; name: string; locale: string; timezone: string; role: 'USER' | 'ADMIN'; created_at: string; updated_at: string }
interface ProfileRow { user_id: string; desired_roles: string; location: string | null; commute_km: number | null; remote_preferences: string; salary_min: number | null; salary_mode?: string | null; contract_preferences: string; shift_preferences: string; availability: string | null }
interface FactRow { id: string; type: string; value: string; normalized_value: string; level: string | null; source: string; status: CareerFactStatus; confidence: number; evidence: string | null; allowed_for_cv: number }
interface JobRow {
  id: string; source: string; source_url: string | null; raw_text: string; title: string | null; normalized_title: string | null; company: string | null; industry: string | null;
  location: string | null; remote_type: ParsedJob['remoteType']; contract_type: string | null; salary_min: number | null; salary_max: number | null; salary_period: ParsedJob['salaryPeriod'];
  gross_net: ParsedJob['grossNet']; working_hours: string | null; shift_pattern: string | null; night_work: number | null; weekend_work: number | null; travel_required: number | null;
  application_method: string | null; deadline: string | null; published_at: string | null; parsed_at: string; fingerprint: string;
}
interface ReqRow { type: string; canonical_requirement: string; importance: ParsedJobRequirement['importance']; confidence: number; provenance: string }
interface ExperienceRow { id: string; employer: string; title: string; normalized_title: string; start_date: string | null; end_date: string | null; current: number; description: string | null; achievements: string }
interface EducationRow { id: string; institution: string; field: string | null; degree: string | null; start_date: string | null; end_date: string | null; description: string | null }
interface ApplicationRow { id: string; job_id: string; status: ApplicationStatus; applied_at: string | null; source: string; current_stage: string; next_action: string | null; created_at: string; updated_at: string }
interface OutcomeRow { id: string; application_id: string; outcome_type: string; occurred_at: string; source: string; confidence: number; confirmed_by_user: number; created_at: string }
interface ConsentRow { consent_type: string; granted: number; version: string; created_at: string }

export interface ConsentRecord { type: string; granted: boolean; version: string; createdAt: string }

function profileFromRow(row: ProfileRow | undefined): CareerProfile {
  if (!row) return { desiredRoles: [], location: null, commuteKm: null, remotePreferences: [], salaryMin: null, salaryMode: 'EXCLUDE_LOWER', contractPreferences: [], shiftPreferences: { nights: null, weekends: null }, availability: null };
  const shifts = JSON.parse(row.shift_preferences) as { nights?: boolean | null; weekends?: boolean | null };
  const salaryMode = (row.salary_mode === 'DISCLOSED_ONLY' ? 'DISCLOSED_ONLY' : 'EXCLUDE_LOWER') as SalaryMode;
  return {
    desiredRoles: JSON.parse(row.desired_roles) as string[],
    location: row.location,
    commuteKm: row.commute_km,
    remotePreferences: JSON.parse(row.remote_preferences) as string[],
    salaryMin: row.salary_min,
    salaryMode,
    contractPreferences: JSON.parse(row.contract_preferences) as string[],
    shiftPreferences: { nights: shifts.nights ?? null, weekends: shifts.weekends ?? null },
    availability: row.availability
  };
}

function factFromRow(row: FactRow): CareerFact {
  return {
    id: row.id, type: row.type, value: row.value, normalizedValue: row.normalized_value, level: row.level,
    source: row.source, status: row.status, confidence: row.confidence, evidence: row.evidence, allowedForCv: row.allowed_for_cv === 1
  };
}

function jobFromRow(row: JobRow, requirements: ParsedJobRequirement[]): ParsedJob {
  return {
    title: row.title, normalizedTitle: row.normalized_title, company: row.company, location: row.location,
    remoteType: row.remote_type, contractType: row.contract_type, salaryMin: row.salary_min, salaryMax: row.salary_max,
    salaryPeriod: row.salary_period, grossNet: row.gross_net, workingHours: row.working_hours, shiftPattern: row.shift_pattern,
    nightWork: row.night_work === null ? null : row.night_work === 1, weekendWork: row.weekend_work === null ? null : row.weekend_work === 1,
    travelRequired: row.travel_required === null ? null : row.travel_required === 1, applicationMethod: row.application_method,
    deadline: row.deadline, publishedAt: row.published_at, requirements, fingerprint: row.fingerprint
  };
}

export interface UserRecord { id: string; email: string; passwordHash: string; name: string; locale: string; timezone: string; role: 'USER' | 'ADMIN'; createdAt: string; updatedAt: string }

export class AppStore {
  constructor(private readonly database: JobDatabase) {}
  private get db() { return this.database.db; }

  createUser(input: { email: string; passwordHash: string; name: string; role: 'USER' | 'ADMIN' }): UserRecord {
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(`INSERT INTO users(id,email,password_hash,name,locale,timezone,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(id, input.email, input.passwordHash, input.name, 'pl-PL', 'Europe/Warsaw', input.role, timestamp, timestamp);
    this.db.prepare(`INSERT INTO career_profiles(user_id,created_at,updated_at) VALUES(?,?,?)`).run(id, timestamp, timestamp);
    const trialEnd = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    this.db.prepare(`INSERT INTO subscriptions(id,user_id,plan,status,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).run(randomUUID(), id, 'TRIAL', 'TRIALING', trialEnd, timestamp, timestamp);
    return { id, email: input.email, passwordHash: input.passwordHash, name: input.name, locale: 'pl-PL', timezone: 'Europe/Warsaw', role: input.role, createdAt: timestamp, updatedAt: timestamp };
  }

  getUserByEmail(email: string): UserRecord | null {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
    return row ? this.mapUser(row) : null;
  }

  getUserById(id: string): UserRecord | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? this.mapUser(row) : null;
  }

  private mapUser(row: UserRow): UserRecord {
    return { id: row.id, email: row.email, passwordHash: row.password_hash, name: row.name, locale: row.locale, timezone: row.timezone, role: row.role, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  createSession(userId: string, tokenHash: string, expiresAt: string): void {
    this.db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(tokenHash, userId, expiresAt, now());
  }

  getUserBySession(tokenHash: string): UserRecord | null {
    const row = this.db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash, now()) as UserRow | undefined;
    return row ? this.mapUser(row) : null;
  }

  deleteSession(tokenHash: string): void { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash); }
  purgeExpiredSessions(): void { this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now()); }

  getProfile(userId: string): CareerProfile {
    return profileFromRow(this.db.prepare('SELECT * FROM career_profiles WHERE user_id=?').get(userId) as ProfileRow | undefined);
  }

  updateProfile(userId: string, profile: CareerProfile): void {
    const timestamp = now();
    const salaryMode = profile.salaryMode === 'DISCLOSED_ONLY' ? 'DISCLOSED_ONLY' : 'EXCLUDE_LOWER';
    this.db.prepare(`INSERT INTO career_profiles(user_id,desired_roles,location,commute_km,remote_preferences,salary_min,salary_mode,contract_preferences,shift_preferences,availability,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET desired_roles=excluded.desired_roles,location=excluded.location,commute_km=excluded.commute_km,remote_preferences=excluded.remote_preferences,salary_min=excluded.salary_min,salary_mode=excluded.salary_mode,contract_preferences=excluded.contract_preferences,shift_preferences=excluded.shift_preferences,availability=excluded.availability,updated_at=excluded.updated_at`).run(
      userId, json(profile.desiredRoles), profile.location, profile.commuteKm, json(profile.remotePreferences), profile.salaryMin, salaryMode, json(profile.contractPreferences), json(profile.shiftPreferences), profile.availability, timestamp, timestamp
    );
  }

  listFacts(userId: string): CareerFact[] {
    return (this.db.prepare('SELECT id,type,value,normalized_value,level,source,status,confidence,evidence,allowed_for_cv FROM career_facts WHERE user_id=? ORDER BY created_at DESC').all(userId) as unknown as FactRow[]).map(factFromRow);
  }

  insertFact(userId: string, fact: Omit<CareerFact, 'id'> & { id?: string }): CareerFact {
    const id = fact.id ?? randomUUID();
    const timestamp = now();
    this.db.prepare(`INSERT INTO career_facts(id,user_id,type,value,normalized_value,level,source,status,confidence,evidence,last_confirmed_at,allowed_for_cv,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, userId, fact.type, fact.value, fact.normalizedValue, fact.level, fact.source, fact.status, fact.confidence, fact.evidence,
      fact.status === 'CONFIRMED' ? timestamp : null, fact.allowedForCv ? 1 : 0, timestamp, timestamp
    );
    return { ...fact, id };
  }

  upsertInferredFacts(userId: string, facts: Array<Omit<CareerFact, 'id'> & { id?: string }>): CareerFact[] {
    const existing = new Map(this.listFacts(userId).map(f => [`${f.type}:${f.normalizedValue}`, f]));
    const inserted: CareerFact[] = [];
    for (const fact of facts) {
      const key = `${fact.type}:${fact.normalizedValue}`;
      if (!existing.has(key)) inserted.push(this.insertFact(userId, fact));
    }
    return inserted;
  }

  updateFactStatus(userId: string, factId: string, status: CareerFactStatus, allowedForCv: boolean): CareerFact {
    const timestamp = now();
    const result = this.db.prepare(`UPDATE career_facts SET status=?,confidence=?,allowed_for_cv=?,last_confirmed_at=?,updated_at=? WHERE id=? AND user_id=?`).run(
      status, status === 'CONFIRMED' || status === 'NOT_POSSESSED' ? 1 : 0.5, allowedForCv ? 1 : 0, status === 'CONFIRMED' ? timestamp : null, timestamp, factId, userId
    );
    if (Number(result.changes) !== 1) throw new Error('Nie znaleziono faktu zawodowego.');
    const row = this.db.prepare('SELECT id,type,value,normalized_value,level,source,status,confidence,evidence,allowed_for_cv FROM career_facts WHERE id=? AND user_id=?').get(factId, userId) as FactRow | undefined;
    if (!row) throw new Error('Nie znaleziono faktu zawodowego.');
    return factFromRow(row);
  }

  deleteFact(userId: string, factId: string): void {
    const result = this.db.prepare('DELETE FROM career_facts WHERE id=? AND user_id=?').run(factId, userId);
    if (Number(result.changes) !== 1) throw new Error('Nie znaleziono faktu zawodowego.');
  }

  addExperience(userId: string, input: Omit<CareerExperience, 'id'>): CareerExperience {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO career_experiences(id,user_id,employer,title,normalized_title,start_date,end_date,current,description,achievements) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      id, userId, input.employer, input.title, input.normalizedTitle, input.startDate, input.endDate, input.current ? 1 : 0, input.description, json(input.achievements)
    );
    return { id, ...input };
  }

  listExperiences(userId: string): CareerExperience[] {
    return (this.db.prepare('SELECT id,employer,title,normalized_title,start_date,end_date,current,description,achievements FROM career_experiences WHERE user_id=? ORDER BY start_date DESC').all(userId) as unknown as ExperienceRow[]).map(row => ({
      id: row.id, employer: row.employer, title: row.title, normalizedTitle: row.normalized_title, startDate: row.start_date, endDate: row.end_date, current: row.current === 1, description: row.description, achievements: JSON.parse(row.achievements) as string[]
    }));
  }

  deleteExperience(userId: string, experienceId: string): void {
    const result = this.db.prepare('DELETE FROM career_experiences WHERE id=? AND user_id=?').run(experienceId, userId);
    if (Number(result.changes) !== 1) throw new Error('Nie znaleziono doświadczenia.');
  }

  addEducation(userId: string, input: Omit<EducationRecord, 'id'>): EducationRecord {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO education(id,user_id,institution,field,degree,start_date,end_date,description) VALUES(?,?,?,?,?,?,?,?)`).run(
      id, userId, input.institution, input.field, input.degree, input.startDate, input.endDate, input.description
    );
    return { id, ...input };
  }

  listEducation(userId: string): EducationRecord[] {
    return (this.db.prepare('SELECT id,institution,field,degree,start_date,end_date,description FROM education WHERE user_id=? ORDER BY end_date DESC').all(userId) as unknown as EducationRow[]).map(row => ({
      id: row.id, institution: row.institution, field: row.field, degree: row.degree, startDate: row.start_date, endDate: row.end_date, description: row.description
    }));
  }

  deleteEducation(userId: string, educationId: string): void {
    const result = this.db.prepare('DELETE FROM education WHERE id=? AND user_id=?').run(educationId, userId);
    if (Number(result.changes) !== 1) throw new Error('Nie znaleziono wykształcenia.');
  }

  recordUpload(userId: string, upload: { id: string; originalName: string; mimeType: string; storageKey: string; sizeBytes: number; sha256: string; extractedText: string | null }): void {
    this.db.prepare(`INSERT INTO uploaded_files(id,user_id,kind,original_name,mime_type,storage_key,size_bytes,sha256,extracted_text,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      upload.id, userId, 'CV', upload.originalName, upload.mimeType, upload.storageKey, upload.sizeBytes, upload.sha256, upload.extractedText, now()
    );
  }

  listUploadPaths(userId: string): string[] {
    const rows = this.db.prepare('SELECT storage_key FROM uploaded_files WHERE user_id=?').all(userId) as unknown as Array<{ storage_key: string }>;
    return rows.map(r => r.storage_key);
  }

  createJob(userId: string, rawText: string, job: ParsedJob): string {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO jobs(id,user_id,source,raw_text,title,normalized_title,company,location,remote_type,contract_type,salary_min,salary_max,salary_period,gross_net,working_hours,shift_pattern,night_work,weekend_work,travel_required,application_method,deadline,published_at,parsed_at,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, userId, 'USER_PASTE', rawText, job.title, job.normalizedTitle, job.company, job.location, job.remoteType, job.contractType, job.salaryMin, job.salaryMax, job.salaryPeriod, job.grossNet,
      job.workingHours, job.shiftPattern, job.nightWork === null ? null : job.nightWork ? 1 : 0, job.weekendWork === null ? null : job.weekendWork ? 1 : 0, job.travelRequired === null ? null : job.travelRequired ? 1 : 0,
      job.applicationMethod, job.deadline, job.publishedAt, now(), job.fingerprint
    );
    const stmt = this.db.prepare(`INSERT INTO job_requirements(id,job_id,type,canonical_requirement,importance,confidence,provenance) VALUES(?,?,?,?,?,?,?)`);
    for (const req of job.requirements) stmt.run(randomUUID(), id, req.type, req.canonicalRequirement, req.importance, req.confidence, req.provenance);
    return id;
  }

  getJob(userId: string, jobId: string): { id: string; rawText: string; job: ParsedJob } | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=? AND user_id=?').get(jobId, userId) as JobRow | undefined;
    if (!row) return null;
    const reqRows = this.db.prepare('SELECT type,canonical_requirement,importance,confidence,provenance FROM job_requirements WHERE job_id=? ORDER BY importance, canonical_requirement').all(jobId) as unknown as ReqRow[];
    const requirements = reqRows.map(req => ({ type: req.type, canonicalRequirement: req.canonical_requirement, importance: req.importance, confidence: req.confidence, provenance: req.provenance }));
    return { id: row.id, rawText: row.raw_text, job: jobFromRow(row, requirements) };
  }

  saveDecision(userId: string, jobId: string, decision: JobDecisionResult): string {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO job_decisions(id,user_id,job_id,recommendation,capability_fit,requirement_fit,preference_fit,salary_fit,commute_fit,contract_fit,freshness,uncertainty,explanation,created_at,model_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, userId, jobId, decision.recommendation, decision.dimensions.capabilityFit, decision.dimensions.requirementFit, decision.dimensions.preferenceFit, decision.dimensions.salaryFit,
      decision.dimensions.commuteFit, decision.dimensions.contractFit, decision.dimensions.freshness, decision.dimensions.uncertainty, json(decision.explanation), now(), decision.modelVersion
    );
    return id;
  }

  setDecisionOverride(userId: string, decisionId: string, override: string, reason: string | null): void {
    const result = this.db.prepare('UPDATE job_decisions SET user_override=?,override_reason=? WHERE id=? AND user_id=?').run(override, reason, decisionId, userId);
    if (Number(result.changes) !== 1) throw new Error('Nie znaleziono decyzji.');
  }

  createApplication(userId: string, jobId: string, status: ApplicationStatus): string {
    const existing = this.db.prepare('SELECT id FROM applications WHERE user_id=? AND job_id=? AND status<>? ORDER BY created_at DESC LIMIT 1').get(userId, jobId, 'CLOSED') as { id: string } | undefined;
    if (existing) return existing.id;
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(`INSERT INTO applications(id,user_id,job_id,status,applied_at,source,current_stage,next_action,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      id, userId, jobId, status, status === 'APPLIED' ? timestamp : null, 'APP', status, status === 'SAVED' ? 'Przygotuj i wyślij aplikację' : 'Czekaj na odpowiedź / zapisz wynik', timestamp, timestamp
    );
    return id;
  }

  listApplications(userId: string): Array<ApplicationRow & { title: string | null; company: string | null }> {
    return this.db.prepare(`SELECT a.id,a.job_id,a.status,a.applied_at,a.source,a.current_stage,a.next_action,a.created_at,a.updated_at,j.title,j.company FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.user_id=? ORDER BY a.updated_at DESC`).all(userId) as unknown as Array<ApplicationRow & { title: string | null; company: string | null }>;
  }

  getApplication(userId: string, applicationId: string): ApplicationRow | null {
    return (this.db.prepare('SELECT id,job_id,status,applied_at,source,current_stage,next_action,created_at,updated_at FROM applications WHERE id=? AND user_id=?').get(applicationId, userId) as ApplicationRow | undefined) ?? null;
  }

  updateApplicationStatus(userId: string, applicationId: string, status: ApplicationStatus): void {
    const timestamp = now();
    const result = this.db.prepare(`UPDATE applications SET status=?,current_stage=?,applied_at=CASE WHEN ?='APPLIED' AND applied_at IS NULL THEN ? ELSE applied_at END,updated_at=? WHERE id=? AND user_id=?`).run(status, status, status, timestamp, timestamp, applicationId, userId);
    if (Number(result.changes) !== 1) throw new Error('Nie znaleziono aplikacji.');
  }

  addOutcome(userId: string, applicationId: string, outcomeType: string): OutcomeRow {
    const application = this.getApplication(userId, applicationId);
    if (!application) throw new Error('Nie znaleziono aplikacji.');
    const row: OutcomeRow = { id: randomUUID(), application_id: applicationId, outcome_type: outcomeType, occurred_at: now(), source: 'USER', confidence: 1, confirmed_by_user: 1, created_at: now() };
    this.db.prepare(`INSERT INTO outcomes(id,application_id,outcome_type,occurred_at,source,confidence,confirmed_by_user,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(row.id, row.application_id, row.outcome_type, row.occurred_at, row.source, row.confidence, row.confirmed_by_user, row.created_at);
    return row;
  }

  getSubscription(userId: string): Record<string, unknown> | null {
    return (this.db.prepare('SELECT plan,status,trial_ends_at,current_period_ends_at,provider,created_at,updated_at FROM subscriptions WHERE user_id=?').get(userId) as Record<string, unknown> | undefined) ?? null;
  }

  recordConsent(userId: string, type: 'TERMS' | 'PRIVACY' | 'ANALYTICS', granted: boolean, version: string): ConsentRecord {
    const createdAt = now();
    this.db.prepare('INSERT INTO consents(id,user_id,consent_type,granted,version,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), userId, type, granted ? 1 : 0, version, createdAt);
    this.audit(userId, 'CONSENT_RECORDED', 'consent', type, { granted, version });
    return { type, granted, version, createdAt };
  }

  listConsents(userId: string): ConsentRecord[] {
    const rows = this.db.prepare('SELECT consent_type,granted,version,created_at FROM consents WHERE user_id=? ORDER BY created_at DESC').all(userId) as unknown as ConsentRow[];
    const latest = new Map<string, ConsentRecord>();
    for (const row of rows) {
      if (!latest.has(row.consent_type)) latest.set(row.consent_type, { type: row.consent_type, granted: row.granted === 1, version: row.version, createdAt: row.created_at });
    }
    return [...latest.values()];
  }

  analytics(userId: string | null, eventName: string, properties: Record<string, unknown> = {}): void {
    const sanitized = Object.fromEntries(Object.entries(properties).filter(([key]) => !/cv|resume|raw|text|email|name/i.test(key)));
    this.db.prepare('INSERT INTO analytics_events(id,user_id,event_name,properties,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), userId, eventName, json(sanitized), now());
  }

  audit(userId: string | null, action: string, entityType: string | null, entityId: string | null, metadata: Record<string, unknown> = {}): void {
    this.db.prepare('INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,metadata,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), userId, action, entityType, entityId, json(metadata), now());
  }

  exportUserData(userId: string): Record<string, unknown> {
    const user = this.getUserById(userId);
    if (!user) throw new Error('Nie znaleziono konta.');
    const safeUser = { id: user.id, email: user.email, name: user.name, locale: user.locale, timezone: user.timezone, role: user.role, createdAt: user.createdAt, updatedAt: user.updatedAt };
    const tables = ['career_profiles','career_facts','career_experiences','education','credentials','user_skills','uploaded_files','jobs','job_decisions','applications','subscriptions','consents','audit_logs','analytics_events'] as const;
    const data: Record<string, unknown> = { user: safeUser };
    for (const table of tables) {
      if (table === 'user_skills') data[table] = this.db.prepare('SELECT * FROM user_skills WHERE user_id=?').all(userId);
      else data[table] = this.db.prepare(`SELECT * FROM ${table} WHERE user_id=?`).all(userId);
    }
    data.job_requirements = this.db.prepare(`SELECT r.* FROM job_requirements r JOIN jobs j ON j.id=r.job_id WHERE j.user_id=?`).all(userId);
    data.outcomes = this.db.prepare(`SELECT o.* FROM outcomes o JOIN applications a ON a.id=o.application_id WHERE a.user_id=?`).all(userId);
    return data;
  }

  deleteUser(userId: string): void { this.db.prepare('DELETE FROM users WHERE id=?').run(userId); }

  diagnostics(): Record<string, unknown> {
    const scalar = (sql: string): number => Number((this.db.prepare(sql).get() as { count: number }).count);
    return {
      users: scalar('SELECT COUNT(*) count FROM users'),
      jobs: scalar('SELECT COUNT(*) count FROM jobs'),
      applications: scalar('SELECT COUNT(*) count FROM applications'),
      outcomes: scalar('SELECT COUNT(*) count FROM outcomes'),
      aiFailures24h: scalar("SELECT COUNT(*) count FROM ai_requests WHERE success=0 AND created_at>=datetime('now','-1 day')"),
      parserFailures24h: 0,
      featureFlags: this.db.prepare('SELECT key,enabled,rollout_percent FROM feature_flags ORDER BY key').all(),
      generatedAt: now()
    };
  }
}
