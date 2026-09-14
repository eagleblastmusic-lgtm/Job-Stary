import type { JobSourceInput } from './jobSources.js';
import type { JobSearchCriteria, JobSearchProviderKey } from './jobSearch.js';

export type PublicJobBoardKey = Exclude<JobSearchProviderKey, 'employer_careers' | 'jooble_pl'>;

const ENTITY_MAP: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (_match, token: string) => {
    const named = ENTITY_MAP[token.toLowerCase()];
    if (named !== undefined) return named;
    if (token.startsWith('#x') || token.startsWith('#X')) {
      const code = Number.parseInt(token.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    if (token.startsWith('#')) {
      const code = Number.parseInt(token.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return '';
  });
}

export function htmlToText(value: string): string {
  return decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function jobPostingType(value: unknown): boolean {
  if (typeof value === 'string') return value.toLowerCase() === 'jobposting';
  return Array.isArray(value) && value.some(item => typeof item === 'string' && item.toLowerCase() === 'jobposting');
}

function collectJobPostings(value: unknown, output: Array<Record<string, unknown>>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectJobPostings(item, output);
    return;
  }
  const object = objectValue(value);
  if (!object) return;
  if (jobPostingType(object['@type'])) output.push(object);
  if (object['@graph'] !== undefined) collectJobPostings(object['@graph'], output);
}

export function extractJobPostingJsonLd(html: string): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      collectJobPostings(JSON.parse(raw) as unknown, output);
    } catch {
      // Invalid JSON-LD from one script must not break the source refresh.
    }
  }
  return output;
}

function locationText(value: unknown): string | null {
  const values = Array.isArray(value) ? value : [value];
  const locations: string[] = [];
  for (const item of values) {
    const location = objectValue(item);
    if (!location) continue;
    const address = objectValue(location.address) ?? location;
    const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
      .map(stringValue)
      .filter((part): part is string => Boolean(part));
    if (parts.length) locations.push(parts.join(', '));
  }
  return locations.length ? [...new Set(locations)].join(' / ') : null;
}

function companyText(value: unknown): string | null {
  const organization = objectValue(value);
  return organization ? stringValue(organization.name) : stringValue(value);
}

function salaryText(value: unknown): string | null {
  const salary = objectValue(value);
  if (!salary) return stringValue(value);
  const currency = stringValue(salary.currency) ?? '';
  const nested = objectValue(salary.value);
  const min = nested?.minValue ?? salary.minValue;
  const max = nested?.maxValue ?? salary.maxValue;
  const unit = stringValue(nested?.unitText ?? salary.unitText) ?? '';
  if (typeof min === 'number' || typeof max === 'number' || typeof min === 'string' || typeof max === 'string') {
    const range = min !== undefined && max !== undefined ? `${String(min)}-${String(max)}` : String(min ?? max ?? '');
    return [range, currency, unit].filter(Boolean).join(' ');
  }
  return null;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(stringValue).filter((item): item is string => Boolean(item));
  const single = stringValue(value);
  return single ? [single] : [];
}

function postingUrl(posting: Record<string, unknown>, fallback: string): string {
  return stringValue(posting.url) ?? stringValue(posting.sameAs) ?? fallback;
}

function postingId(posting: Record<string, unknown>, sourceUrl: string): string | null {
  const identifier = objectValue(posting.identifier);
  const explicit = identifier ? stringValue(identifier.value) ?? stringValue(identifier.name) : stringValue(posting.identifier);
  if (explicit) return explicit;
  try {
    const url = new URL(sourceUrl);
    return url.pathname.split('/').filter(Boolean).at(-1) ?? null;
  } catch {
    return null;
  }
}

export function jobPostingToSourceInput(posting: Record<string, unknown>, fallbackUrl: string): JobSourceInput | null {
  const title = stringValue(posting.title) ?? stringValue(posting.name);
  const company = companyText(posting.hiringOrganization);
  if (!title && !company) return null;
  const sourceUrl = postingUrl(posting, fallbackUrl);
  const description = htmlToText(stringValue(posting.description) ?? '');
  const responsibilities = htmlToText(stringValue(posting.responsibilities) ?? '');
  const qualifications = htmlToText(stringValue(posting.qualifications) ?? '');
  const skills = stringList(posting.skills).join(', ');
  const employment = stringList(posting.employmentType).join(', ');
  const location = locationText(posting.jobLocation);
  const salary = salaryText(posting.baseSalary);
  const rawText = [
    title ? `Stanowisko: ${title}` : null,
    company ? `Firma: ${company}` : null,
    location ? `Miejsce pracy: ${location}` : null,
    employment ? `Rodzaj zatrudnienia: ${employment}` : null,
    salary ? `Wynagrodzenie: ${salary}` : null,
    skills ? `Umiejętności: ${skills}` : null,
    qualifications ? `Wymagania: ${qualifications}` : null,
    responsibilities ? `Obowiązki: ${responsibilities}` : null,
    description ? `Opis: ${description}` : null
  ].filter((line): line is string => Boolean(line)).join('\n').slice(0, 50_000);
  if (rawText.length < 20) return null;
  return {
    rawText,
    sourceUrl,
    externalId: postingId(posting, sourceUrl),
    publishedAt: stringValue(posting.datePosted)
  };
}

function formatOlxSalary(salaryValue: unknown): string | null {
  const salary = objectValue(salaryValue);
  if (!salary) return null;
  const currency = stringValue(salary.currency) ?? stringValue(salary.currencyCode) ?? stringValue(salary.currencySymbol) ?? 'PLN';
  const rawPeriod = stringValue(salary.period) ?? stringValue(salary.type) ?? '';
  const period = /hour|godz/i.test(rawPeriod) ? 'godz.' : /month|mies/i.test(rawPeriod) ? 'mies.' : rawPeriod;
  const grossNet = salary.gross === true ? 'brutto' : salary.gross === false ? 'netto' : '';
  const from = salary.from;
  const to = salary.to;
  const hasFrom = (typeof from === 'number' && from > 0) || (typeof from === 'string' && from.trim() !== '' && from.trim() !== '0');
  const hasTo = (typeof to === 'number' && to > 0) || (typeof to === 'string' && to.trim() !== '' && to.trim() !== '0');
  if (hasFrom && hasTo && from !== to) {
    return `${from} - ${to} ${currency} ${grossNet} ${period ? `/ ${period}` : ''}`.replace(/\s+/g, ' ').trim();
  }
  if (hasFrom || hasTo) {
    const val = hasFrom ? from : to;
    return `${val} ${currency} ${grossNet} ${period ? `/ ${period}` : ''}`.replace(/\s+/g, ' ').trim();
  }
  return null;
}

function olxCompanyText(ad: Record<string, unknown>): string | null {
  const employer = objectValue(ad.employer);
  if (employer) {
    const name = stringValue(employer.name);
    if (name) return name;
  }
  const user = objectValue(ad.user);
  if (user) {
    const companyName = stringValue(user.company_name);
    if (companyName) return companyName;
    if (ad.isBusiness === true || ad.business === true) {
      const name = stringValue(user.name);
      if (name) return name;
    }
  }
  const partner = objectValue(ad.partner);
  if (partner) {
    const name = stringValue(partner.name) ?? stringValue(partner.code);
    if (name) return name;
  }
  return null;
}

function olxLocationText(ad: Record<string, unknown>): string | null {
  const loc = objectValue(ad.location);
  if (!loc) return null;
  const pathName = stringValue(loc.pathName);
  if (pathName) return pathName;
  const cityObj = objectValue(loc.city);
  const cityName = cityObj ? stringValue(cityObj.name) : stringValue(loc.cityName);
  const regionObj = objectValue(loc.region);
  const regionName = regionObj ? stringValue(regionObj.name) : stringValue(loc.regionName);
  const parts = [cityName, regionName].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(', ') : null;
}

function olxParamsLines(ad: Record<string, unknown>): string[] {
  const params = Array.isArray(ad.params) ? ad.params : Array.isArray(ad.parameters) ? ad.parameters : [];
  const lines: string[] = [];
  for (const item of params) {
    const param = objectValue(item);
    if (!param) continue;
    const key = stringValue(param.key) ?? '';
    if (key === 'salary' || key === 'price') continue;
    const name = stringValue(param.name) ?? key;
    let textVal: string | null = null;
    if (typeof param.value === 'string' && param.value.trim()) {
      textVal = param.value.trim();
    } else if (typeof param.value === 'object' && param.value !== null) {
      const valObj = param.value as Record<string, unknown>;
      textVal = stringValue(valObj.label) ?? stringValue(valObj.name) ?? null;
      if (!textVal && Array.isArray(valObj.label)) {
        textVal = valObj.label.filter((x): x is string => typeof x === 'string').join(', ');
      }
    }
    if (textVal) lines.push(`${name}: ${textVal}`);
  }
  return lines;
}

export function extractOlxPrerenderedAds(html: string): Array<Record<string, unknown>> {
  const match = /window\.__PRERENDERED_STATE__\s*=\s*(["'])([\s\S]*?)\1\s*;/i.exec(html);
  if (!match || !match[2]) return [];
  try {
    const raw = JSON.parse(`"${match[2]}"`) as string;
    const state = JSON.parse(raw) as Record<string, unknown>;
    const listing = objectValue(state.listing);
    const nestedListing = listing ? objectValue(listing.listing) ?? listing : null;
    const ads = nestedListing && Array.isArray(nestedListing.ads) ? nestedListing.ads : null;
    if (ads && ads.length > 0) {
      return ads.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
    }
    const jobAd = objectValue(state.jobAd);
    if (jobAd) {
      const single = objectValue(jobAd.job) ?? objectValue(jobAd.ad) ?? jobAd;
      if (single) return [single];
    }
    const singleAd = objectValue(state.ad);
    if (singleAd) {
      const single = objectValue(singleAd.ad) ?? singleAd;
      if (single) return [single];
    }
    return [];
  } catch {
    return [];
  }
}

export function olxAdToSourceInput(ad: Record<string, unknown>, fallbackUrl: string): JobSourceInput | null {
  const title = stringValue(ad.title);
  if (!title) return null;

  const company = olxCompanyText(ad);
  const location = olxLocationText(ad);
  const salaryFromObj = formatOlxSalary(ad.salary);
  const salaryFromParam = formatOlxSalary(Array.isArray(ad.params) ? (ad.params.find(p => typeof p === 'object' && p !== null && (p as Record<string, unknown>).key === 'salary') as Record<string, unknown> | undefined)?.value : null);
  const salary = salaryFromObj ?? salaryFromParam;
  const paramLines = olxParamsLines(ad);
  const description = htmlToText(stringValue(ad.description) ?? '');

  const lines = [
    `Stanowisko: ${title}`,
    company ? `Firma: ${company}` : null,
    location ? `Miejsce pracy: ${location}` : null,
    salary ? `Wynagrodzenie: ${salary}` : null,
    ...paramLines,
    description ? `Opis: ${description}` : null
  ].filter((line): line is string => Boolean(line));

  const rawText = lines.join('\n').slice(0, 50_000);
  if (rawText.length < 20) return null;

  const rawUrl = stringValue(ad.url) ?? (stringValue(ad.urlPath) ? `https://www.olx.pl${ad.urlPath}` : null);
  const sourceUrl = rawUrl ?? fallbackUrl;
  const externalId = ad.id !== undefined && ad.id !== null ? String(ad.id).trim() : postingId(ad, sourceUrl);
  const publishedAt = stringValue(ad.last_refresh_time)
    ?? stringValue(ad.lastRefreshTime)
    ?? stringValue(ad.created_time)
    ?? stringValue(ad.createdTime)
    ?? stringValue(ad.addedAt);

  return {
    rawText,
    sourceUrl,
    externalId,
    publishedAt
  };
}

export function linkedInGuestSearchUrl(criteria: JobSearchCriteria): string {
  const url = new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');
  if (criteria.query) url.searchParams.set('keywords', criteria.query.trim());
  if (criteria.location) url.searchParams.set('location', criteria.location.trim());
  if (criteria.radiusKm !== null && criteria.radiusKm !== undefined) {
    url.searchParams.set('distance', String(Math.floor(criteria.radiusKm)));
  }
  return url.toString();
}

export function parseLinkedInGuestCards(html: string, fallbackUrl?: string): JobSourceInput[] {
  const items: JobSourceInput[] = [];
  const cardPattern = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  for (const match of html.matchAll(cardPattern)) {
    const card = match[1];
    if (!card || !card.includes('base-search-card__title')) continue;
    const titleMatch = /<h3[^>]*class=["'][^"']*base-search-card__title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i.exec(card);
    const companyMatch = /<h4[^>]*class=["'][^"']*base-search-card__subtitle[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i.exec(card);
    const locationMatch = /<span[^>]*class=["'][^"']*job-search-card__location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(card);
    const linkMatch = /<a[^>]*class=["'][^"']*base-card__full-link[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(card);
    const timeMatch = /<time[^>]*datetime=["']([^"']+)["']/i.exec(card);
    const idMatch = /data-entity-urn=["']urn:li:jobPosting:(\d+)["']/i.exec(card);
    const benefitsMatch = /<span[^>]*class=["'][^"']*job-posting-benefits__text[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(card);

    const title = titleMatch?.[1] ? htmlToText(titleMatch[1]) : '';
    if (!title) continue;
    const company = companyMatch?.[1] ? htmlToText(companyMatch[1]) : '';
    const location = locationMatch?.[1] ? htmlToText(locationMatch[1]) : '';
    const benefits = benefitsMatch?.[1] ? htmlToText(benefitsMatch[1]) : '';
    const publishedAt = timeMatch?.[1]?.trim() || null;
    const externalId = idMatch?.[1]?.trim() || null;

    let sourceUrl = fallbackUrl ?? 'https://www.linkedin.com/jobs/';
    if (linkMatch?.[1]) {
      const rawUrl = decodeEntities(linkMatch[1]);
      try {
        const u = new URL(rawUrl);
        u.search = '';
        sourceUrl = u.toString();
      } catch {
        sourceUrl = rawUrl.split('?')[0] || sourceUrl;
      }
    }

    const lines = [
      `Stanowisko: ${title}`,
      company ? `Firma: ${company}` : null,
      location ? `Miejsce pracy: ${location}` : null,
      benefits ? `Dodatkowe informacje: ${benefits}` : null,
      'Źródło: LinkedIn Jobs'
    ].filter((l): l is string => Boolean(l));

    const rawText = lines.join('\n');
    if (rawText.length < 20) continue;

    items.push({
      rawText,
      sourceUrl,
      externalId,
      publishedAt
    });
  }
  return items;
}

export function parseLinkedInGuestDetail(html: string, sourceUrl: string): JobSourceInput | null {
  if (!html.includes('top-card-layout') && !html.includes('show-more-less-html')) return null;
  const titleMatch = /<h[12][^>]*class=["'][^"']*top-card-layout__title[^"']*["'][^>]*>([\s\S]*?)<\/h[12]>/i.exec(html)
    ?? /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html);
  const companyMatch = /<a[^>]*class=["'][^"']*topcard__org-name-link[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(html);
  const locationMatch = /<span[^>]*class=["'][^"']*topcard__flavor--bullet[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(html);
  const descMatch = /<div[^>]*class=["'][^"']*show-more-less-html__markup[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);

  const title = titleMatch?.[1] ? htmlToText(titleMatch[1]) : null;
  if (!title) return null;
  const company = companyMatch?.[1] ? htmlToText(companyMatch[1]) : null;
  const location = locationMatch?.[1] ? htmlToText(locationMatch[1]) : null;
  const description = descMatch?.[1] ? htmlToText(descMatch[1]) : null;

  const lines = [
    `Stanowisko: ${title}`,
    company ? `Firma: ${company}` : null,
    location ? `Miejsce pracy: ${location}` : null,
    'Źródło: LinkedIn Jobs',
    description ? `Opis: ${description}` : null
  ].filter((l): l is string => Boolean(l));

  const rawText = lines.join('\n').slice(0, 50_000);
  if (rawText.length < 20) return null;

  let externalId: string | null = null;
  const idMatch = /\/view\/(?:[^\/]+-)?(\d+)/i.exec(sourceUrl) ?? /jobPosting\/(\d+)/i.exec(sourceUrl);
  if (idMatch) externalId = idMatch[1] ?? null;

  return {
    rawText,
    sourceUrl,
    externalId,
    publishedAt: null
  };
}

export function extractPracujNextDataAds(html: string): JobSourceInput[] {
  const match = /<script id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match || !match[1]) return [];
  try {
    const data = JSON.parse(match[1]) as Record<string, unknown>;
    const props = objectValue(data.props);
    const pageProps = objectValue(props?.pageProps);
    const dehydratedState = objectValue(pageProps?.dehydratedState);
    const queries = Array.isArray(dehydratedState?.queries) ? dehydratedState.queries : [];
    const offerQuery = queries.find(q => {
      const qObj = objectValue(q);
      const queryKey = Array.isArray(qObj?.queryKey) ? qObj.queryKey as unknown[] : [];
      return queryKey[0] === 'jobOffers';
    }) as Record<string, unknown> | undefined;
    const queryData = objectValue(objectValue(offerQuery?.state)?.data);
    const grouped = Array.isArray(queryData?.groupedOffers) ? queryData.groupedOffers : [];

    const items: JobSourceInput[] = [];
    for (const item of grouped) {
      const g = objectValue(item);
      if (!g) continue;
      const title = stringValue(g.jobTitle);
      if (!title) continue;
      const company = stringValue(g.companyName);
      const subOffers = Array.isArray(g.offers) ? g.offers : [];
      const sub = objectValue(subOffers[0]);
      const location = sub ? stringValue(sub.displayWorkplace) ?? 'Polska' : 'Polska';
      const sourceUrl = sub ? stringValue(sub.offerAbsoluteUri) ?? 'https://www.pracuj.pl' : 'https://www.pracuj.pl';
      const externalId = sub ? String(sub.partitionId ?? g.groupId ?? '') : String(g.groupId ?? '');
      const salary = stringValue(g.salaryDisplayText);
      const contract = Array.isArray(g.typesOfContract) ? g.typesOfContract.filter((c): c is string => typeof c === 'string').join(', ') : null;
      const description = stringValue(g.jobDescription);

      const lines = [
        `Stanowisko: ${title}`,
        company ? `Firma: ${company}` : null,
        `Miejsce pracy: ${location}`,
        salary ? `Wynagrodzenie: ${salary}` : null,
        contract ? `Forma zatrudnienia: ${contract}` : null,
        'Źródło: Pracuj.pl',
        description ? `Opis: ${description}` : null
      ].filter((line): line is string => Boolean(line));

      items.push({
        rawText: lines.join('\n'),
        sourceUrl,
        externalId: externalId || null,
        publishedAt: stringValue(g.lastPublicated) ?? stringValue(g.initialPublicated)
      });
    }
    return items;
  } catch {
    return [];
  }
}

export function extractIndeedMosaicAds(html: string): JobSourceInput[] {
  const match = /window\.mosaic\.providerData\[["']mosaic-provider-jobcards["']\]\s*=\s*({[\s\S]*?});/i.exec(html);
  if (!match || !match[1]) return [];
  try {
    const data = JSON.parse(match[1]) as Record<string, unknown>;
    const metaData = objectValue(data.metaData);
    const model = objectValue(metaData?.mosaicProviderJobCardsModel);
    const results = Array.isArray(model?.results) ? model.results : [];

    const items: JobSourceInput[] = [];
    for (const item of results) {
      const r = objectValue(item);
      if (!r) continue;
      const title = stringValue(r.displayTitle) ?? stringValue(r.title);
      if (!title) continue;
      const company = stringValue(r.company);
      const location = stringValue(r.formattedLocation) ?? 'Polska';
      const snippet = stringValue(r.snippet);
      const desc = snippet ? htmlToText(snippet) : null;
      const rawLink = stringValue(r.link);
      const sourceUrl = rawLink ? (rawLink.startsWith('http') ? rawLink : `https://pl.indeed.com${rawLink}`) : 'https://pl.indeed.com';
      const externalId = stringValue(r.jobkey);
      const salaryObj = objectValue(r.salarySnippet);
      const salary = salaryObj ? stringValue(salaryObj.text) : null;
      const pubDate = typeof r.pubDate === 'number' ? new Date(r.pubDate).toISOString()
        : typeof r.createDate === 'number' ? new Date(r.createDate).toISOString()
        : null;

      const lines = [
        `Stanowisko: ${title}`,
        company ? `Firma: ${company}` : null,
        `Miejsce pracy: ${location}`,
        salary ? `Wynagrodzenie: ${salary}` : null,
        'Źródło: Indeed',
        desc ? `Opis: ${desc}` : null
      ].filter((line): line is string => Boolean(line));

      items.push({
        rawText: lines.join('\n'),
        sourceUrl,
        externalId: externalId || null,
        publishedAt: pubDate
      });
    }
    return items;
  } catch {
    return [];
  }
}

export function fallbackDetailToSourceInput(html: string, sourceUrl: string): JobSourceInput | null {
  const olxAds = extractOlxPrerenderedAds(html);
  if (olxAds.length > 0 && olxAds[0]) {
    const input = olxAdToSourceInput(olxAds[0], sourceUrl);
    if (input) return input;
  }
  const linkedInDetail = parseLinkedInGuestDetail(html, sourceUrl);
  if (linkedInDetail) return linkedInDetail;
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const descriptionMatch = /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i.exec(html)
    ?? /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i.exec(html);
  const title = titleMatch?.[1] ? htmlToText(titleMatch[1]) : '';
  const description = descriptionMatch?.[1] ? decodeEntities(descriptionMatch[1]) : '';
  const body = htmlToText(html).slice(0, 25_000);
  const rawText = [`Stanowisko/oferta: ${title}`, description ? `Opis skrócony: ${description}` : '', body]
    .filter(Boolean)
    .join('\n')
    .slice(0, 50_000);
  if (rawText.length < 120) return null;
  return { rawText, sourceUrl, externalId: sourceUrl.split('/').filter(Boolean).at(-1) ?? null, publishedAt: null };
}

function canonicalLink(raw: string, baseUrl: string): string | null {
  const decoded = decodeEntities(raw.trim());
  if (!decoded || decoded.startsWith('#') || decoded.startsWith('javascript:') || decoded.startsWith('mailto:')) return null;
  try {
    const url = new URL(decoded, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function isDetailUrl(source: PublicJobBoardKey, value: string): boolean {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (source === 'pracuj') return host.endsWith('pracuj.pl') && path.startsWith('/praca/') && path.includes('oferta');
  if (source === 'rocketjobs') return host.endsWith('rocketjobs.pl') && path.startsWith('/oferta-pracy/');
  if (source === 'justjoinit') return host.endsWith('justjoin.it') && path.startsWith('/job-offer/');
  if (source === 'olx') return host.endsWith('olx.pl') && (path.includes('/d/oferta/') || path.includes('/oferta/praca/') || path.startsWith('/oferta/'));
  if (source === 'indeed') return host.endsWith('indeed.com') && (path.includes('/viewjob') || url.searchParams.has('jk'));
  return host.endsWith('linkedin.com') && path.includes('/jobs/view/');
}

export function extractDetailLinks(html: string, baseUrl: string, source: PublicJobBoardKey, limit = 8): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const pattern = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = match[2];
    if (!raw) continue;
    const link = canonicalLink(raw, baseUrl);
    if (!link || seen.has(link) || !isDetailUrl(source, link)) continue;
    seen.add(link);
    links.push(link);
    if (links.length >= limit) break;
  }
  return links;
}

export function publicSourceKeys(): PublicJobBoardKey[] {
  return ['pracuj', 'rocketjobs', 'justjoinit', 'olx', 'indeed', 'linkedin'];
}

export function criteriaCacheKey(source: PublicJobBoardKey, criteria: JobSearchCriteria): string {
  return `${source}|${criteria.query.trim().toLowerCase()}|${criteria.location?.trim().toLowerCase() ?? ''}|${criteria.radiusKm ?? ''}`;
}
