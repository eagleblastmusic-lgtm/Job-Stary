const rawBase = process.env.STAGING_URL?.trim();
if (!rawBase) throw new Error('Ustaw STAGING_URL, np. https://job-mvp-staging.onrender.com');

const base = rawBase.replace(/\/+$/, '');
const parsedBase = new URL(base);
if (parsedBase.protocol !== 'https:' && process.env.STAGING_ALLOW_HTTP !== '1') {
  throw new Error('STAGING_URL musi używać HTTPS. Dla lokalnego testu ustaw STAGING_ALLOW_HTTP=1.');
}

let cookie = '';
let accountCreated = false;
const email = `staging-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}@example.pl`;

async function request(path, { method = 'GET', body, expected = 200 } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const setCookie = response.headers.get('set-cookie')?.split(';')[0];
  if (setCookie) cookie = setCookie;
  const payload = await response.json().catch(() => ({}));
  if (response.status !== expected) {
    throw new Error(`${method} ${path}: oczekiwano ${expected}, otrzymano ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const health = await request('/api/health');
  assert(health.ok === true, 'Health check nie zwrócił ok=true.');

  const legal = await request('/api/legal');
  assert(typeof legal.legalVersion === 'string' && legal.legalVersion.length > 0, 'Brak legalVersion.');
  assert(legal.termsUrl === '/terms.html' && legal.privacyUrl === '/privacy.html', 'Nieprawidłowe linki dokumentów prawnych.');

  await request('/api/auth/register', {
    method: 'POST',
    expected: 201,
    body: {
      name: 'Staging Smoke',
      email,
      password: 'Bezpieczne123',
      acceptTerms: true,
      acceptPrivacy: true,
      analyticsConsent: false
    }
  });
  accountCreated = true;
  assert(cookie.includes('job_session='), 'Rejestracja nie zwróciła sesji.');

  const consents = await request('/api/consents');
  const analytics = consents.consents?.find(consent => consent.type === 'ANALYTICS');
  assert(analytics?.granted === false, 'Opcjonalna analityka powinna być wyłączona w smoke teście.');

  await request('/api/profile', {
    method: 'PUT',
    body: {
      desiredRoles: ['magazynier'],
      location: 'Gdynia',
      commuteKm: 25,
      remotePreferences: ['ONSITE'],
      salaryMin: 5500,
      contractPreferences: ['UOP'],
      shiftPreferences: { nights: false, weekends: true },
      availability: 'od zaraz'
    }
  });

  await request('/api/career-truth/facts', {
    method: 'POST',
    expected: 201,
    body: { type: 'CREDENTIAL', value: 'UDT', level: null }
  });

  const parsed = await request('/api/jobs/parse', {
    method: 'POST',
    expected: 201,
    body: {
      text: 'Magazynier\nFirma: Staging Logistics\nMiejsce pracy: Gdynia\nUmowa o pracę\nWynagrodzenie 6000 - 7000 PLN brutto\nWymagania: UDT.\nPraca stacjonarna.'
    }
  });
  assert(typeof parsed.jobId === 'string', 'Parser nie zwrócił jobId.');

  const decision = await request(`/api/jobs/${encodeURIComponent(parsed.jobId)}/decide`, { method: 'POST', body: {} });
  assert(typeof decision.decisionId === 'string', 'Decision Engine nie zwrócił decisionId.');
  assert(typeof decision.decision?.recommendation === 'string', 'Brak rekomendacji Decision Engine.');

  const application = await request('/api/applications', {
    method: 'POST',
    expected: 201,
    body: { jobId: parsed.jobId, status: 'APPLIED' }
  });
  assert(typeof application.applicationId === 'string', 'Tracker nie zwrócił applicationId.');

  await request(`/api/applications/${encodeURIComponent(application.applicationId)}/outcomes`, {
    method: 'POST',
    expected: 201,
    body: { outcomeType: 'WAITING' }
  });

  const exported = await request('/api/export');
  assert(Array.isArray(exported.applications) && exported.applications.length >= 1, 'Eksport nie zawiera aplikacji smoke testu.');
  assert(Array.isArray(exported.consents) && exported.consents.length >= 3, 'Eksport nie zawiera historii zgód.');

  console.log(`STAGING_SMOKE_OK ${base}`);
} finally {
  if (accountCreated && cookie) {
    try {
      await request('/api/auth/logout', { method: 'POST' });
      console.log('STAGING_SMOKE_SESSION_CLEANUP_OK');
    } catch (error) {
      console.error('STAGING_SMOKE_SESSION_CLEANUP_FAILED', error);
      process.exitCode = 1;
    }
  }
}
