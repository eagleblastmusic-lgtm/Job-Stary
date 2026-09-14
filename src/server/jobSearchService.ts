import type { AppConfig } from './config.js';
import type { JobDatabase } from './db.js';
import type { AppStore } from './store.js';
import { JobFeedService, type JobFeedCard } from './jobFeedService.js';
import { PublicJobIngestionService, type LiveSourceRefreshResult } from './publicJobIngestionService.js';
import { JoobleJobIngestionService, type JoobleRefreshResult } from './joobleJobService.js';
import { buildJobSearchProviders, validateJobSearchCriteria, type JobSearchCriteria, type JobSearchProvider } from '../domain/jobSearch.js';
import { normalizeText } from '../domain/ontology.js';

export interface FederatedJobSearchResult {
  criteria: JobSearchCriteria;
  providers: JobSearchProvider[];
  localJobs: JobFeedCard[];
  sourceRefresh: Array<LiveSourceRefreshResult | JoobleRefreshResult>;
  externalSearchCount: number;
  automaticIngestionCount: number;
  importedCount: number;
  newCanonicalCount: number;
  boundary: string;
}

interface ObservationRow {
  job_id: string;
  provenance: string;
}

function matchesQuery(job: JobFeedCard, query: string): boolean {
  const haystack = normalizeText([job.title, job.company, job.location].filter(Boolean).join(' '));
  const subQueries = query.split(',').map(s => s.trim()).filter(Boolean);
  if (subQueries.length === 0) return true;
  return subQueries.some(sub => {
    const tokens = normalizeText(sub).split(/\s+/).filter(Boolean);
    return tokens.length === 0 || tokens.every(token => haystack.includes(token));
  });
}

function matchesLocation(job: JobFeedCard, location: string | null, radiusKm: number | null): boolean {
  if (!location) return true;
  if (radiusKm !== null && radiusKm > 0) return true;
  const normalizedLocation = normalizeText(location);
  return normalizeText(job.location ?? '').includes(normalizedLocation);
}

function sameNullableText(left: unknown, right: string | null): boolean {
  const normalizedLeft = typeof left === 'string' ? normalizeText(left) : '';
  const normalizedRight = normalizeText(right ?? '');
  return normalizedLeft === normalizedRight;
}

function sameRadius(left: unknown, right: number | null): boolean {
  if (left === null || left === undefined || left === '') return right === null;
  const parsed = Number(left);
  return Number.isFinite(parsed) && parsed === right;
}

export class JobSearchService {
  private readonly feed: JobFeedService;
  private readonly publicIngestion: PublicJobIngestionService;
  private readonly joobleIngestion: JoobleJobIngestionService;
  private readonly joobleApiConfigured: boolean;

  constructor(private readonly database: JobDatabase, store: AppStore, config: AppConfig) {
    this.feed = new JobFeedService(database, store);
    this.publicIngestion = new PublicJobIngestionService(database, store);
    this.joobleApiConfigured = Boolean(config.joobleApiKeyPl);
    this.joobleIngestion = new JoobleJobIngestionService(database, store, config.joobleApiKeyPl, config.joobleTimeoutMs);
  }

  async search(userId: string, input: JobSearchCriteria): Promise<FederatedJobSearchResult> {
    const criteria = validateJobSearchCriteria(input);
    const providers = buildJobSearchProviders(criteria, { joobleApiConfigured: this.joobleApiConfigured });
    const [joobleRefresh, publicRefresh] = await Promise.all([
      this.joobleIngestion.refresh(userId, criteria),
      this.publicIngestion.refresh(userId, criteria)
    ]);
    const sourceRefresh: Array<LiveSourceRefreshResult | JoobleRefreshResult> = [joobleRefresh, ...publicRefresh];
    const scopedJobIds = this.currentSearchJobIds(userId, criteria);
    const feedJobs = this.feed.list(userId, 200, 0);
    const localJobs = scopedJobIds.size > 0
      ? feedJobs.filter(job => scopedJobIds.has(job.jobId))
      : feedJobs.filter(job => matchesQuery(job, criteria.query) && matchesLocation(job, criteria.location, criteria.radiusKm));
    const importedCount = sourceRefresh.reduce((sum, source) => sum + source.fetchedCount, 0);
    const newCanonicalCount = sourceRefresh.reduce((sum, source) => sum + source.canonicalCount, 0);
    return {
      criteria,
      providers,
      localJobs,
      sourceRefresh,
      externalSearchCount: providers.filter(provider => provider.searchUrl !== null).length,
      automaticIngestionCount: providers.filter(provider => provider.canIngestAutomatically).length,
      importedCount,
      newCanonicalCount,
      boundary: 'Job preferuje oficjalne API i dozwolone feedy. Pracuj.pl jest pobierany z publicznych stron wyników i ofert, z kontrolą robots.txt przed odczytem. Wyniki bieżącego zapytania trafiają do jednej normalizacji, deduplikacji i Decision Engine. 401/403/429, CAPTCHA albo zmiana robots.txt nie są obchodzone.'
    };
  }

  private currentSearchJobIds(userId: string, criteria: JobSearchCriteria): Set<string> {
    const rows = this.database.db.prepare('SELECT job_id, provenance FROM job_source_observations WHERE user_id=?').all(userId) as unknown as ObservationRow[];
    const result = new Set<string>();
    for (const row of rows) {
      let provenance: Record<string, unknown>;
      try {
        provenance = JSON.parse(row.provenance) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (normalizeText(String(provenance.query ?? '')) !== normalizeText(criteria.query)) continue;
      if (!sameNullableText(provenance.location, criteria.location)) continue;
      if (!sameRadius(provenance.radiusKm, criteria.radiusKm)) continue;
      result.add(row.job_id);
    }
    return result;
  }
}
