import { normalizeText } from './ontology.js';

export type JobSearchProviderKey = 'jooble_pl' | 'pracuj' | 'linkedin' | 'olx' | 'indeed' | 'rocketjobs' | 'justjoinit' | 'employer_careers';
export type JobSearchMode = 'AUTO_IMPORT' | 'OUTBOUND_SEARCH' | 'DIRECT_CAREER_PAGES';
export type JobIngestionStatus = 'OFFICIAL_API_ACTIVE' | 'OFFICIAL_API_REQUIRED' | 'PUBLIC_WEB_ACTIVE' | 'PERMITTED_SOURCE_REQUIRED';

export interface JobSearchCriteria {
  query: string;
  location: string | null;
  radiusKm: number | null;
}

export interface JobSearchProvider {
  key: JobSearchProviderKey;
  label: string;
  homepageUrl: string;
  searchMode: JobSearchMode;
  ingestionStatus: JobIngestionStatus;
  searchUrl: string | null;
  canIngestAutomatically: boolean;
  notes: string;
  checkedAt: string;
}

interface ProviderDefinition {
  key: JobSearchProviderKey;
  label: string;
  homepageUrl: string;
  searchMode: JobSearchMode;
  ingestionStatus: JobIngestionStatus;
  notes: string;
  checkedAt: string;
  buildSearchUrl: (criteria: JobSearchCriteria) => string | null;
}

const CHECKED_AT = '2026-09-13';

function urlWithParams(base: string, params: Record<string, string | number | null>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && String(value).trim()) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function pathToken(value: string): string {
  return encodeURIComponent(value.trim().replace(/\s+/g, '-'));
}

function pracujUrl(criteria: JobSearchCriteria): string {
  const query = (criteria.query.split(',')[0] ?? criteria.query).trim();
  const keyword = pathToken(query);
  const location = criteria.location ? `/${pathToken(criteria.location)};wp` : '';
  return `https://www.pracuj.pl/praca/${keyword};kw${location}`;
}

function linkedinUrl(criteria: JobSearchCriteria): string {
  return urlWithParams('https://www.linkedin.com/jobs/search/', {
    keywords: criteria.query,
    location: criteria.location,
    distance: criteria.radiusKm
  });
}

function olxUrl(criteria: JobSearchCriteria): string {
  const query = (criteria.query.split(',')[0] ?? criteria.query).trim();
  const keyword = normalizeText(query).replace(/\s+/g, '-');
  const locationSlug = criteria.location ? `/${normalizeText(criteria.location).replace(/\s+/g, '-')}` : '';
  const url = new URL(`https://www.olx.pl/praca${locationSlug}/q-${keyword}/`);
  if (criteria.radiusKm !== null) url.searchParams.set('search[dist]', String(criteria.radiusKm));
  return url.toString();
}

function indeedUrl(criteria: JobSearchCriteria): string {
  return urlWithParams('https://pl.indeed.com/jobs', {
    q: criteria.query,
    l: criteria.location,
    radius: criteria.radiusKm
  });
}

function rocketJobsUrl(criteria: JobSearchCriteria): string {
  return urlWithParams('https://rocketjobs.pl/oferty-pracy/wszystkie-lokalizacje', {
    keyword: criteria.query,
    location: criteria.location,
    radius: criteria.radiusKm
  });
}

function justJoinItUrl(criteria: JobSearchCriteria): string {
  return urlWithParams('https://justjoin.it/job-offers/all-locations', {
    q: `${criteria.query}@keyword`,
    location: criteria.location,
    radius: criteria.radiusKm
  });
}

const autoNotes = 'Job automatycznie próbuje odczytać publicznie dostępne strony wyników i ofert bez logowania. Nie omija CAPTCHA, blokad, limitów ani prywatnych endpointów; blokujące źródło failuje osobno, bez zatrzymania całego wyszukiwania.';

const DEFINITIONS: readonly ProviderDefinition[] = [
  {
    key: 'jooble_pl', label: 'Jooble Polska API', homepageUrl: 'https://pl.jooble.org/', searchMode: 'AUTO_IMPORT', ingestionStatus: 'OFFICIAL_API_REQUIRED',
    notes: 'Oficjalny REST API Jooble dla rynku polskiego. Jest stabilnym agregatorem ofert z wielu źródeł i nie wymaga scrapowania portali; do aktywacji potrzebny jest JOOBLE_API_KEY_PL.',
    checkedAt: CHECKED_AT, buildSearchUrl: () => 'https://pl.jooble.org/'
  },
  {
    key: 'pracuj', label: 'Pracuj.pl', homepageUrl: 'https://www.pracuj.pl/', searchMode: 'AUTO_IMPORT', ingestionStatus: 'PUBLIC_WEB_ACTIVE',
    notes: `${autoNotes} Pracuj.pl stosuje ochronę Cloudflare Turnstile – w przypadku blokady automatycznego odczytu użyj bezpośredniego linku do serwisu.`, checkedAt: CHECKED_AT, buildSearchUrl: pracujUrl
  },
  {
    key: 'linkedin', label: 'LinkedIn Jobs', homepageUrl: 'https://www.linkedin.com/jobs/', searchMode: 'AUTO_IMPORT', ingestionStatus: 'PUBLIC_WEB_ACTIVE',
    notes: `${autoNotes} Job pobiera publiczne ogłoszenia z LinkedIn przez interfejs gościa (LinkedIn Guest API) i mapuje je do ujednoliconego feedu.`, checkedAt: CHECKED_AT, buildSearchUrl: linkedinUrl
  },
  {
    key: 'olx', label: 'OLX Praca', homepageUrl: 'https://www.olx.pl/praca/', searchMode: 'AUTO_IMPORT', ingestionStatus: 'PUBLIC_WEB_ACTIVE',
    notes: `${autoNotes} Job pobiera publiczne ogłoszenia bezpośrednio ze stron OLX Praca i normalizuje wynagrodzenia, typy umów oraz opisy.`, checkedAt: CHECKED_AT, buildSearchUrl: olxUrl
  },
  {
    key: 'indeed', label: 'Indeed', homepageUrl: 'https://pl.indeed.com/', searchMode: 'AUTO_IMPORT', ingestionStatus: 'PUBLIC_WEB_ACTIVE',
    notes: `${autoNotes} Indeed stosuje ochronę Cloudflare Bot Management – w przypadku blokady skorzystaj z bezpośredniego linku do wyników.`, checkedAt: CHECKED_AT, buildSearchUrl: indeedUrl
  },
  {
    key: 'rocketjobs', label: 'RocketJobs', homepageUrl: 'https://rocketjobs.pl/', searchMode: 'AUTO_IMPORT', ingestionStatus: 'PUBLIC_WEB_ACTIVE',
    notes: autoNotes, checkedAt: CHECKED_AT, buildSearchUrl: rocketJobsUrl
  },
  {
    key: 'justjoinit', label: 'Just Join IT', homepageUrl: 'https://justjoin.it/', searchMode: 'AUTO_IMPORT', ingestionStatus: 'PUBLIC_WEB_ACTIVE',
    notes: autoNotes, checkedAt: CHECKED_AT, buildSearchUrl: justJoinItUrl
  },
  {
    key: 'employer_careers', label: 'Strony karier pracodawców', homepageUrl: 'about:blank', searchMode: 'DIRECT_CAREER_PAGES', ingestionStatus: 'PERMITTED_SOURCE_REQUIRED',
    notes: 'Automatyczne pobieranie z bezpośrednich stron pracodawców wymaga jawnej allowlisty/feedu konkretnej firmy; aplikacja nie skanuje losowo całego internetu.',
    checkedAt: CHECKED_AT, buildSearchUrl: () => null
  }
] as const;

export function validateJobSearchCriteria(input: JobSearchCriteria): JobSearchCriteria {
  const query = input.query.trim();
  if (query.length < 2 || query.length > 120) throw new Error('Fraza wyszukiwania musi mieć od 2 do 120 znaków.');
  const location = input.location?.trim() || null;
  if (location && location.length > 120) throw new Error('Lokalizacja może mieć maksymalnie 120 znaków.');
  const radiusKm = input.radiusKm === null ? null : Math.floor(input.radiusKm);
  if (radiusKm !== null && (!Number.isFinite(radiusKm) || radiusKm < 0 || radiusKm > 300)) throw new Error('Promień wyszukiwania musi mieścić się w zakresie 0–300 km.');
  return { query, location, radiusKm };
}

export function buildJobSearchProviders(input: JobSearchCriteria, options: { joobleApiConfigured?: boolean } = {}): JobSearchProvider[] {
  const criteria = validateJobSearchCriteria(input);
  return DEFINITIONS.map(definition => {
    const joobleConfigured = definition.key !== 'jooble_pl' || options.joobleApiConfigured === true;
    return {
      key: definition.key,
      label: definition.label,
      homepageUrl: definition.homepageUrl,
      searchMode: definition.searchMode,
      ingestionStatus: definition.key === 'jooble_pl' ? (joobleConfigured ? 'OFFICIAL_API_ACTIVE' : 'OFFICIAL_API_REQUIRED') : definition.ingestionStatus,
      searchUrl: definition.buildSearchUrl(criteria),
      canIngestAutomatically: definition.searchMode === 'AUTO_IMPORT' && joobleConfigured,
      notes: definition.notes,
      checkedAt: definition.checkedAt
    };
  });
}

export function jobSearchProviderKeys(): JobSearchProviderKey[] {
  return DEFINITIONS.map(definition => definition.key);
}
