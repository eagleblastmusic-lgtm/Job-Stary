import { randomUUID } from 'node:crypto';
import type { JobDatabase } from './db.js';
import type { AppStore } from './store.js';
import { parseJobText } from '../domain/jobParser.js';
import { decideJob } from '../domain/decisionEngine.js';
import { normalizeText } from '../domain/ontology.js';
import type { JobSourceConnector, NormalizedSourceJob } from '../domain/jobSources.js';

export type JobFeedState = 'RECOMMENDED' | 'SAVED' | 'HIDDEN' | 'NOT_INTERESTED';
export type DedupeStage = 'UNIQUE' | 'EXACT_URL' | 'NORMALIZED_IDENTITY' | 'TEXT_FINGERPRINT';
export type SourceRelation = 'CANONICAL' | 'DUPLICATE' | 'REPOST';

interface JobCandidateRow {
  id: string;
  normalized_title: string | null;
  company: string | null;
  location: string | null;
  fingerprint: string;
  published_at: string | null;
  parsed_at: string;
}

interface FeedRow {
  id: string; title: string | null; company: string | null; location: string | null; source: string; source_url: string | null;
  published_at: string | null; parsed_at: string; deadline: string | null; fingerprint: string; state: JobFeedState | null;
  recommendation: string | null; user_override: string | null;
}

export interface ImportResult {
  jobId: string;
  relation: SourceRelation;
  dedupeStage: DedupeStage;
  createdCanonicalJob: boolean;
}

export interface JobFeedCard {
  jobId: string;
  title: string | null;
  company: string | null;
  location: string | null;
  sourceKeys: string[];
  sourceUrl: string | null;
  freshness: string;
  deadline: string | null;
  state: JobFeedState;
  decisionState: { recommendation: string | null; override: string | null };
  duplicateCount: number;
  repostCount: number;
}

const now = (): string => new Date().toISOString();

function normalizedIdentity(row: { normalized_title: string | null; company: string | null; location: string | null }): string | null {
  const title = normalizeText(row.normalized_title ?? '');
  const company = normalizeText(row.company ?? '');
  const location = normalizeText(row.location ?? '');
  if (!title || !company || !location) return null;
  return `${title}|${company}|${location}`;
}

function daysBetween(left: string | null, right: string | null): number | null {
  if (!left || !right) return null;
  const a = Date.parse(left); const b = Date.parse(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b) / 86_400_000;
}

function observationKey(job: NormalizedSourceJob, fingerprint: string): string {
  return job.externalId ? `external:${job.externalId}` : job.sourceUrl ? `url:${job.sourceUrl}` : `fingerprint:${fingerprint}`;
}

export class JobSourceRegistryService {
  constructor(private readonly database: JobDatabase) {}

  list(): Array<Record<string, unknown>> {
    return this.database.db.prepare('SELECT key,label,kind,enabled,terms_metadata,health_status,health_message,last_checked_at,updated_at FROM job_source_registry ORDER BY key').all() as Array<Record<string, unknown>>;
  }

  isEnabled(key: string): boolean {
    const row = this.database.db.prepare('SELECT enabled FROM job_source_registry WHERE key=?').get(key) as { enabled: number } | undefined;
    return row?.enabled === 1;
  }

  setEnabled(key: string, enabled: boolean): void {
    const timestamp = now();
    const result = this.database.db.prepare("UPDATE job_source_registry SET enabled=?,health_status=?,updated_at=? WHERE key=?").run(enabled ? 1 : 0, enabled ? 'UNKNOWN' : 'DISABLED', timestamp, key);
    if (Number(result.changes) !== 1) throw new Error('Nie znaleziono źródła ofert.');
  }

  updateConnectorMetadata(connector: JobSourceConnector): void {
    const health = connector.healthStatus();
    const timestamp = now();
    this.database.db.prepare(`UPDATE job_source_registry SET label=?,kind=?,terms_metadata=?,health_status=CASE WHEN enabled=0 THEN 'DISABLED' ELSE ? END,health_message=?,last_checked_at=?,updated_at=? WHERE key=?`).run(
      connector.label, connector.kind, JSON.stringify(connector.termsMetadata()), health.status, health.message, health.checkedAt ?? timestamp, timestamp, connector.key
    );
  }
}

export class JobFeedService {
  private readonly registry: JobSourceRegistryService;
  constructor(private readonly database: JobDatabase, private readonly store: AppStore) {
    this.registry = new JobSourceRegistryService(database);
  }

  async importFromConnector(userId: string, connector: JobSourceConnector): Promise<ImportResult[]> {
    if (!this.registry.isEnabled(connector.key)) throw new Error('Źródło ofert jest wyłączone.');
    this.registry.updateConnectorMetadata(connector);
    const inputs = await connector.fetch();
    const results: ImportResult[] = [];
    for (const input of inputs) results.push(this.importOne(userId, connector, connector.normalize(input)));
    return results;
  }

  private importOne(userId: string, connector: JobSourceConnector, sourceJob: NormalizedSourceJob): ImportResult {
    const parsed = parseJobText(sourceJob.rawText);
    let match: JobCandidateRow | null = null;
    let dedupeStage: DedupeStage = 'UNIQUE';

    if (sourceJob.sourceUrl) {
      const exact = this.database.db.prepare(`SELECT j.id,j.normalized_title,j.company,j.location,j.fingerprint,j.published_at,j.parsed_at
        FROM job_source_observations o JOIN jobs j ON j.id=o.job_id
        WHERE o.user_id=? AND o.source_url=? ORDER BY o.last_seen_at DESC LIMIT 1`).get(userId, sourceJob.sourceUrl) as JobCandidateRow | undefined;
      if (exact) { match = exact; dedupeStage = 'EXACT_URL'; }
    }

    if (!match) {
      const identity = normalizedIdentity({ normalized_title: parsed.normalizedTitle, company: parsed.company, location: parsed.location });
      if (identity) {
        const candidates = this.database.db.prepare(`SELECT id,normalized_title,company,location,fingerprint,published_at,parsed_at FROM jobs WHERE user_id=? AND normalized_title=? ORDER BY parsed_at DESC LIMIT 100`).all(userId, parsed.normalizedTitle) as unknown as JobCandidateRow[];
        match = candidates.find(candidate => normalizedIdentity(candidate) === identity) ?? null;
        if (match) dedupeStage = 'NORMALIZED_IDENTITY';
      }
    }

    if (!match) {
      const fingerprint = this.database.db.prepare(`SELECT id,normalized_title,company,location,fingerprint,published_at,parsed_at FROM jobs WHERE user_id=? AND fingerprint=? ORDER BY parsed_at DESC LIMIT 1`).get(userId, parsed.fingerprint) as JobCandidateRow | undefined;
      if (fingerprint) { match = fingerprint; dedupeStage = 'TEXT_FINGERPRINT'; }
    }

    let jobId: string;
    let createdCanonicalJob = false;
    if (match) jobId = match.id;
    else {
      jobId = this.store.createJob(userId, sourceJob.rawText, { ...parsed, publishedAt: sourceJob.publishedAt ?? parsed.publishedAt });
      this.database.db.prepare('UPDATE jobs SET source=?,source_url=?,published_at=COALESCE(?,published_at) WHERE id=? AND user_id=?').run(connector.key.toUpperCase(), sourceJob.sourceUrl, sourceJob.publishedAt, jobId, userId);
      const decision = decideJob(this.store.getProfile(userId), this.store.listFacts(userId), { ...parsed, publishedAt: sourceJob.publishedAt ?? parsed.publishedAt });
      this.store.saveDecision(userId, jobId, decision);
      createdCanonicalJob = true;
    }

    const relation: SourceRelation = createdCanonicalJob ? 'CANONICAL' : this.isRepost(match, sourceJob) ? 'REPOST' : 'DUPLICATE';
    const key = observationKey(sourceJob, parsed.fingerprint);
    const timestamp = now();
    this.database.db.prepare(`INSERT INTO job_source_observations(id,user_id,job_id,source_key,observation_key,external_id,source_url,relation,dedupe_stage,published_at,provenance,first_seen_at,last_seen_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id,source_key,observation_key) DO UPDATE SET last_seen_at=excluded.last_seen_at,published_at=COALESCE(excluded.published_at,job_source_observations.published_at),provenance=excluded.provenance`).run(
      randomUUID(), userId, jobId, connector.key, key, sourceJob.externalId, sourceJob.sourceUrl, relation, dedupeStage, sourceJob.publishedAt, JSON.stringify(sourceJob.provenance), timestamp, timestamp
    );
    return { jobId, relation, dedupeStage, createdCanonicalJob };
  }

  private isRepost(match: JobCandidateRow | null, sourceJob: NormalizedSourceJob): boolean {
    if (!match || !sourceJob.sourceUrl) return false;
    const existingUrl = this.database.db.prepare('SELECT source_url FROM job_source_observations WHERE job_id=? AND source_url IS NOT NULL ORDER BY first_seen_at LIMIT 1').get(match.id) as { source_url: string } | undefined;
    if (!existingUrl || existingUrl.source_url === sourceJob.sourceUrl) return false;
    const gap = daysBetween(match.published_at ?? match.parsed_at, sourceJob.publishedAt);
    return gap !== null && gap >= 7;
  }

  setState(userId: string, jobId: string, state: JobFeedState): void {
    const exists = this.database.db.prepare('SELECT 1 ok FROM jobs WHERE id=? AND user_id=?').get(jobId, userId) as { ok: number } | undefined;
    if (!exists) throw new Error('Nie znaleziono oferty.');
    this.database.db.prepare(`INSERT INTO job_feed_states(user_id,job_id,state,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,job_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at`).run(userId, jobId, state, now());
  }

  list(userId: string, limit = 25, offset = 0): JobFeedCard[] {
    const boundedLimit = Math.max(1, Math.min(250, Math.floor(limit)));
    const boundedOffset = Math.max(0, Math.floor(offset));
    const rows = this.database.db.prepare(`
      SELECT j.id,j.title,j.company,j.location,j.source,j.source_url,j.published_at,j.parsed_at,j.deadline,j.fingerprint,s.state,
        (SELECT d.recommendation FROM job_decisions d WHERE d.user_id=j.user_id AND d.job_id=j.id ORDER BY d.created_at DESC LIMIT 1) recommendation,
        (SELECT d.user_override FROM job_decisions d WHERE d.user_id=j.user_id AND d.job_id=j.id ORDER BY d.created_at DESC LIMIT 1) user_override
      FROM jobs j LEFT JOIN job_feed_states s ON s.user_id=j.user_id AND s.job_id=j.id
      WHERE j.user_id=? ORDER BY COALESCE(j.published_at,j.parsed_at) DESC LIMIT ? OFFSET ?`).all(userId, boundedLimit, boundedOffset) as unknown as FeedRow[];
    return rows.map(row => {
      const observations = this.database.db.prepare('SELECT source_key,relation FROM job_source_observations WHERE user_id=? AND job_id=?').all(userId, row.id) as unknown as Array<{ source_key: string; relation: SourceRelation }>;
      const sourceKeys = [...new Set(observations.map(item => item.source_key))];
      if (sourceKeys.length === 0) sourceKeys.push(row.source);
      return {
        jobId: row.id, title: row.title, company: row.company, location: row.location, sourceKeys, sourceUrl: row.source_url,
        freshness: row.published_at ?? row.parsed_at, deadline: row.deadline, state: row.state ?? 'RECOMMENDED',
        decisionState: { recommendation: row.recommendation, override: row.user_override },
        duplicateCount: observations.filter(item => item.relation === 'DUPLICATE').length,
        repostCount: observations.filter(item => item.relation === 'REPOST').length
      };
    });
  }
}
