export {};

type FeatureResponse = { features: { effective_wage?: boolean } };
type Preferences = {
  commuteRoundTripKm: number | null; commuteMinutesPerDay: number | null; commuteDaysPerMonth: number;
  vehicleCostPerKm: number | null; estimatedNetRatio: number | null; monthlyWorkHours: number; subjectiveTimeValuePerHour: number | null;
};
type JobOption = { id: string; title: string | null; company: string | null; location: string | null; salaryMin: number | null; salaryMax: number | null; salaryPeriod: string; grossNet: string };
type Range = { min: number | null; max: number | null };
type Calculation = { job: JobOption; preferences: Preferences; result: { monthlySalaryInput: Range; estimatedMonthlyNet: Range; monthlyCommuteCost: number | null; monthlyCommuteHours: number | null; cashAfterCommute: Range; cashPerWorkHourAfterCommute: Range; subjectiveTimeCost: number | null; cashAfterCommuteAndSubjectiveTime: Range; assumptions: string[]; warnings: string[]; shiftContext: string[] } };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) } });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  return data;
}

function esc(value: unknown): string { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char)); }
const money = (value: number | null): string => value === null ? '—' : `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(value)} zł`;
const hourly = (value: number | null): string => value === null ? '—' : `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(value)} zł/h`;
const range = (value: Range, formatter = money): string => value.min === null && value.max === null ? '—' : value.min === value.max || value.max === null ? formatter(value.min) : value.min === null ? formatter(value.max) : `${formatter(value.min)} – ${formatter(value.max)}`;

function ensureUi(): HTMLElement {
  let screen = document.querySelector<HTMLElement>('[data-screen="effective-wage"]');
  if (screen) return screen;
  const mobile = document.querySelector('.mobile-nav'); const sidebar = document.querySelector('.sidebar'); const content = document.querySelector('.content');
  if (!mobile || !sidebar || !content) throw new Error('Brak kontenera aplikacji.');
  const m = document.createElement('button'); m.type = 'button'; m.className = 'nav-item'; m.dataset.view = 'effective-wage'; m.textContent = 'Wartość'; mobile.append(m);
  const s = document.createElement('button'); s.type = 'button'; s.className = 'side-link'; s.dataset.view = 'effective-wage'; s.textContent = 'Efektywne wynagrodzenie'; sidebar.append(s);
  screen = document.createElement('section'); screen.className = 'screen hidden'; screen.dataset.screen = 'effective-wage';
  screen.innerHTML = `
    <div class="screen-heading"><p class="eyebrow">Opcjonalne narzędzie decyzyjne</p><h2>Efektywne wynagrodzenie</h2><p>Porównaj pieniądze po koszcie dojazdu. Wartość Twojego czasu jest opcjonalna i zawsze oznaczona jako subiektywne ustawienie.</p></div>
    <div class="card"><h3>Twoje założenia</h3><form id="effectiveWagePreferences" class="stack">
      <label>Km dojazdu dziennie, w obie strony<input name="commuteRoundTripKm" type="number" min="0" max="1000" step="0.1"></label>
      <label>Minuty dojazdu dziennie<input name="commuteMinutesPerDay" type="number" min="0" max="1440" step="1"></label>
      <label>Dni dojazdu w miesiącu<input name="commuteDaysPerMonth" type="number" min="0" max="31" step="1" required></label>
      <label>Koszt 1 km według Ciebie (zł)<input name="vehicleCostPerKm" type="number" min="0" max="100" step="0.01"></label>
      <label>Szacowany udział netto w brutto (np. 0,73)<input name="estimatedNetRatio" type="number" min="0.01" max="1" step="0.01"><span class="hint">Uproszczenie użytkownika, nie kalkulator podatkowy.</span></label>
      <label>Godziny pracy miesięcznie<input name="monthlyWorkHours" type="number" min="1" max="300" step="1" required></label>
      <label>Opcjonalna subiektywna wartość 1 h Twojego czasu (zł)<input name="subjectiveTimeValuePerHour" type="number" min="0" max="10000" step="0.01"><span class="hint">To Twoja preferencja. Nie przedstawiamy jej jako obiektywnej wartości czasu.</span></label>
      <button class="button button-secondary" type="submit">Zapisz założenia</button></form><div id="effectiveWageMessage" class="message" aria-live="polite"></div></div>
    <div class="card section-gap"><h3>Oferta</h3><label>Wybierz zapisaną ofertę<select id="effectiveWageJob"></select></label><button id="effectiveWageCalculate" class="button" type="button">Policz</button></div>
    <div id="effectiveWageResult" class="stack section-gap" aria-live="polite"></div>`;
  content.append(screen);
  for (const b of [m, s]) b.addEventListener('click', () => { location.hash = 'effective-wage'; show(); void load(); });
  screen.querySelector<HTMLFormElement>('#effectiveWagePreferences')?.addEventListener('submit', event => { event.preventDefault(); void savePreferences(); });
  screen.querySelector('#effectiveWageCalculate')?.addEventListener('click', () => { void calculate(); });
  return screen;
}

function show(): void {
  document.querySelectorAll<HTMLElement>('[data-screen]').forEach(el => el.classList.toggle('hidden', el.dataset.screen !== 'effective-wage'));
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === 'effective-wage'));
}

function setMessage(text: string, error = false): void { const el = document.querySelector<HTMLElement>('#effectiveWageMessage'); if (el) { el.textContent = text; el.className = `message ${error ? 'error' : 'success'}`; } }
function input(name: string): HTMLInputElement | null { return document.querySelector<HTMLInputElement>(`#effectiveWagePreferences [name="${name}"]`); }
function setInput(name: string, value: number | null): void { const el = input(name); if (el) el.value = value === null ? '' : String(value); }
function numberValue(name: string, required = false): number | null { const value = input(name)?.value.trim() ?? ''; if (!value) return required ? 0 : null; const parsed = Number(value.replace(',', '.')); return Number.isFinite(parsed) ? parsed : null; }

function renderPreferences(p: Preferences): void {
  setInput('commuteRoundTripKm', p.commuteRoundTripKm); setInput('commuteMinutesPerDay', p.commuteMinutesPerDay); setInput('commuteDaysPerMonth', p.commuteDaysPerMonth);
  setInput('vehicleCostPerKm', p.vehicleCostPerKm); setInput('estimatedNetRatio', p.estimatedNetRatio); setInput('monthlyWorkHours', p.monthlyWorkHours); setInput('subjectiveTimeValuePerHour', p.subjectiveTimeValuePerHour);
}

function renderJobs(jobs: JobOption[]): void {
  const select = document.querySelector<HTMLSelectElement>('#effectiveWageJob'); if (!select) return;
  select.innerHTML = jobs.length ? jobs.map(job => `<option value="${esc(job.id)}">${esc(job.title ?? 'Oferta bez tytułu')} — ${esc(job.company ?? 'firma nieustalona')} (${esc(job.location ?? 'lokalizacja nieustalona')})</option>`).join('') : '<option value="">Brak zapisanych ofert</option>';
}

function list(items: string[]): string { return items.length ? `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '<p class="hint">Brak.</p>'; }
function renderCalculation(c: Calculation): void {
  const result = document.querySelector<HTMLElement>('#effectiveWageResult'); if (!result) return;
  const r = c.result;
  result.innerHTML = `<div class="card"><h3>${esc(c.job.title ?? 'Oferta')}</h3><p>${esc(c.job.company ?? '')}</p>
    <div class="metric-grid"><div><span class="hint">Szacowane netto / mies.</span><strong>${range(r.estimatedMonthlyNet)}</strong></div><div><span class="hint">Koszt dojazdu / mies.</span><strong>${money(r.monthlyCommuteCost)}</strong></div><div><span class="hint">Gotówka po dojeździe</span><strong>${range(r.cashAfterCommute)}</strong></div><div><span class="hint">Po dojeździe / godz. pracy</span><strong>${range(r.cashPerWorkHourAfterCommute, hourly)}</strong></div></div>
    <p class="hint">Czas dojazdu: ${r.monthlyCommuteHours === null ? '—' : `${r.monthlyCommuteHours.toFixed(1)} h/mies.`}</p></div>
    <div class="card"><h3>Subiektywna wartość czasu — osobno</h3><p>To nie jest obiektywne wynagrodzenie. Poniższa korekta istnieje tylko wtedy, gdy sam ustawisz wartość godziny.</p><p><strong>Koszt czasu:</strong> ${money(r.subjectiveTimeCost)}</p><p><strong>Gotówka po dojeździe i Twojej wycenie czasu:</strong> ${range(r.cashAfterCommuteAndSubjectiveTime)}</p></div>
    <div class="card"><h3>Założenia</h3>${list(r.assumptions)}</div><div class="card"><h3>Ostrzeżenia / brak danych</h3>${list(r.warnings)}</div><div class="card"><h3>Zmiany i czas pracy</h3>${list(r.shiftContext)}</div>`;
}

async function load(): Promise<void> {
  try { const [prefs, jobs] = await Promise.all([api<{ preferences: Preferences }>('/api/effective-wage/preferences'), api<{ jobs: JobOption[] }>('/api/effective-wage/jobs')]); renderPreferences(prefs.preferences); renderJobs(jobs.jobs); }
  catch (error) { setMessage((error as Error).message, true); }
}

async function savePreferences(): Promise<void> {
  try {
    const body = { commuteRoundTripKm: numberValue('commuteRoundTripKm'), commuteMinutesPerDay: numberValue('commuteMinutesPerDay'), commuteDaysPerMonth: numberValue('commuteDaysPerMonth', true), vehicleCostPerKm: numberValue('vehicleCostPerKm'), estimatedNetRatio: numberValue('estimatedNetRatio'), monthlyWorkHours: numberValue('monthlyWorkHours', true), subjectiveTimeValuePerHour: numberValue('subjectiveTimeValuePerHour') };
    const data = await api<{ preferences: Preferences }>('/api/effective-wage/preferences', { method: 'PUT', body: JSON.stringify(body) }); renderPreferences(data.preferences); setMessage('Założenia zapisane.');
  } catch (error) { setMessage((error as Error).message, true); }
}

async function calculate(): Promise<void> {
  const jobId = document.querySelector<HTMLSelectElement>('#effectiveWageJob')?.value; if (!jobId) { setMessage('Najpierw dodaj lub wybierz ofertę.', true); return; }
  try { const data = await api<{ calculation: Calculation }>(`/api/effective-wage/jobs/${encodeURIComponent(jobId)}`); renderCalculation(data.calculation); }
  catch (error) { setMessage((error as Error).message, true); }
}

let enabled = false;
async function refreshFeature(): Promise<void> { try { const data = await api<FeatureResponse>('/api/features'); enabled = data.features.effective_wage === true; if (!enabled) return; ensureUi(); if (location.hash === '#effective-wage') { show(); await load(); } } catch { enabled = false; } }
window.addEventListener('hashchange', () => { if (enabled && location.hash === '#effective-wage') { show(); void load(); } });
const appView = document.querySelector('#appView'); if (appView) new MutationObserver(() => { if (!appView.classList.contains('hidden')) void refreshFeature(); }).observe(appView, { attributes: true, attributeFilter: ['class'] });
void refreshFeature();
