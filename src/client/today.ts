export {};

type FeatureResponse = { features: { today: boolean } };
type TodayAction = {
  id: string;
  key: string;
  type: string;
  title: string;
  reason: string;
  estimatedMinutes: number;
  priorityScore: number;
  accepted: boolean;
  completed: boolean;
  outcome: string | null;
};
type TodayResponse = { actions: TodayAction[]; timeBudgetMinutes?: number };

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) } });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  return data;
}

function ensureUi(): HTMLElement {
  let screen = document.querySelector<HTMLElement>('[data-screen="today"]');
  if (screen) return screen;
  const mobile = document.querySelector('.mobile-nav');
  const sidebar = document.querySelector('.sidebar');
  const content = document.querySelector('.content');
  if (!mobile || !sidebar || !content) throw new Error('Brak kontenera aplikacji.');

  const mobileButton = document.createElement('button');
  mobileButton.type = 'button'; mobileButton.className = 'nav-item'; mobileButton.dataset.view = 'today'; mobileButton.textContent = 'Dzisiaj';
  mobile.insertBefore(mobileButton, mobile.children[1] ?? null);

  const sideButton = document.createElement('button');
  sideButton.type = 'button'; sideButton.className = 'side-link'; sideButton.dataset.view = 'today'; sideButton.textContent = 'Dzisiaj';
  const firstSideLink = sidebar.querySelector('.side-link');
  if (firstSideLink?.nextSibling) sidebar.insertBefore(sideButton, firstSideLink.nextSibling); else sidebar.append(sideButton);

  screen = document.createElement('section');
  screen.className = 'screen hidden'; screen.dataset.screen = 'today';
  screen.innerHTML = `
    <div class="screen-heading"><p class="eyebrow">Action Priority</p><h2>DZISIAJ</h2><p>Jeśli masz dziś tylko chwilę, zacznij od działania, które najbardziej przesuwa Cię do przodu.</p></div>
    <div class="card"><fieldset><legend>Ile masz dziś czasu?</legend><div class="fact-actions" id="todayBudget">
      <button class="button button-secondary" type="button" data-today-budget="10">10 min</button>
      <button class="button button-secondary" type="button" data-today-budget="30">30 min</button>
      <button class="button button-secondary" type="button" data-today-budget="60">1 godz.</button>
      <button class="button button-secondary" type="button" data-today-budget="120">Więcej</button>
    </div></fieldset><div id="todayMessage" class="message" aria-live="polite"></div></div>
    <div id="todayActions" class="stack section-gap" aria-live="polite"></div>`;
  content.prepend(screen);

  for (const button of [mobileButton, sideButton]) {
    button.addEventListener('click', () => { location.hash = 'today'; showToday(); void loadToday(); });
  }
  screen.querySelector('#todayBudget')?.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-today-budget]');
    if (button) void recommend(Number(button.dataset.todayBudget));
  });
  screen.querySelector('#todayActions')?.addEventListener('click', event => {
    const target = event.target as Element;
    const accept = target.closest<HTMLButtonElement>('[data-today-accept]');
    const complete = target.closest<HTMLButtonElement>('[data-today-complete]');
    if (accept) void mutateAction(accept.dataset.todayAccept ?? '', 'accept');
    if (complete) void mutateAction(complete.dataset.todayComplete ?? '', 'complete');
  });
  return screen;
}

function showToday(): void {
  document.querySelectorAll<HTMLElement>('[data-screen]').forEach(element => element.classList.toggle('hidden', element.dataset.screen !== 'today'));
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(element => element.classList.toggle('active', element.dataset.view === 'today'));
}

function render(actions: TodayAction[]): void {
  const list = document.querySelector<HTMLElement>('#todayActions');
  if (!list) return;
  if (actions.length === 0) {
    list.innerHTML = '<div class="card"><strong>Najważniejsze na dziś zrobione.</strong><p class="hint">Możesz wrócić jutro albo wybrać inny budżet czasu.</p></div>';
    return;
  }
  list.innerHTML = actions.map((action, index) => `
    <article class="card action-card${action.completed ? ' today-completed' : ''}">
      <div class="row-between"><span class="badge">${index + 1}</span><span class="hint">około ${esc(action.estimatedMinutes)} min</span></div>
      <h3>${esc(action.title)}</h3><p>${esc(action.reason)}</p>
      ${action.outcome ? `<p class="hint"><strong>Wynik:</strong> ${esc(action.outcome)}</p>` : ''}
      <div class="fact-actions">
        ${!action.accepted && !action.completed ? `<button class="button button-secondary" type="button" data-today-accept="${esc(action.id)}">Wybieram to</button>` : ''}
        ${!action.completed ? `<button class="button button-primary" type="button" data-today-complete="${esc(action.id)}">Zrobione</button>` : '<span class="badge">Gotowe</span>'}
      </div>
    </article>`).join('');
}

function message(text: string, error = false): void {
  const element = document.querySelector<HTMLElement>('#todayMessage');
  if (!element) return;
  element.textContent = text; element.className = `message ${error ? 'error' : 'success'}`;
}

async function loadToday(): Promise<void> {
  try { render((await api<TodayResponse>('/api/today')).actions); }
  catch (error) { message((error as Error).message, true); }
}

async function recommend(timeBudgetMinutes: number): Promise<void> {
  try {
    message('Układam najważniejsze działania…');
    const data = await api<TodayResponse>('/api/today/recommendations', { method: 'POST', body: JSON.stringify({ timeBudgetMinutes }) });
    render(data.actions); message(data.actions.length ? 'Plan na dziś jest gotowy.' : 'Najważniejsze na dziś zrobione.');
  } catch (error) { message((error as Error).message, true); }
}

async function mutateAction(actionId: string, operation: 'accept' | 'complete'): Promise<void> {
  if (!actionId) return;
  try {
    const init: RequestInit = { method: 'PATCH' };
    if (operation === 'complete') init.body = JSON.stringify({ outcome: 'Oznaczone jako wykonane przez użytkownika.' });
    await api(`/api/today/actions/${encodeURIComponent(actionId)}/${operation}`, init);
    await loadToday();
    message(operation === 'complete' ? 'Działanie oznaczone jako wykonane.' : 'Działanie wybrane.');
  } catch (error) { message((error as Error).message, true); }
}

let enabled = false;
async function refreshFeature(): Promise<void> {
  try {
    const data = await api<FeatureResponse>('/api/features');
    enabled = data.features.today;
    if (!enabled) return;
    ensureUi();
    if (location.hash === '#today') { showToday(); await loadToday(); }
  } catch { enabled = false; }
}

window.addEventListener('hashchange', () => { if (enabled && location.hash === '#today') { showToday(); void loadToday(); } });
const appView = document.querySelector('#appView');
if (appView) new MutationObserver(() => { if (!appView.classList.contains('hidden')) void refreshFeature(); }).observe(appView, { attributes: true, attributeFilter: ['class'] });
void refreshFeature();
