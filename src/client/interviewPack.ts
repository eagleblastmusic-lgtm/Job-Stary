export {};

type FeatureResponse = { features: { interview_pack?: boolean } };
type ApplicationItem = { id: string; title: string | null; company: string | null; status: string };
type InterviewPack = {
  companySummary: string;
  roleSummary: string;
  keyRequirements: string[];
  strongestArguments: string[];
  potentialGaps: string[];
  likelyQuestions: string[];
  answerFrameworks: Array<{ question: string; framework: string[] }>;
  questionsToEmployer: string[];
  salaryPreparation: string[];
  miniTest: string[];
  checklist: string[];
  truthBoundary: string;
};

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  return data;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

function list(values: string[]): string {
  return `<ul>${values.map(value => `<li>${esc(value)}</li>`).join('')}</ul>`;
}

function section(title: string, values: string[]): string {
  return `<section class="decision-block"><h3>${esc(title)}</h3>${list(values)}</section>`;
}

function ensureUi(): HTMLElement {
  let screen = document.querySelector<HTMLElement>('[data-screen="interview"]');
  if (screen) return screen;
  const mobile = document.querySelector('.mobile-nav');
  const sidebar = document.querySelector('.sidebar');
  const content = document.querySelector('.content');
  if (!mobile || !sidebar || !content) throw new Error('Brak kontenera aplikacji.');

  const mobileButton = document.createElement('button');
  mobileButton.type = 'button'; mobileButton.className = 'nav-item'; mobileButton.dataset.view = 'interview'; mobileButton.textContent = 'Rozmowa';
  mobile.append(mobileButton);
  const sideButton = document.createElement('button');
  sideButton.type = 'button'; sideButton.className = 'side-link'; sideButton.dataset.view = 'interview'; sideButton.textContent = 'Przygotuj rozmowę';
  sidebar.append(sideButton);

  screen = document.createElement('section');
  screen.className = 'screen hidden'; screen.dataset.screen = 'interview';
  screen.innerHTML = `
    <div class="screen-heading"><p class="eyebrow">Interview Prep Pack</p><h2>Przygotuj się do rozmowy</h2><p>Pakiet korzysta tylko z zapisanej oferty i Career Truth. Nie tworzymy za Ciebie historii ani doświadczeń.</p></div>
    <div class="card"><h3>Wybierz aplikację</h3><div id="interviewApplications" class="stack"></div><div id="interviewMessage" class="message" aria-live="polite"></div></div>
    <div id="interviewPackResult" class="section-gap" aria-live="polite"></div>`;
  content.append(screen);
  for (const button of [mobileButton, sideButton]) button.addEventListener('click', () => { location.hash = 'interview'; show(); void loadApplications(); });
  screen.querySelector('#interviewApplications')?.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-interview-application]');
    if (button?.dataset.interviewApplication) void loadPack(button.dataset.interviewApplication);
  });
  return screen;
}

function show(): void {
  document.querySelectorAll<HTMLElement>('[data-screen]').forEach(element => element.classList.toggle('hidden', element.dataset.screen !== 'interview'));
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(element => element.classList.toggle('active', element.dataset.view === 'interview'));
}

function message(text: string, error = false): void {
  const element = document.querySelector<HTMLElement>('#interviewMessage');
  if (!element) return;
  element.textContent = text; element.className = `message ${error ? 'error' : 'success'}`;
}

async function loadApplications(): Promise<void> {
  const listElement = document.querySelector<HTMLElement>('#interviewApplications');
  if (!listElement) return;
  try {
    const data = await api<{ applications: ApplicationItem[] }>('/api/applications');
    listElement.innerHTML = data.applications.length ? data.applications.map(application => `
      <article class="fact-item">
        <div><strong>${esc(application.title ?? 'Oferta')}</strong>${application.company ? ` — ${esc(application.company)}` : ''}<div class="hint">Status: ${esc(application.status)}</div></div>
        <div class="fact-actions"><button class="button button-secondary" type="button" data-interview-application="${esc(application.id)}">Przygotuj pakiet</button></div>
      </article>`).join('') : '<p class="hint">Najpierw zapisz aplikację do konkretnej oferty.</p>';
  } catch (error) { message((error as Error).message, true); }
}

function renderPack(pack: InterviewPack): void {
  const result = document.querySelector<HTMLElement>('#interviewPackResult');
  if (!result) return;
  const frameworks = pack.answerFrameworks.map(item => `<article class="card"><h4>${esc(item.question)}</h4>${list(item.framework)}</article>`).join('');
  result.innerHTML = `
    <article class="card decision-card">
      <span class="decision-label">CAREER TRUTH ONLY</span>
      <h3>Firma i rola</h3><p>${esc(pack.companySummary)}</p><p>${esc(pack.roleSummary)}</p>
      ${section('Kluczowe wymagania', pack.keyRequirements)}
      ${section('Twoje najmocniejsze potwierdzone argumenty', pack.strongestArguments)}
      ${section('Potencjalne luki / rzeczy do wyjaśnienia', pack.potentialGaps)}
      ${section('Prawdopodobne pytania', pack.likelyQuestions)}
      <section class="decision-block"><h3>Jak budować odpowiedzi</h3><div class="stack">${frameworks}</div></section>
      ${section('Pytania do pracodawcy', pack.questionsToEmployer)}
      ${section('Przygotowanie wynagrodzenia', pack.salaryPreparation)}
      ${section('Mini-test', pack.miniTest)}
      ${section('Checklista', pack.checklist)}
      <p class="hint"><strong>Granica prawdy:</strong> ${esc(pack.truthBoundary)}</p>
    </article>`;
}

async function loadPack(applicationId: string): Promise<void> {
  try {
    message('Przygotowuję pakiet…');
    const data = await api<{ pack: InterviewPack }>(`/api/applications/${encodeURIComponent(applicationId)}/interview-pack`);
    renderPack(data.pack); message('Pakiet gotowy. Sprawdź go przed rozmową.');
  } catch (error) { message((error as Error).message, true); }
}

let enabled = false;
async function refreshFeature(): Promise<void> {
  try {
    const data = await api<FeatureResponse>('/api/features'); enabled = data.features.interview_pack === true;
    if (!enabled) return;
    ensureUi(); if (location.hash === '#interview') { show(); await loadApplications(); }
  } catch { enabled = false; }
}

window.addEventListener('hashchange', () => { if (enabled && location.hash === '#interview') { show(); void loadApplications(); } });
const appView = document.querySelector('#appView');
if (appView) new MutationObserver(() => { if (!appView.classList.contains('hidden')) void refreshFeature(); }).observe(appView, { attributes: true, attributeFilter: ['class'] });
void refreshFeature();
