import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createExtendedJobApp } from '../server/extendedApp.js';
import { PublicJobIngestionService } from '../server/publicJobIngestionService.js';
import { JobFeedService } from '../server/jobFeedService.js';

async function register(base: string, email: string): Promise<void> {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Live Source Tester', email, password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false })
  });
  assert.equal(response.status, 201);
}

const allowedRobots = `User-agent: *\nDisallow: /konto/\nSitemap: https://www.pracuj.pl/SiteMaps/CurrentOffers/SiteMapIndexJobOffers.xml\n`;

const searchHtml = `<!doctype html><html><body>
<a href="https://www.pracuj.pl/praca/magazynier-puck,oferta,10001">Magazynier</a>
</body></html>`;

const detailHtml = `<!doctype html><html><head><title>Magazynier - Port Logistics</title>
<script type="application/ld+json">{
  "@context":"https://schema.org",
  "@type":"JobPosting",
  "title":"Magazynier",
  "datePosted":"2026-09-13",
  "description":"Obsługa magazynu i kompletowanie zamówień. Wymagane uprawnienia UDT.",
  "employmentType":"FULL_TIME",
  "hiringOrganization":{"@type":"Organization","name":"Port Logistics"},
  "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Puck","addressCountry":"PL"}},
  "baseSalary":{"@type":"MonetaryAmount","currency":"PLN","value":{"@type":"QuantitativeValue","minValue":6000,"maxValue":7000,"unitText":"MONTH"}},
  "url":"https://www.pracuj.pl/praca/magazynier-puck,oferta,10001",
  "identifier":{"@type":"PropertyValue","name":"Pracuj.pl","value":"10001"}
}</script></head><body>Oferta pracy</body></html>`;

function pracujDetail(id: string, title: string, company: string, location: string): string {
  return `<!doctype html><html><head><title>${title} - ${company}</title>
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title,
    datePosted: '2026-09-13',
    description: 'Pełna publiczna treść oferty. Wymagania: dokładność i gotowość do pracy.',
    employmentType: 'FULL_TIME',
    hiringOrganization: { '@type': 'Organization', name: company },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: location, addressCountry: 'PL' } },
    url: `https://www.pracuj.pl/praca/${id},oferta,${id}`,
    identifier: { '@type': 'PropertyValue', name: 'Pracuj.pl', value: id }
  })}</script></head><body>Oferta pracy</body></html>`;
}

test('public source ingestion fetches a listing, parses JobPosting JSON-LD and sends it through canonical dedup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-live-source-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await register(base, 'live-source@example.pl');
    const user = app.db.db.prepare('SELECT id FROM users WHERE email=?').get('live-source@example.pl') as { id: string } | undefined;
    assert.ok(user);
    app.db.db.prepare("UPDATE job_source_registry SET enabled=CASE WHEN key='pracuj' THEN 1 ELSE 0 END WHERE key IN ('pracuj','linkedin','olx','indeed','rocketjobs','justjoinit')").run();

    const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response(allowedRobots, { status: 200, headers: { 'content-type': 'text/plain' } });
      if (url.includes(',oferta,10001')) return new Response(detailHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (url.includes('pracuj.pl/praca/')) return new Response(searchHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    };

    const ingestion = new PublicJobIngestionService(app.db, app.store, fakeFetch);
    const first = await ingestion.refresh(user.id, { query: 'magazynier', location: 'Puck', radiusKm: 30 });
    const pracuj = first.find(source => source.sourceKey === 'pracuj');
    assert.equal(pracuj?.status, 'IMPORTED');
    assert.equal(pracuj?.fetchedCount, 1);
    assert.equal(pracuj?.canonicalCount, 1);

    const feed = new JobFeedService(app.db, app.store).list(user.id, 25, 0);
    assert.equal(feed.length, 1);
    assert.equal(feed[0]?.title, 'Magazynier');
    assert.equal(feed[0]?.company, 'Port Logistics');
    assert.equal(feed[0]?.location, 'Puck, PL');
    assert.deepEqual(feed[0]?.sourceKeys, ['pracuj']);

    const second = await ingestion.refresh(user.id, { query: 'magazynier', location: 'Puck', radiusKm: 30 });
    const pracujSecond = second.find(source => source.sourceKey === 'pracuj');
    assert.equal(pracujSecond?.fetchedCount, 1);
    assert.equal(pracujSecond?.canonicalCount, 0, 'Repeated refresh should update the same source observation instead of duplicating the job.');
    assert.equal(new JobFeedService(app.db, app.store).list(user.id, 25, 0).length, 1);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pracuj.pl importer follows public result pagination and imports detail pages into the canonical feed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-pracuj-pages-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  const requested: string[] = [];
  try {
    await register(base, 'pracuj-pages@example.pl');
    const user = app.db.db.prepare('SELECT id FROM users WHERE email=?').get('pracuj-pages@example.pl') as { id: string } | undefined;
    assert.ok(user);
    app.db.db.prepare("UPDATE job_source_registry SET enabled=CASE WHEN key='pracuj' THEN 1 ELSE 0 END WHERE key IN ('pracuj','linkedin','olx','indeed','rocketjobs','justjoinit')").run();

    const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith('/robots.txt')) return new Response(allowedRobots, { status: 200, headers: { 'content-type': 'text/plain' } });
      if (url.includes(',oferta,20001')) return new Response(pracujDetail('20001', 'Magazynier', 'Firma A', 'Puck'), { status: 200, headers: { 'content-type': 'text/html' } });
      if (url.includes(',oferta,20002')) return new Response(pracujDetail('20002', 'Magazynier UDT', 'Firma B', 'Gdynia'), { status: 200, headers: { 'content-type': 'text/html' } });
      if (url.includes(',oferta,20003')) return new Response(pracujDetail('20003', 'Magazynier', 'Firma C', 'Rumia'), { status: 200, headers: { 'content-type': 'text/html' } });
      if (url.includes('pn=2')) {
        return new Response('<html><body>Strona 2 z 2<a href="https://www.pracuj.pl/praca/magazynier-rumia,oferta,20003">Trzecia oferta</a></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (url.includes('pracuj.pl/praca/')) {
        return new Response('<html><body>Strona 1 z 2<a href="https://www.pracuj.pl/praca/magazynier-puck,oferta,20001">Pierwsza oferta</a><a href="https://www.pracuj.pl/praca/magazynier-gdynia,oferta,20002">Druga oferta</a></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    };

    const results = await new PublicJobIngestionService(app.db, app.store, fakeFetch).refresh(user.id, { query: 'magazynier paginacja', location: 'Puck', radiusKm: 30 });
    const pracuj = results.find(source => source.sourceKey === 'pracuj');
    assert.equal(pracuj?.status, 'IMPORTED');
    assert.equal(pracuj?.fetchedCount, 3);
    assert.equal(pracuj?.canonicalCount, 3);
    assert.ok(requested.some(url => url.endsWith('/robots.txt')), 'Pracuj importer should verify robots.txt before live fetching.');
    assert.ok(requested.some(url => url.includes('pn=2')), 'Pracuj importer should follow the public pagination parameter.');

    const feed = new JobFeedService(app.db, app.store).list(user.id, 25, 0);
    assert.equal(feed.length, 3);
    assert.deepEqual(new Set(feed.map(job => job.company)), new Set(['Firma A', 'Firma B', 'Firma C']));
    assert.ok(feed.every(job => job.sourceKeys.includes('pracuj')));
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pracuj.pl importer respects robots.txt and stops before reading job pages when /praca/ becomes disallowed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-pracuj-robots-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  let jobPageRequests = 0;
  try {
    await register(base, 'pracuj-robots@example.pl');
    const user = app.db.db.prepare('SELECT id FROM users WHERE email=?').get('pracuj-robots@example.pl') as { id: string } | undefined;
    assert.ok(user);
    app.db.db.prepare("UPDATE job_source_registry SET enabled=CASE WHEN key='pracuj' THEN 1 ELSE 0 END WHERE key IN ('pracuj','linkedin','olx','indeed','rocketjobs','justjoinit')").run();

    const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /praca/\n', { status: 200, headers: { 'content-type': 'text/plain' } });
      jobPageRequests += 1;
      return new Response(searchHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    };

    const results = await new PublicJobIngestionService(app.db, app.store, fakeFetch).refresh(user.id, { query: 'magazynier robots', location: 'Puck', radiusKm: 30 });
    const pracuj = results.find(source => source.sourceKey === 'pracuj');
    assert.equal(pracuj?.status, 'BLOCKED');
    assert.match(pracuj?.message ?? '', /robots\.txt/i);
    assert.equal(jobPageRequests, 0);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('public source ingestion fails closed on access blocks and leaves other sources independent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-live-block-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await register(base, 'blocked-source@example.pl');
    const user = app.db.db.prepare('SELECT id FROM users WHERE email=?').get('blocked-source@example.pl') as { id: string } | undefined;
    assert.ok(user);
    app.db.db.prepare("UPDATE job_source_registry SET enabled=CASE WHEN key IN ('linkedin','pracuj') THEN 1 ELSE 0 END WHERE key IN ('pracuj','linkedin','olx','indeed','rocketjobs','justjoinit')").run();

    const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response(allowedRobots, { status: 200, headers: { 'content-type': 'text/plain' } });
      if (url.includes('linkedin.com')) return new Response('Access denied', { status: 403, headers: { 'content-type': 'text/html' } });
      if (url.includes('pracuj.pl')) return new Response('<html><body>Brak pasujących ofert</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    };

    const results = await new PublicJobIngestionService(app.db, app.store, fakeFetch).refresh(user.id, { query: 'tester', location: 'Puck', radiusKm: 30 });
    assert.equal(results.find(source => source.sourceKey === 'linkedin')?.status, 'BLOCKED');
    assert.equal(results.find(source => source.sourceKey === 'pracuj')?.status, 'NO_RESULTS');
    assert.ok(results.filter(source => source.status === 'DISABLED').length >= 4);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('public source ingestion fetches and normalizes OLX Praca ads from window.__PRERENDERED_STATE__', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-olx-source-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await register(base, 'olx-tester@example.pl');
    const user = app.db.db.prepare('SELECT id FROM users WHERE email=?').get('olx-tester@example.pl') as { id: string } | undefined;
    assert.ok(user);
    app.db.db.prepare("UPDATE job_source_registry SET enabled=CASE WHEN key='olx' THEN 1 ELSE 0 END WHERE key IN ('pracuj','linkedin','olx','indeed','rocketjobs','justjoinit')").run();

    const olxState = {
      listing: {
        listing: {
          ads: [
            {
              id: 987654321,
              title: 'Magazynier z UDT',
              url: 'https://www.olx.pl/oferta/praca/magazynier-z-udt-CID4-ID12345.html',
              description: '<p>Poszukujemy magazyniera do obsługi wózków widłowych. Wymagane uprawnienia UDT.</p>',
              location: {
                cityName: 'Kraków',
                regionName: 'Małopolskie',
                pathName: 'Małopolskie, Kraków'
              },
              user: {
                company_name: 'Logistyka Kraków Sp. z o.o.'
              },
              salary: {
                from: 5500,
                to: 6800,
                currencyCode: 'PLN',
                period: 'monthly',
                gross: true
              },
              params: [
                { key: 'type', name: 'Wymiar pracy', value: 'Pełny etat' },
                { key: 'agreement', name: 'Typ umowy', value: 'Umowa o pracę' },
                { key: 'experience', name: 'Wymagane doświadczenie', value: 'Doświadczenie mile widziane' }
              ],
              createdTime: '2026-09-13T10:00:00+02:00',
              lastRefreshTime: '2026-09-13T12:00:00+02:00'
            }
          ]
        }
      }
    };

    const encodedState = JSON.stringify(JSON.stringify(olxState));
    const olxSearchHtml = `<!doctype html><html><head>
<script>window.__PRERENDERED_STATE__= ${encodedState};</script>
</head><body><div id="root">OLX Praca</div></body></html>`;

    let requestedUrl = '';
    const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
      requestedUrl = String(input);
      if (requestedUrl.includes('olx.pl/praca')) {
        return new Response(olxSearchHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    };

    const ingestion = new PublicJobIngestionService(app.db, app.store, fakeFetch);
    const results = await ingestion.refresh(user.id, { query: 'magazynier', location: 'Kraków', radiusKm: 20 });
    const olxResult = results.find(r => r.sourceKey === 'olx');

    assert.equal(olxResult?.status, 'IMPORTED');
    assert.equal(olxResult?.fetchedCount, 1);
    assert.equal(olxResult?.canonicalCount, 1);

    // Verify URL normalization stripped diacritics from 'Kraków'
    assert.ok(requestedUrl.includes('/praca/krakow/q-magazynier/'), `Expected URL to contain /praca/krakow/q-magazynier/, got: ${requestedUrl}`);

    const feed = new JobFeedService(app.db, app.store).list(user.id, 25, 0);
    assert.equal(feed.length, 1);
    assert.equal(feed[0]?.title, 'Magazynier z UDT');
    assert.equal(feed[0]?.company, 'Logistyka Kraków Sp. z o.o.');
    assert.ok(feed[0]?.location?.includes('Kraków'));
    assert.deepEqual(feed[0]?.sourceKeys, ['olx']);

    // Second refresh should deduplicate and not increment canonical count
    const secondResults = await ingestion.refresh(user.id, { query: 'magazynier', location: 'Kraków', radiusKm: 20 });
    const secondOlx = secondResults.find(r => r.sourceKey === 'olx');
    assert.equal(secondOlx?.fetchedCount, 1);
    assert.equal(secondOlx?.canonicalCount, 0);
    assert.equal(new JobFeedService(app.db, app.store).list(user.id, 25, 0).length, 1);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('olx parser handles hourly rates, salary ranges, params, and single detail jobAd', async () => {
  const { extractOlxPrerenderedAds, olxAdToSourceInput } = await import('../domain/publicJobWeb.js');

  // Case 1: hourly rate with gross from params
  const adWithHourly = {
    id: 111222,
    title: 'Kurier miejski',
    url: 'https://www.olx.pl/oferta/praca/kurier-CID4-ID999.html',
    description: 'Praca na terenie Warszawy. Dostarczanie paczek.',
    location: {
      city: { name: 'Warszawa' },
      region: { name: 'Mazowieckie' }
    },
    employer: { name: 'Szybka Paczka' },
    salary: {
      from: 35,
      to: 45,
      currency: 'PLN',
      type: 'hourly',
      gross: true
    },
    params: [
      { key: 'type', name: 'Wymiar pracy', value: { label: 'Pełny etat' } },
      { key: 'agreement', name: 'Typ umowy', value: { label: 'B2B' } }
    ],
    last_refresh_time: '2026-09-12T14:00:00Z'
  };

  const parsedHourly = olxAdToSourceInput(adWithHourly, 'https://www.olx.pl');
  assert.ok(parsedHourly);
  assert.equal(parsedHourly.externalId, '111222');
  assert.equal(parsedHourly.sourceUrl, 'https://www.olx.pl/oferta/praca/kurier-CID4-ID999.html');
  assert.equal(parsedHourly.publishedAt, '2026-09-12T14:00:00Z');
  assert.match(parsedHourly.rawText, /Stanowisko: Kurier miejski/);
  assert.match(parsedHourly.rawText, /Firma: Szybka Paczka/);
  assert.match(parsedHourly.rawText, /Miejsce pracy: Warszawa, Mazowieckie/);
  assert.match(parsedHourly.rawText, /Wynagrodzenie: 35 - 45 PLN brutto \/ godz\./);
  assert.match(parsedHourly.rawText, /Wymiar pracy: Pełny etat/);
  assert.match(parsedHourly.rawText, /Typ umowy: B2B/);

  // Case 2: detail HTML with state.jobAd.job
  const detailState = {
    jobAd: {
      job: {
        id: 333444,
        title: 'Specjalista ds. logistyki',
        url: 'https://www.olx.pl/oferta/praca/specjalista-CID4-ID888.html',
        description: '<p>Zarządzanie dostawami.</p>',
        location: { pathName: 'Gdańsk, Pomorskie' },
        user: { company_name: 'Baltic Logistics' }
      }
    }
  };
  const detailHtml = `<script>window.__PRERENDERED_STATE__ = ${JSON.stringify(JSON.stringify(detailState))};</script>`;
  const extracted = extractOlxPrerenderedAds(detailHtml);
  assert.equal(extracted.length, 1);
  const parsedDetail = olxAdToSourceInput(extracted[0]!, 'https://www.olx.pl');
  assert.ok(parsedDetail);
  assert.equal(parsedDetail.externalId, '333444');
  assert.match(parsedDetail.rawText, /Stanowisko: Specjalista ds\. logistyki/);
  assert.match(parsedDetail.rawText, /Firma: Baltic Logistics/);
  assert.match(parsedDetail.rawText, /Miejsce pracy: Gdańsk, Pomorskie/);
});

test('public source ingestion fetches and normalizes LinkedIn jobs via Guest API', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-linkedin-source-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await register(base, 'linkedin-tester@example.pl');
    const user = app.db.db.prepare('SELECT id FROM users WHERE email=?').get('linkedin-tester@example.pl') as { id: string } | undefined;
    assert.ok(user);
    app.db.db.prepare("UPDATE job_source_registry SET enabled=CASE WHEN key='linkedin' THEN 1 ELSE 0 END WHERE key IN ('pracuj','linkedin','olx','indeed','rocketjobs','justjoinit')").run();

    const linkedInGuestHtml = `
      <ul>
        <li>
          <div class="base-card job-search-card" data-entity-urn="urn:li:jobPosting:4424548382">
            <a class="base-card__full-link" href="https://pl.linkedin.com/jobs/view/magazynier-k-m-n-at-hellmann-worldwide-logistics-4424548382?position=1&amp;refId=xyz">
              <span class="sr-only">Magazynier (k/m/n)</span>
            </a>
            <div class="base-search-card__info">
              <h3 class="base-search-card__title">Magazynier (k/m/n)</h3>
              <h4 class="base-search-card__subtitle">
                <a class="hidden-nested-link" href="https://de.linkedin.com/company/hellmann-worldwide-logistics">Hellmann Worldwide Logistics</a>
              </h4>
              <div class="base-search-card__metadata">
                <span class="job-search-card__location">Gdańsk</span>
                <div class="job-posting-benefits text-sm">
                  <span class="job-posting-benefits__text">Aktywnie zatrudnia</span>
                </div>
                <time class="job-search-card__listdate" datetime="2026-06-05">3 miesiące temu</time>
              </div>
            </div>
          </div>
        </li>
      </ul>`;

    let requestedUrl = '';
    const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
      requestedUrl = String(input);
      if (requestedUrl.includes('linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search')) {
        return new Response(linkedInGuestHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    };

    const ingestion = new PublicJobIngestionService(app.db, app.store, fakeFetch);
    const results = await ingestion.refresh(user.id, { query: 'magazynier', location: 'Gdańsk', radiusKm: 25 });
    const linkedinResult = results.find(r => r.sourceKey === 'linkedin');

    assert.equal(linkedinResult?.status, 'IMPORTED');
    assert.equal(linkedinResult?.fetchedCount, 1);
    assert.equal(linkedinResult?.canonicalCount, 1);

    assert.ok(requestedUrl.includes('seeMoreJobPostings/search'), `Expected Guest API search URL, got: ${requestedUrl}`);
    assert.ok(requestedUrl.includes('keywords=magazynier'));
    assert.ok(requestedUrl.includes('location=Gda%C5%84sk'));
    assert.ok(requestedUrl.includes('distance=25'));

    const feed = new JobFeedService(app.db, app.store).list(user.id, 25, 0);
    assert.equal(feed.length, 1);
    assert.equal(feed[0]?.title, 'Magazynier (k/m/n)');
    assert.equal(feed[0]?.company, 'Hellmann Worldwide Logistics');
    assert.equal(feed[0]?.location, 'Gdańsk');
    assert.deepEqual(feed[0]?.sourceKeys, ['linkedin']);
    assert.equal(feed[0]?.sourceUrl, 'https://pl.linkedin.com/jobs/view/magazynier-k-m-n-at-hellmann-worldwide-logistics-4424548382');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('linkedin guest parser handles cards and detail markup', async () => {
  const { parseLinkedInGuestCards, parseLinkedInGuestDetail } = await import('../domain/publicJobWeb.js');

  const cardsHtml = `
    <li>
      <div class="base-card" data-entity-urn="urn:li:jobPosting:999888">
        <a class="base-card__full-link" href="https://pl.linkedin.com/jobs/view/tester-qa-999888?tracking=1">Link</a>
        <h3 class="base-search-card__title">QA Automation Tester</h3>
        <h4 class="base-search-card__subtitle">Tech Corp</h4>
        <span class="job-search-card__location">Wrocław</span>
        <time class="job-search-card__listdate" datetime="2026-09-01">Tydzień temu</time>
      </div>
    </li>`;

  const cards = parseLinkedInGuestCards(cardsHtml);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.externalId, '999888');
  assert.equal(cards[0]?.sourceUrl, 'https://pl.linkedin.com/jobs/view/tester-qa-999888');
  assert.equal(cards[0]?.publishedAt, '2026-09-01');
  assert.match(cards[0]?.rawText ?? '', /Stanowisko: QA Automation Tester/);
  assert.match(cards[0]?.rawText ?? '', /Firma: Tech Corp/);
  assert.match(cards[0]?.rawText ?? '', /Miejsce pracy: Wrocław/);

  const detailHtml = `
    <section class="top-card-layout">
      <h2 class="top-card-layout__title">DevOps Engineer</h2>
      <a class="topcard__org-name-link" href="#">Cloud Sp. z o.o.</a>
      <span class="topcard__flavor topcard__flavor--bullet">Warszawa</span>
      <div class="show-more-less-html__markup">Wdrażanie Kubernetes i Terraform w chmurze AWS.</div>
    </section>`;

  const detail = parseLinkedInGuestDetail(detailHtml, 'https://pl.linkedin.com/jobs/view/devops-engineer-777666');
  assert.ok(detail);
  assert.equal(detail.externalId, '777666');
  assert.match(detail.rawText, /Stanowisko: DevOps Engineer/);
  assert.match(detail.rawText, /Firma: Cloud Sp\. z o\.o\./);
  assert.match(detail.rawText, /Miejsce pracy: Warszawa/);
  assert.match(detail.rawText, /Opis: Wdrażanie Kubernetes/);
});



