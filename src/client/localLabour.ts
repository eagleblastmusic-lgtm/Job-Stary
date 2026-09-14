export {};

type Confidence = 'ZA_MALO_DANYCH' | 'WCZESNY_SYGNAL' | 'PRAWDOPODOBNY_WNIOSEK' | 'SILNY_WNIOSEK';
type SourceEvidence = { sourceName: string; sourceUrl: string; sourceLicense: string | null; year: number; updatedAt: string | null };
type Area = {
  areaName: string; distanceKm: number; shortageStatus: string; registeredUnemployed: number | null; offersPup: number | null; offersCbop: number | null;
  offersOnline: number | null; salaryMin: number | null; salaryMax: number | null; observedJobs: number; confidence: Confidence; referenceOfferFlow: number | null;
  referenceOfferFlowKind: string | null; unconfirmedCredentials: string[]; evidence: string[]; sources: SourceEvidence[];
};
type Report = {
  role: string; baseArea: string; commuteKm: number | null; confidence: Confidence; currentArea: Area | null; accessibleAreas: Area[]; bestArea: Area | null;
  plusTenKm: { status: string; areaName: string | null; distanceKm: number | null; message: string }; caveats: string[];
};
type FeatureResponse = { features: { local_labour?: boolean } };

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  return data;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

const confidenceLabels: Record<Confidence, string> = {
  ZA_MALO_DANYCH: 'ZA MAŁO DANYCH', WCZESNY_SYGNAL: 'WCZESNY SYGNAŁ', PRAWDOPODOBNY_WNIOSEK: 'PRAWDOPODOBNY WNIOSEK', SILNY_WNIOSEK: 'SILNY WNIOSEK'
};
const shortageLabels: Record<string, string> = { BIG_DEFICIT: 'duży deficyt pracowników', DEFICIT: 'deficyt pracowników', BALANCE: 'równowaga', SURPLUS: 'nadwyżka kandydatów', UNKNOWN: 'brak klasyfikacji' };

function ensureUi(): HTMLElement {
  let screen = document.querySelector<HTMLElement>('[data-screen="local-labour"]');
  if (screen) return screen;
  const mobile = document.querySelector('.mobile-nav');
  const sidebar = document.querySelector('.sidebar');
  const content = document.querySelector('.content');
  if (!mobile || !sidebar || !content) throw new Error('Brak kontenera aplikacji.');
  const mobileButton = document.createElement('button'); mobileButton.type = 'button'; mobileButton.className = 'nav-item'; mobileButton.dataset.view = 'local-labour'; mobileButton.textContent = 'Rynek'; mobile.append(mobileButton);
  const sideButton = document.createElement('button'); sideButton.type = 'button'; sideButton.className = 'side-link'; sideButton.dataset.view = 'local-labour'; sideButton.textContent = 'Rynek lokalny'; sidebar.append(sideButton);
  screen = document.createElement('section'); screen.className = 'screen hidden'; screen.dataset.screen = 'local-labour';
  screen.innerHTML = `
    <div class="screen-heading"><p class="eyebrow">Lokalne dane zamiast zgadywania</p><h2>Gdzie masz więcej możliwości?</h2><p>Łączymy Twoją lokalizację i tolerancję dojazdu z zapisanymi ofertami oraz zweryfikowanymi danymi publicznymi. Brak danych pozostaje brakiem danych.</p></div>
    <form id="localLabourForm" class="card stack">
      <div class="form-grid"><label>Rola<input name="role" maxlength="200" placeholder="np. magazynier"></label><label>Obszar<input name="area" maxlength="200" placeholder="np. powiat pucki"></label></div>
      <div class="row-between"><p class="hint">Puste pola użyją pierwszej preferowanej roli i lokalizacji z profilu.</p><button class="button button-secondary" type="submit">Porównaj</button></div>
      <div id="localLabourMessage" class="message" aria-live="polite"></div>
    </form>
    <div id="localLabourResult" class="stack section-gap" aria-live="polite"></div>`;
  content.append(screen);
  for (const button of [mobileButton, sideButton]) button.addEventListener('click', () => { location.hash = 'local-labour'; show(); void load(); });
  screen.querySelector<HTMLFormElement>('#localLabourForm')?.addEventListener('submit', event => { event.preventDefault(); void load(true); });
  return screen;
}

function show(): void {
  document.querySelectorAll<HTMLElement>('[data-screen]').forEach(element => element.classList.toggle('hidden', element.dataset.screen !== 'local-labour'));
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(element => element.classList.toggle('active', element.dataset.view === 'local-labour'));
}

function sourceList(area: Area): string {
  if (area.sources.length === 0) return '<p class="hint">Brak zaimportowanych danych publicznych dla tej roli i obszaru.</p>';
  return `<ul>${area.sources.map(source => `<li>${esc(source.sourceName)} · ${source.year}${source.sourceLicense ? ` · ${esc(source.sourceLicense)}` : ''}</li>`).join('')}</ul>`;
}

function areaCard(area: Area, best: boolean): string {
  const salary = area.salaryMin === null && area.salaryMax === null ? 'brak publicznych danych płacowych' : `${area.salaryMin ?? '?'}–${area.salaryMax ?? '?'} zł`;
  return `<article class="card">
    <div class="row-between"><div><span class="badge">${esc(area.areaName)}</span>${best ? '<span class="badge">najlepszy sygnał w zasięgu</span>' : ''}</div><strong>${esc(confidenceLabels[area.confidence])}</strong></div>
    <p class="hint">Odległość referencyjna: ${area.distanceKm.toFixed(1)} km · ${esc(shortageLabels[area.shortageStatus] ?? area.shortageStatus)}</p>
    <h4>Co wiemy</h4><ul>${area.evidence.map(item => `<li>${esc(item)}</li>`).join('')}</ul>
    <p><strong>Wynagrodzenie publiczne:</strong> ${esc(salary)}</p>
    ${area.unconfirmedCredentials.length ? `<p><strong>Nie mamy potwierdzenia w Twoim profilu:</strong> ${area.unconfirmedCredentials.map(esc).join(', ')}.</p>` : ''}
    <h4>Źródła</h4>${sourceList(area)}
  </article>`;
}

function render(report: Report): void {
  const result = document.querySelector<HTMLElement>('#localLabourResult');
  if (!result) return;
  const bestName = report.bestArea?.areaName ?? null;
  result.innerHTML = `
    <div class="card"><div class="row-between"><div><strong>${esc(report.role)}</strong><p class="hint">Punkt startowy: ${esc(report.baseArea)}${report.commuteKm === null ? ' · brak ustawionego promienia dojazdu' : ` · dojazd do ${report.commuteKm} km`}</p></div><span class="badge">${esc(confidenceLabels[report.confidence])}</span></div></div>
    <div class="card"><h3>Czy +10 km ma sens?</h3><p>${esc(report.plusTenKm.message)}</p>${report.plusTenKm.areaName ? `<p class="hint">Obszar porównawczy: ${esc(report.plusTenKm.areaName)} · ${report.plusTenKm.distanceKm?.toFixed(1) ?? '?'} km</p>` : ''}</div>
    ${report.accessibleAreas.length ? report.accessibleAreas.map(area => areaCard(area, area.areaName === bestName)).join('') : '<div class="card"><h3>Za mało danych</h3><p>Nie mamy jeszcze zweryfikowanych danych dla tej roli i lokalizacji. Nie tworzymy rekomendacji z pustego zbioru.</p></div>'}
    <div class="card"><h3>Jak czytać ten wynik</h3><ul>${report.caveats.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>`;
}

async function load(useForm = false): Promise<void> {
  const message = document.querySelector<HTMLElement>('#localLabourMessage');
  try {
    if (message) { message.textContent = 'Porównuję dostępne dowody…'; message.className = 'message'; }
    const form = document.querySelector<HTMLFormElement>('#localLabourForm');
    const data = new FormData(form ?? undefined);
    const params = new URLSearchParams();
    if (useForm) {
      const role = String(data.get('role') ?? '').trim(); const area = String(data.get('area') ?? '').trim();
      if (role) params.set('role', role); if (area) params.set('area', area);
    }
    const response = await api<{ report: Report }>(`/api/local-labour${params.size ? `?${params.toString()}` : ''}`);
    if (form && !useForm) {
      const roleInput = form.elements.namedItem('role') as HTMLInputElement | null; const areaInput = form.elements.namedItem('area') as HTMLInputElement | null;
      if (roleInput && !roleInput.value) roleInput.value = response.report.role;
      if (areaInput && !areaInput.value) areaInput.value = response.report.baseArea;
    }
    render(response.report);
    if (message) { message.textContent = 'Analiza gotowa.'; message.className = 'message success'; }
  } catch (error) {
    if (message) { message.textContent = (error as Error).message; message.className = 'message error'; }
  }
}

let enabled = false;
async function refreshFeature(): Promise<void> {
  try {
    const data = await api<FeatureResponse>('/api/features'); enabled = data.features.local_labour === true;
    if (!enabled) return; ensureUi(); if (location.hash === '#local-labour') { show(); await load(); }
  } catch { enabled = false; }
}
window.addEventListener('hashchange', () => { if (enabled && location.hash === '#local-labour') { show(); void load(); } });
const appView = document.querySelector('#appView');
if (appView) new MutationObserver(() => { if (!appView.classList.contains('hidden')) void refreshFeature(); }).observe(appView, { attributes: true, attributeFilter: ['class'] });
void refreshFeature();
