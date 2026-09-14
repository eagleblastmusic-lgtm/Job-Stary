import type { JobDatabase } from './db.js';
import type { AppStore } from './store.js';
import { JobFeedService, JobSourceRegistryService } from './jobFeedService.js';
import type { JobSearchCriteria } from '../domain/jobSearch.js';
import { buildJobSearchProviders } from '../domain/jobSearch.js';
import type { JobSourceConnector, JobSourceHealth, JobSourceInput, JobSourceTermsMetadata, NormalizedSourceJob } from '../domain/jobSources.js';
import { normalizeSourceUrl } from '../domain/jobSources.js';
import { tlsFetch } from './tlsFetch.js';
import { browserFetch } from './browserFetch.js';
import {
  criteriaCacheKey,
  extractDetailLinks,
  extractJobPostingJsonLd,
  fallbackDetailToSourceInput,
  htmlToText,
  jobPostingToSourceInput,
  publicSourceKeys,
  type PublicJobBoardKey
} from '../domain/publicJobWeb.js';

export type LiveSourceRefreshStatus = 'IMPORTED' | 'NO_RESULTS' | 'BLOCKED' | 'FAILED' | 'DISABLED';

export interface LiveSourceRefreshResult {
  sourceKey: PublicJobBoardKey;
  status: LiveSourceRefreshStatus;
  fetchedCount: number;
  canonicalCount: number;
  message: string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface CacheEntry {
  expiresAt: number;
  items: JobSourceInput[];
}

const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const GENERIC_MAX_DETAIL_PAGES = 8;
const PRACUJ_MAX_SEARCH_PAGES = 3;
const PRACUJ_MAX_DETAIL_PAGES = 24;
const PRACUJ_DETAIL_CONCURRENCY = 4;
const MAX_HTML_BYTES = 2_000_000;
const MAX_ROBOTS_BYTES = 256_000;
const TRANSPARENT_USER_AGENT = 'JobCareerNavigator/0.1 (+https://github.com/eagleblastmusic-lgtm/Job; public-job-indexer)';

class SourceBlockedError extends Error {}

function sourceLabel(key: PublicJobBoardKey): string {
  return ({
    pracuj: 'Pracuj.pl',
    rocketjobs: 'RocketJobs',
    justjoinit: 'Just Join IT',
    olx: 'OLX Praca',
    indeed: 'Indeed',
    linkedin: 'LinkedIn Jobs'
  } as const)[key];
}

function uniqueInputs(items: JobSourceInput[]): JobSourceInput[] {
  const seen = new Set<string>();
  const output: JobSourceInput[] = [];
  for (const item of items) {
    const key = item.externalId?.trim() || normalizeSourceUrl(item.sourceUrl) || item.rawText.slice(0, 500);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

async function responseTextBounded(response: Response, maxBytes = MAX_HTML_BYTES): Promise<string> {
  const text = await response.text();
  return text.slice(0, maxBytes);
}

function pagedSearchUrl(baseUrl: string, page: number): string {
  const url = new URL(baseUrl);
  if (page <= 1) url.searchParams.delete('pn');
  else url.searchParams.set('pn', String(page));
  return url.toString();
}

function pracujPageCount(html: string): number {
  const text = htmlToText(html);
  const match = /(?:strona\s+)?\d+\s+z\s+(\d{1,3})\b/i.exec(text);
  if (!match?.[1]) return 1;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function robotsWildcardDisallowsPath(text: string, path: string): boolean {
  const lines = text.split(/\r?\n/).map(line => line.replace(/#.*/, '').trim()).filter(Boolean);
  let wildcardGroup = false;
  let groupHasRules = false;
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      if (groupHasRules) {
        wildcardGroup = value === '*';
        groupHasRules = false;
      } else if (value === '*') {
        wildcardGroup = true;
      }
      continue;
    }
    if (field !== 'allow' && field !== 'disallow') continue;
    groupHasRules = true;
    if (!wildcardGroup || field !== 'disallow' || !value) continue;
    if (value === '/' || path === value || path.startsWith(value)) return true;
  }
  return false;
}

async function mapLimited<T, R>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<R | null>): Promise<R[]> {
  const results: Array<R | null> = new Array(items.length).fill(null);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index] as T);
      } catch {
        results[index] = null;
      }
    }
  });
  await Promise.all(runners);
  return results.filter((item): item is R => item !== null);
}

class PublicWebJobConnector implements JobSourceConnector {
  readonly kind = 'PARTNERSHIP' as const;
  readonly label: string;
  private health: JobSourceHealth = { status: 'UNKNOWN', message: null, checkedAt: null };

  constructor(
    readonly key: PublicJobBoardKey,
    private readonly criteria: JobSearchCriteria,
    private readonly fetchImpl: FetchLike
  ) {
    this.label = sourceLabel(key);
  }

  async fetch(): Promise<JobSourceInput[]> {
    const cacheKey = criteriaCacheKey(this.key, this.criteria);
    const cached = CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.health = { status: 'HEALTHY', message: `Użyto cache publicznego źródła (${cached.items.length} ofert).`, checkedAt: new Date().toISOString() };
      return cached.items;
    }

    const provider = buildJobSearchProviders(this.criteria).find(item => item.key === this.key);
    if (!provider?.searchUrl) throw new Error(`Brak URL wyszukiwania dla źródła ${this.key}.`);
    try {
      const items = this.key === 'pracuj'
        ? await this.fetchPracuj(provider.searchUrl)
        : await this.fetchGeneric(provider.searchUrl);
      CACHE.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, items });
      return items;
    } catch (error) {
      const checkedAt = new Date().toISOString();
      if (error instanceof SourceBlockedError) {
        this.health = { status: 'DEGRADED', message: error.message, checkedAt };
        throw error;
      }
      this.health = { status: 'DEGRADED', message: error instanceof Error ? error.message : 'Nieznany błąd źródła.', checkedAt };
      throw error;
    }
  }

  normalize(input: JobSourceInput): NormalizedSourceJob {
    return {
      rawText: input.rawText.trim().slice(0, 50_000),
      sourceUrl: normalizeSourceUrl(input.sourceUrl),
      externalId: input.externalId?.trim() || null,
      publishedAt: input.publishedAt?.trim() || null,
      provenance: this.provenance(input)
    };
  }

  provenance(input: JobSourceInput): Record<string, unknown> {
    return {
      connector: this.key,
      accessMode: 'PUBLIC_WEB_PAGE',
      sourceUrl: normalizeSourceUrl(input.sourceUrl),
      externalId: input.externalId?.trim() || null,
      query: this.criteria.query,
      location: this.criteria.location,
      radiusKm: this.criteria.radiusKm,
      fetchedAt: new Date().toISOString()
    };
  }

  termsMetadata(): JobSourceTermsMetadata {
    const provider = buildJobSearchProviders(this.criteria).find(item => item.key === this.key);
    const isPracuj = this.key === 'pracuj';
    return {
      basis: this.kind,
      referenceUrl: isPracuj ? 'https://www.pracuj.pl/robots.txt' : provider?.homepageUrl ?? null,
      notes: isPracuj
        ? 'Pracuj.pl: wyłącznie publiczne strony /praca/ bez logowania i bez prywatnych endpointów. Runtime sprawdza robots.txt przed odczytem; jeśli /praca/ zostanie zablokowane albo serwis zwróci 401/403/429/CAPTCHA, importer zatrzymuje to źródło. Brak twierdzenia o partnerstwie lub oficjalnym API.'
        : 'Automatyczny odczyt dotyczy wyłącznie publicznie dostępnych stron WWW, bez logowania, omijania CAPTCHA, obchodzenia limitów lub dostępu do prywatnych endpointów. Źródło może zostać wyłączone administracyjnie.',
      checkedAt: new Date().toISOString()
    };
  }

  healthStatus(): JobSourceHealth {
    return this.health;
  }

  private async fetchGeneric(searchUrl: string): Promise<JobSourceInput[]> {
    const searchHtml = await this.fetchHtml(searchUrl);
    const directPostings = extractJobPostingJsonLd(searchHtml)
      .map(posting => jobPostingToSourceInput(posting, searchUrl))
      .filter((item): item is JobSourceInput => item !== null);

    const links = extractDetailLinks(searchHtml, searchUrl, this.key, GENERIC_MAX_DETAIL_PAGES);
    const detailResults = await Promise.allSettled(links.map(async link => this.fetchDetail(link)));
    const detailItems = detailResults
      .filter((result): result is PromiseFulfilledResult<JobSourceInput | null> => result.status === 'fulfilled')
      .map(result => result.value)
      .filter((item): item is JobSourceInput => item !== null);

    const items = uniqueInputs([...directPostings, ...detailItems]).slice(0, 20);
    this.health = {
      status: items.length ? 'HEALTHY' : 'DEGRADED',
      message: items.length ? `Pobrano ${items.length} publicznych ofert.` : 'Źródło odpowiedziało, ale nie udało się wyodrębnić ofert z bieżącej struktury strony.',
      checkedAt: new Date().toISOString()
    };
    return items;
  }

  private async fetchPracuj(searchUrl: string): Promise<JobSourceInput[]> {
    await this.assertPracujRobotsAllowsJobs();

    const directPostings: JobSourceInput[] = [];
    const detailLinks: string[] = [];
    const seenLinks = new Set<string>();
    let pagesFetched = 0;
    let pageLimit = 1;

    for (let page = 1; page <= Math.min(pageLimit, PRACUJ_MAX_SEARCH_PAGES); page += 1) {
      const pageUrl = pagedSearchUrl(searchUrl, page);
      const html = await this.fetchHtml(pageUrl);
      pagesFetched += 1;
      if (page === 1) pageLimit = Math.min(Math.max(1, pracujPageCount(html)), PRACUJ_MAX_SEARCH_PAGES);

      const pagePostings = extractJobPostingJsonLd(html)
        .map(posting => jobPostingToSourceInput(posting, pageUrl))
        .filter((item): item is JobSourceInput => item !== null);
      directPostings.push(...pagePostings);

      for (const link of extractDetailLinks(html, pageUrl, 'pracuj', 80)) {
        if (seenLinks.has(link)) continue;
        seenLinks.add(link);
        detailLinks.push(link);
      }
    }

    const directUrls = new Set(directPostings.map(item => normalizeSourceUrl(item.sourceUrl)).filter((value): value is string => Boolean(value)));
    const linksToFetch = detailLinks
      .filter(link => !directUrls.has(normalizeSourceUrl(link) ?? link))
      .slice(0, PRACUJ_MAX_DETAIL_PAGES);
    const detailItems = await mapLimited(linksToFetch, PRACUJ_DETAIL_CONCURRENCY, link => this.fetchDetail(link));
    const items = uniqueInputs([...directPostings, ...detailItems]).slice(0, 50);

    this.health = {
      status: items.length ? 'HEALTHY' : 'DEGRADED',
      message: items.length
        ? `Pracuj.pl: pobrano ${items.length} ofert z ${pagesFetched} stron wyników; robots.txt zezwala na /praca/.`
        : `Pracuj.pl odpowiedział na ${pagesFetched} stronach wyników, ale nie udało się wyodrębnić ofert.`,
      checkedAt: new Date().toISOString()
    };
    return items;
  }

  private async fetchDetail(link: string): Promise<JobSourceInput | null> {
    const html = await this.fetchHtml(link);
    const structured = extractJobPostingJsonLd(html)
      .map(posting => jobPostingToSourceInput(posting, link))
      .find((item): item is JobSourceInput => item !== null);
    return structured ?? fallbackDetailToSourceInput(html, link);
  }

  private async assertPracujRobotsAllowsJobs(): Promise<void> {
    const robotsUrl = 'https://www.pracuj.pl/robots.txt';
    const response = await this.fetchImpl(robotsUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000),
      headers: { accept: 'text/plain,*/*;q=0.1', 'user-agent': TRANSPARENT_USER_AGENT }
    });
    if ([401, 403, 429].includes(response.status)) throw new SourceBlockedError(`Pracuj.pl zablokował sprawdzenie robots.txt (HTTP ${response.status}). Import został zatrzymany.`);
    if (!response.ok) throw new Error(`Pracuj.pl robots.txt zwrócił HTTP ${response.status}.`);
    const robots = await responseTextBounded(response, MAX_ROBOTS_BYTES);
    if (robotsWildcardDisallowsPath(robots, '/praca/')) {
      throw new SourceBlockedError('Pracuj.pl robots.txt blokuje /praca/. Import został zatrzymany.');
    }
  }

  private async fetchHtml(url: string): Promise<string> {
    if (this.fetchImpl !== tlsFetch) {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(8_000),
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'pl-PL,pl;q=0.9,en;q=0.7',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        }
      });
      if ([401, 403, 429].includes(response.status)) {
        throw new SourceBlockedError(`Źródło ${this.label} zablokowało automatyczny odczyt (HTTP ${response.status}). Job nie obchodzi tej blokady.`);
      }
      if (!response.ok) throw new Error(`Źródło ${this.label} zwróciło HTTP ${response.status}.`);
      return responseTextBounded(response);
    }

    if (this.key === 'pracuj' || this.key === 'indeed') {
      try {
        const html = await browserFetch(url);
        return html.slice(0, MAX_HTML_BYTES);
      } catch (browserError) {
        throw new SourceBlockedError(`Źródło ${this.label} nie odpowiedziało: ${browserError instanceof Error ? browserError.message : String(browserError)}`);
      }
    }

    const response = await this.fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000),
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'pl-PL,pl;q=0.9,en;q=0.7',
        'user-agent': TRANSPARENT_USER_AGENT
      }
    });
    if ([401, 403, 429].includes(response.status)) {
      try {
        const html = await browserFetch(url);
        return html.slice(0, MAX_HTML_BYTES);
      } catch {
        throw new SourceBlockedError(`Źródło ${this.label} zablokowało automatyczny odczyt (HTTP ${response.status}).`);
      }
    }
    if (!response.ok) throw new Error(`Źródło ${this.label} zwróciło HTTP ${response.status}.`);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error(`Źródło ${this.label} zwróciło nieobsługiwany typ danych: ${contentType}.`);
    }
    const html = await responseTextBounded(response);
    if (/captcha|verify you are human|access denied|robot check|just a moment/i.test(html.slice(0, 30_000))) {
      try {
        const browserHtml = await browserFetch(url);
        return browserHtml.slice(0, MAX_HTML_BYTES);
      } catch {
        throw new SourceBlockedError(`Źródło ${this.label} wymaga weryfikacji człowieka.`);
      }
    }
    return html;
  }
}

export class PublicJobIngestionService {
  private readonly feed: JobFeedService;
  private readonly registry: JobSourceRegistryService;

  constructor(
    database: JobDatabase,
    store: AppStore,
    private readonly fetchImpl: FetchLike = tlsFetch
  ) {
    this.feed = new JobFeedService(database, store);
    this.registry = new JobSourceRegistryService(database);
  }

  async refresh(userId: string, criteria: JobSearchCriteria): Promise<LiveSourceRefreshResult[]> {
    const subQueries = criteria.query.split(',').map(s => s.trim()).filter(Boolean);
    if (subQueries.length <= 1) {
      return this.refreshSingle(userId, criteria);
    }
    const queries = subQueries.slice(0, 3);
    const allResults = await Promise.all(queries.map(q => this.refreshSingle(userId, { ...criteria, query: q })));
    const merged = new Map<PublicJobBoardKey, LiveSourceRefreshResult>();
    for (const batch of allResults) {
      for (const res of batch) {
        const existing = merged.get(res.sourceKey);
        if (!existing) {
          merged.set(res.sourceKey, { ...res });
        } else {
          existing.fetchedCount += res.fetchedCount;
          existing.canonicalCount += res.canonicalCount;
          if (res.status === 'IMPORTED') existing.status = 'IMPORTED';
          const dedupeNotice = existing.canonicalCount === existing.fetchedCount
            ? 'wszystkie nowe w bazie'
            : existing.canonicalCount > 0
              ? `${existing.canonicalCount} nowych, ${existing.fetchedCount - existing.canonicalCount} zaktualizowanych w bazie`
              : 'wszystkie aktualne w Twojej bazie';
          existing.message = existing.fetchedCount > 0
            ? `Pobrano ${existing.fetchedCount} ofert (${dedupeNotice}).`
            : existing.message;
        }
      }
    }
    return Array.from(merged.values());
  }

  private async refreshSingle(userId: string, criteria: JobSearchCriteria): Promise<LiveSourceRefreshResult[]> {
    return Promise.all(publicSourceKeys().map(async sourceKey => {
      if (!this.registry.isEnabled(sourceKey)) {
        return { sourceKey, status: 'DISABLED', fetchedCount: 0, canonicalCount: 0, message: 'Źródło jest wyłączone administracyjnie.' } as const;
      }
      const connector = new PublicWebJobConnector(sourceKey, criteria, this.fetchImpl);
      try {
        const results = await this.feed.importFromConnector(userId, connector);
        const canonicalCount = results.filter(result => result.createdCanonicalJob).length;
        const dedupeNotice = canonicalCount === results.length
          ? 'wszystkie nowe w bazie'
          : canonicalCount > 0
            ? `${canonicalCount} nowych, ${results.length - canonicalCount} zaktualizowanych w bazie`
            : 'wszystkie aktualne w Twojej bazie';
        return {
          sourceKey,
          status: results.length ? 'IMPORTED' : 'NO_RESULTS',
          fetchedCount: results.length,
          canonicalCount,
          message: results.length ? `Pobrano ${results.length} ofert (${dedupeNotice}).` : 'Brak ofert do importu z bieżącej odpowiedzi źródła.'
        } as const;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Nieznany błąd źródła.';
        return {
          sourceKey,
          status: error instanceof SourceBlockedError ? 'BLOCKED' : 'FAILED',
          fetchedCount: 0,
          canonicalCount: 0,
          message
        } as const;
      }
    }));
  }
}
