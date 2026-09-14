export {};

type FeatureResponse = { features: { job_feed?: boolean } };
type FeedState = 'RECOMMENDED' | 'SAVED' | 'HIDDEN' | 'NOT_INTERESTED';
type FeedJob = {
  jobId: string; title: string | null; company: string | null; location: string | null; sourceKeys: string[]; sourceUrl: string | null;
  freshness: string; deadline: string | null; state: FeedState; decisionState: { recommendation: string | null; override: string | null };
  duplicateCount: number; repostCount: number;
};

type FeedResponse = { jobs: FeedJob[]; limit?: number; offset?: number };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) } });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  return data;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

function formatDate(value: string | null): string {
  if (!value) return 'brak daty';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(date);
}

let jobs: FeedJob[] = [];
let filter: FeedState | 'ALL' = 'ALL';
let offset = 0;
const pageSize = 25;

function ensureUi(): HTMLElement {
  let screen = document.querySelector<HTMLElement>('[data-screen="job-feed"]');
  if (screen) return screen;
  const mobile = document.querySelector('.mobile-nav');
  const sidebar = document.querySelector('.sidebar');
  const content = document.querySelector('.content');
  if (!mobile || !sidebar || !content) throw new Error('Brak kontenera aplikacji.');

  const mobileButton = document.createElement('button');
  mobileButton.type = 'button'; mobileButton.className = 'nav-item'; mobileButton.dataset.view = 'job-feed'; mobileButton.textContent = 'Oferty';
  mobile.append(mobileButton);
  const sideButton = document.createElement('button');
  sideButton.type = 'button'; sideButton.className = 'side-link'; sideButton.dataset.view = 'job-feed'; sideButton.textContent = 'Feed ofert';
  sidebar.append(sideButton);

  screen = document.createElement('section');
  screen.className = 'screen hidden'; screen.dataset.screen = 'job-feed';
  screen.innerHTML = `
    <div class="screen-heading"><p class="eyebrow">Jakość decyzji ponad liczbę ofert</p><h2>Feed ofert</h2><p>Jedna oferta, jeden kanoniczny rekord. Duplikaty i reposty są łączone zamiast sztucznie powiększać feed.</p></div>
    <div class="card">
      <h3>Dodaj ofertę dostarczoną przez Ciebie</h3>
      <p class="hint">Ta wersja nie skanuje zewnętrznych serwisów. Wklejasz treść samodzielnie; URL służy wyłącznie jako provenance i do deduplikacji.</p>
      <form id="feedImportForm" class="stack">
        <label>Treść oferty<textarea name="rawText" required minlength="20" maxlength="50000" rows="8" placeholder="Wklej pełną treść oferty"></textarea></label>
        <label>URL źródłowy — opcjonalnie<input name="sourceUrl" type="url" maxlength="2000" placeholder="https://..."></label>
        <label>Data publikacji — opcjonalnie<input name="publishedAt" type="date"></label>
        <button class="button" type="submit">Dodaj do feedu</button>
      </form>
      <div id="feedMessage" class="message" aria-live="polite"></div>
    </div>
    <div class="card section-gap">
      <div class="row-between"><div><h3>Oferty</h3><p class="hint">Możesz zapisać, ukryć lub oznaczyć jako nieinteresującą. Żadna z tych decyzji nie blokuje późniejszej aplikacji.</p></div><button id="feedRefresh" class="button button-secondary" type="button">Odśwież</button></div>
      <div id="feedFilters" class="fact-actions" role="group" aria-label="Filtr stanu ofert">
        <button class="mini-button" data-feed-filter="ALL" type="button">Wszystkie</button>
        <button class="mini-button" data-feed-filter="RECOMMENDED" type="button">Polecane</button>
        <button class="mini-button" data-feed-filter="SAVED" type="button">Zapisane</button>
        <button class="mini-button" data-feed-filter="HIDDEN" type="button">Ukryte</button>
        <button class="mini-button" data-feed-filter="NOT_INTERESTED" type="button">Nie interesuje mnie</button>
      </div>
      <div id="feedList" class="stack section-gap" aria-live="polite"></div>
      <button id="feedMore" class="button button-secondary hidden" type="button">Załaduj więcej</button>
    </div>`;
  content.append(screen);

  for (const button of [mobileButton, sideButton]) button.addEventListener('click', () => { location.hash = 'job-feed'; show(); void reload(); });
  screen.querySelector<HTMLFormElement>('#feedImportForm')?.addEventListener('submit', event => { event.preventDefault(); void importJob(); });
  screen.querySelector('#feedRefresh')?.addEventListener('click', () => { void reload(); });
  screen.querySelector('#feedMore')?.addEventListener('click', () => { void loadMore(); });
  screen.querySelector('#feedFilters')?.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-feed-filter]');
    if (!button) return;
    const value = button.dataset.feedFilter;
    if (value === 'ALL' || value === 'RECOMMENDED' || value === 'SAVED' || value === 'HIDDEN' || value === 'NOT_INTERESTED') { filter = value; render(); }
  });
  screen.querySelector('#feedList')?.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-feed-job][data-feed-state]');
    if (!button) return;
    const state = button.dataset.feedState as FeedState | undefined;
    const jobId = button.dataset.feedJob;
    if (state && jobId) void setState(jobId, state);
  });
  return screen;
}

function show(): void {
  document.querySelectorAll<HTMLElement>('[data-screen]').forEach(element => element.classList.toggle('hidden', element.dataset.screen !== 'job-feed'));
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(element => element.classList.toggle('active', element.dataset.view === 'job-feed'));
}

function setMessage(text: string, error = false): void {
  const element = document.querySelector<HTMLElement>('#feedMessage');
  if (!element) return;
  element.textContent = text; element.className = `message ${error ? 'error' : 'success'}`;
}

function stateLabel(state: FeedState): string {
  return ({ RECOMMENDED: 'polecana', SAVED: 'zapisana', HIDDEN: 'ukryta', NOT_INTERESTED: 'nie interesuje mnie' } as const)[state];
}

function render(): void {
  const list = document.querySelector<HTMLElement>('#feedList');
  if (!list) return;
  const visible = filter === 'ALL' ? jobs : jobs.filter(job => job.state === filter);
  list.innerHTML = visible.length ? visible.map(job => `
    <article class="card">
      <div class="row-between"><div><span class="badge">${esc(stateLabel(job.state))}</span><h3>${esc(job.title ?? 'Oferta bez rozpoznanego tytułu')}</h3></div><span class="hint">${esc(formatDate(job.freshness))}</span></div>
      <p><strong>${esc(job.company ?? 'Firma nieustalona')}</strong>${job.location ? ` · ${esc(job.location)}` : ''}</p>
      <p class="hint">Źródło: ${esc(job.sourceKeys.join(', '))} · Decyzja: ${esc(job.decisionState.override ?? job.decisionState.recommendation ?? 'jeszcze bez decyzji')}</p>
      ${(job.duplicateCount || job.repostCount) ? `<p class="hint">Połączone: ${job.duplicateCount} duplikatów · ${job.repostCount} repostów</p>` : ''}
      ${job.sourceUrl ? `<p><a href="${esc(job.sourceUrl)}" target="_blank" rel="noopener noreferrer">Otwórz źródłowy URL</a></p>` : ''}
      <div class="fact-actions">
        <button class="mini-button" type="button" data-feed-job="${esc(job.jobId)}" data-feed-state="SAVED">Zapisz</button>
        <button class="mini-button" type="button" data-feed-job="${esc(job.jobId)}" data-feed-state="RECOMMENDED">Przywróć do polecanych</button>
        <button class="mini-button" type="button" data-feed-job="${esc(job.jobId)}" data-feed-state="HIDDEN">Ukryj</button>
        <button class="mini-button" type="button" data-feed-job="${esc(job.jobId)}" data-feed-state="NOT_INTERESTED">Nie interesuje mnie</button>
      </div>
    </article>`).join('') : '<div class="card"><strong>Brak ofert w tym widoku.</strong><p class="hint">Dodaj pierwszą ofertę albo zmień filtr.</p></div>';
  document.querySelectorAll<HTMLButtonElement>('[data-feed-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.feedFilter === filter)));
}

async function reload(): Promise<void> {
  try {
    offset = 0;
    const data = await api<FeedResponse>(`/api/job-feed?limit=${pageSize}&offset=0`);
    jobs = data.jobs; offset = data.jobs.length;
    render();
    document.querySelector('#feedMore')?.classList.toggle('hidden', data.jobs.length < pageSize);
  } catch (error) { setMessage((error as Error).message, true); }
}

async function loadMore(): Promise<void> {
  try {
    const data = await api<FeedResponse>(`/api/job-feed?limit=${pageSize}&offset=${offset}`);
    const seen = new Set(jobs.map(job => job.jobId));
    jobs.push(...data.jobs.filter(job => !seen.has(job.jobId)));
    offset += data.jobs.length; render();
    document.querySelector('#feedMore')?.classList.toggle('hidden', data.jobs.length < pageSize);
  } catch (error) { setMessage((error as Error).message, true); }
}

async function importJob(): Promise<void> {
  const form = document.querySelector<HTMLFormElement>('#feedImportForm');
  if (!form) return;
  const data = new FormData(form);
  try {
    const rawText = String(data.get('rawText') ?? '').trim();
    const sourceUrl = String(data.get('sourceUrl') ?? '').trim() || null;
    const publishedDate = String(data.get('publishedAt') ?? '').trim();
    const publishedAt = publishedDate ? `${publishedDate}T12:00:00.000Z` : null;
    const result = await api<{ results: Array<{ relation: string; dedupeStage: string; createdCanonicalJob: boolean }>; jobs: FeedJob[] }>('/api/job-feed/import-user', {
      method: 'POST', body: JSON.stringify({ rawText, sourceUrl, publishedAt })
    });
    jobs = result.jobs; offset = jobs.length; render(); form.reset();
    const imported = result.results[0];
    const detail = imported?.createdCanonicalJob ? 'Dodano nową kanoniczną ofertę.' : imported?.relation === 'REPOST' ? 'Rozpoznano repost i połączono z istniejącą ofertą.' : 'Rozpoznano duplikat i połączono z istniejącą ofertą.';
    setMessage(detail);
  } catch (error) { setMessage((error as Error).message, true); }
}

async function setState(jobId: string, state: FeedState): Promise<void> {
  try {
    const data = await api<{ jobs: FeedJob[] }>(`/api/job-feed/${encodeURIComponent(jobId)}/state`, { method: 'PATCH', body: JSON.stringify({ state }) });
    jobs = data.jobs; offset = jobs.length; render(); setMessage('Stan oferty zapisany.');
  } catch (error) { setMessage((error as Error).message, true); }
}

let enabled = false;
async function refreshFeature(): Promise<void> {
  try {
    const data = await api<FeatureResponse>('/api/features'); enabled = data.features.job_feed === true;
    if (!enabled) return;
    ensureUi(); if (location.hash === '#job-feed') { show(); await reload(); }
  } catch { enabled = false; }
}

window.addEventListener('hashchange', () => { if (enabled && location.hash === '#job-feed') { show(); void reload(); } });
const appView = document.querySelector('#appView');
if (appView) new MutationObserver(() => { if (!appView.classList.contains('hidden')) void refreshFeature(); }).observe(appView, { attributes: true, attributeFilter: ['class'] });
void refreshFeature();
