export {};

type Confidence = 'ZA_MALO_DANYCH' | 'WCZESNY_SYGNAL' | 'PRAWDOPODOBNY_WNIOSEK' | 'SILNY_WNIOSEK';
type Diagnosis = {
  stage: string; sampleSize: number; confidence: Confidence; rate: number | null; headline: string;
  evidence: string[]; alternativeExplanations: string[]; recommendedAction: string;
};
type Report = { primary: Diagnosis | null; diagnostics: Diagnosis[]; overallConfidence: Confidence; message: string; minimumSample: number };
type FeatureResponse = { features: { bottleneck?: boolean } };

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
  ZA_MALO_DANYCH: 'ZA MAŁO DANYCH',
  WCZESNY_SYGNAL: 'WCZESNY SYGNAŁ',
  PRAWDOPODOBNY_WNIOSEK: 'PRAWDOPODOBNY WNIOSEK',
  SILNY_WNIOSEK: 'SILNY WNIOSEK'
};

function ensureUi(): HTMLElement {
  let screen = document.querySelector<HTMLElement>('[data-screen="bottleneck"]');
  if (screen) return screen;
  const mobile = document.querySelector('.mobile-nav');
  const sidebar = document.querySelector('.sidebar');
  const content = document.querySelector('.content');
  if (!mobile || !sidebar || !content) throw new Error('Brak kontenera aplikacji.');

  const mobileButton = document.createElement('button');
  mobileButton.type = 'button'; mobileButton.className = 'nav-item'; mobileButton.dataset.view = 'bottleneck'; mobileButton.textContent = 'Analiza';
  mobile.append(mobileButton);
  const sideButton = document.createElement('button');
  sideButton.type = 'button'; sideButton.className = 'side-link'; sideButton.dataset.view = 'bottleneck'; sideButton.textContent = 'Wąskie gardło';
  sidebar.append(sideButton);

  screen = document.createElement('section');
  screen.className = 'screen hidden'; screen.dataset.screen = 'bottleneck';
  screen.innerHTML = `
    <div class="screen-heading"><p class="eyebrow">Wnioski dopiero wtedy, gdy są dane</p><h2>Gdzie naprawdę zatrzymuje się proces?</h2><p>Analiza patrzy na Twoje zapisane oferty, decyzje, aplikacje i wyniki. Mała próbka nie jest diagnozą.</p></div>
    <div class="card"><div class="row-between"><div><h3>Analiza procesu</h3><p class="hint">Nie przypisujemy przyczyny bez eksperymentu. Pokazujemy dane, alternatywne wyjaśnienia i jeden bezpieczny następny krok.</p></div><button id="bottleneckRefresh" class="button button-secondary" type="button">Przelicz</button></div><div id="bottleneckMessage" class="message" aria-live="polite"></div></div>
    <div id="bottleneckResult" class="stack section-gap" aria-live="polite"></div>`;
  content.append(screen);
  for (const button of [mobileButton, sideButton]) button.addEventListener('click', () => { location.hash = 'bottleneck'; show(); void load(); });
  screen.querySelector('#bottleneckRefresh')?.addEventListener('click', () => { void load(); });
  return screen;
}

function show(): void {
  document.querySelectorAll<HTMLElement>('[data-screen]').forEach(element => element.classList.toggle('hidden', element.dataset.screen !== 'bottleneck'));
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(element => element.classList.toggle('active', element.dataset.view === 'bottleneck'));
}

function list(items: string[]): string {
  return `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
}

function renderDiagnosis(item: Diagnosis, primary: boolean): string {
  return `<article class="card">
    <div class="row-between"><div><span class="badge">${esc(item.stage)}</span>${primary ? '<span class="badge">najsilniejszy obecny sygnał</span>' : ''}</div><strong>${esc(confidenceLabels[item.confidence])}</strong></div>
    <h3>${esc(item.headline)}</h3>
    <p class="hint">Próbka: ${item.sampleSize}${item.rate === null ? '' : ` · obserwowany udział: ${Math.round(item.rate * 100)}%`}</p>
    <h4>Dowody</h4>${list(item.evidence)}
    <h4>Inne możliwe wyjaśnienia</h4>${list(item.alternativeExplanations)}
    <h4>Następny krok</h4><p>${esc(item.recommendedAction)}</p>
  </article>`;
}

function render(report: Report): void {
  const result = document.querySelector<HTMLElement>('#bottleneckResult');
  if (!result) return;
  const primaryStage = report.primary?.stage ?? null;
  result.innerHTML = `
    <div class="card"><div class="row-between"><strong>Poziom pewności</strong><span class="badge">${esc(confidenceLabels[report.overallConfidence])}</span></div><p>${esc(report.message)}</p><p class="hint">Minimalna próbka do pierwszego sygnału: ${report.minimumSample}. Silniejszy język pojawia się dopiero przy większej liczbie obserwacji.</p></div>
    ${report.diagnostics.map(item => renderDiagnosis(item, item.stage === primaryStage)).join('')}`;
}

async function load(): Promise<void> {
  const message = document.querySelector<HTMLElement>('#bottleneckMessage');
  try {
    if (message) { message.textContent = 'Analizuję wyłącznie zapisane dane…'; message.className = 'message'; }
    const data = await api<{ report: Report }>('/api/bottleneck');
    render(data.report);
    if (message) { message.textContent = 'Analiza gotowa.'; message.className = 'message success'; }
  } catch (error) {
    if (message) { message.textContent = (error as Error).message; message.className = 'message error'; }
  }
}

let enabled = false;
async function refreshFeature(): Promise<void> {
  try {
    const data = await api<FeatureResponse>('/api/features'); enabled = data.features.bottleneck === true;
    if (!enabled) return;
    ensureUi(); if (location.hash === '#bottleneck') { show(); await load(); }
  } catch { enabled = false; }
}

window.addEventListener('hashchange', () => { if (enabled && location.hash === '#bottleneck') { show(); void load(); } });
const appView = document.querySelector('#appView');
if (appView) new MutationObserver(() => { if (!appView.classList.contains('hidden')) void refreshFeature(); }).observe(appView, { attributes: true, attributeFilter: ['class'] });
void refreshFeature();
