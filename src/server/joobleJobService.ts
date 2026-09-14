import type { JobDatabase } from './db.js';
import type { AppStore } from './store.js';
import { JobFeedService, JobSourceRegistryService } from './jobFeedService.js';
import type { JobSearchCriteria } from '../domain/jobSearch.js';
import type { JobSourceConnector, JobSourceHealth, JobSourceInput, JobSourceTermsMetadata, NormalizedSourceJob } from '../domain/jobSources.js';
import { normalizeSourceUrl } from '../domain/jobSources.js';

export type JoobleRefreshStatus = 'IMPORTED' | 'NO_RESULTS' | 'FAILED' | 'DISABLED';

export interface JoobleRefreshResult {
  sourceKey: 'jooble_pl';
  status: JoobleRefreshStatus;
  fetchedCount: number;
  canonicalCount: number;
  message: string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type JoobleJob = {
  id?: number | string;
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link?: string;
  company?: string;
  updated?: string;
};

type JoobleResponse = { totalCount?: number; jobs?: JoobleJob[] };

type CacheEntry = { expiresAt: number; items: JobSourceInput[] };
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const ALLOWED_RADII = [0, 4, 8, 16, 26, 40, 80] as const;

function joobleRadius(radiusKm: number | null): string | undefined {
  if (radiusKm === null) return undefined;
  const bounded = Math.max(0, Math.min(80, Math.floor(radiusKm)));
  return String(ALLOWED_RADII.find(value => value >= bounded) ?? 80);
}

function cacheKey(criteria: JobSearchCriteria): string {
  return `${criteria.query.toLocaleLowerCase('pl-PL')}|${criteria.location?.toLocaleLowerCase('pl-PL') ?? 'polska'}|${joobleRadius(criteria.radiusKm) ?? 'default'}`;
}

function jobToInput(job: JoobleJob): JobSourceInput | null {
  const title = job.title?.trim() ?? '';
  const company = job.company?.trim() ?? '';
  const location = job.location?.trim() ?? '';
  const snippet = job.snippet?.trim() ?? '';
  const salary = job.salary?.trim() ?? '';
  const employmentType = job.type?.trim() ?? '';
  const upstreamSource = job.source?.trim() ?? '';
  const rawText = [
    title,
    company ? `Firma: ${company}` : '',
    location ? `Lokalizacja: ${location}` : '',
    salary ? `Wynagrodzenie: ${salary}` : '',
    employmentType ? `Rodzaj zatrudnienia: ${employmentType}` : '',
    snippet,
    upstreamSource ? `Źródło agregatora: ${upstreamSource}` : ''
  ].filter(Boolean).join('\n').slice(0, 50_000);
  if (rawText.length < 20) return null;
  return {
    rawText,
    sourceUrl: job.link?.trim() || null,
    externalId: job.id === undefined ? null : String(job.id),
    publishedAt: job.updated?.trim() || null
  };
}

export class JooblePolandConnector implements JobSourceConnector {
  readonly key = 'jooble_pl';
  readonly label = 'Jooble Polska';
  readonly kind = 'OFFICIAL_API' as const;
  private health: JobSourceHealth = { status: 'UNKNOWN', message: null, checkedAt: null };

  constructor(
    private readonly criteria: JobSearchCriteria,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async fetch(): Promise<JobSourceInput[]> {
    const key = cacheKey(this.criteria);
    const cached = CACHE.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.health = { status: 'HEALTHY', message: `Jooble cache: ${cached.items.length} ofert.`, checkedAt: new Date().toISOString() };
      return cached.items;
    }

    const radius = joobleRadius(this.criteria.radiusKm);
    const payload: Record<string, unknown> = {
      keywords: this.criteria.query,
      location: this.criteria.location ?? 'Polska',
      page: 1,
      ResultOnPage: 50,
      companysearch: false
    };
    if (radius !== undefined) payload.radius = radius;

    const response = await this.fetchImpl(`https://pl.jooble.org/api/${encodeURIComponent(this.apiKey)}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (response.status === 403) throw new Error('Jooble odrzucił klucz API dla rynku polskiego.');
    if (response.status === 429) throw new Error('Jooble chwilowo ograniczył liczbę zapytań.');
    if (!response.ok) throw new Error(`Jooble API zwróciło HTTP ${response.status}.`);

    const data = await response.json() as JoobleResponse;
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    const items = jobs.map(jobToInput).filter((item): item is JobSourceInput => item !== null).slice(0, 50);
    CACHE.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, items });
    this.health = {
      status: items.length ? 'HEALTHY' : 'DEGRADED',
      message: items.length ? `Jooble API zwróciło ${items.length} ofert.` : 'Jooble API odpowiedziało poprawnie, ale nie zwróciło ofert dla tego zapytania.',
      checkedAt: new Date().toISOString()
    };
    return items;
  }

  normalize(input: JobSourceInput): NormalizedSourceJob {
    return {
      rawText: input.rawText.trim(),
      sourceUrl: normalizeSourceUrl(input.sourceUrl),
      externalId: input.externalId?.trim() || null,
      publishedAt: input.publishedAt?.trim() || null,
      provenance: this.provenance(input)
    };
  }

  provenance(input: JobSourceInput): Record<string, unknown> {
    return {
      connector: this.key,
      basis: this.kind,
      market: 'PL',
      query: this.criteria.query,
      location: this.criteria.location,
      radiusKm: this.criteria.radiusKm,
      sourceUrl: normalizeSourceUrl(input.sourceUrl),
      fetchedAt: new Date().toISOString()
    };
  }

  termsMetadata(): JobSourceTermsMetadata {
    return {
      basis: this.kind,
      referenceUrl: 'https://pl.jooble.org/api/about',
      notes: 'Oficjalny Jooble REST API dla polskiego rynku. Klucz jest przechowywany wyłącznie w konfiguracji środowiska i nie trafia do provenance ani logów.',
      checkedAt: '2026-09-13'
    };
  }

  healthStatus(): JobSourceHealth {
    return this.health;
  }
}

export class JoobleJobIngestionService {
  private readonly feed: JobFeedService;
  private readonly registry: JobSourceRegistryService;

  constructor(
    database: JobDatabase,
    store: AppStore,
    private readonly apiKey: string | null,
    private readonly timeoutMs: number,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.feed = new JobFeedService(database, store);
    this.registry = new JobSourceRegistryService(database);
  }

  async refresh(userId: string, criteria: JobSearchCriteria): Promise<JoobleRefreshResult> {
    if (!this.apiKey) {
      return { sourceKey: 'jooble_pl', status: 'DISABLED', fetchedCount: 0, canonicalCount: 0, message: 'Brak JOOBLE_API_KEY_PL — oficjalny agregator API nie jest jeszcze aktywny.' };
    }
    if (!this.registry.isEnabled('jooble_pl')) {
      return { sourceKey: 'jooble_pl', status: 'DISABLED', fetchedCount: 0, canonicalCount: 0, message: 'Źródło Jooble jest wyłączone administracyjnie.' };
    }

    const connector = new JooblePolandConnector(criteria, this.apiKey, this.timeoutMs, this.fetchImpl);
    try {
      const results = await this.feed.importFromConnector(userId, connector);
      this.registry.updateConnectorMetadata(connector);
      const canonicalCount = results.filter(result => result.createdCanonicalJob).length;
      return {
        sourceKey: 'jooble_pl',
        status: results.length ? 'IMPORTED' : 'NO_RESULTS',
        fetchedCount: results.length,
        canonicalCount,
        message: results.length ? `Jooble: ${results.length} ofert, ${canonicalCount} nowych po deduplikacji.` : 'Jooble nie zwróciło ofert dla tego zapytania.'
      };
    } catch (error) {
      this.registry.updateConnectorMetadata(connector);
      return {
        sourceKey: 'jooble_pl',
        status: 'FAILED',
        fetchedCount: 0,
        canonicalCount: 0,
        message: error instanceof Error ? error.message : 'Nieznany błąd Jooble API.'
      };
    }
  }
}
