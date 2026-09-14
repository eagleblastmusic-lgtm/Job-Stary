export {};

type FeatureResponse = { features: { notifications?: boolean } };
type NotificationPreferences = { followUp: boolean; deadlines: boolean; interviews: boolean; matchedJobs: boolean };
type NotificationItem = { id: string; type: string; message: string; readAt: string | null; createdAt: string };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) } });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  return data;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

function ensureUi(): HTMLElement {
  let screen = document.querySelector<HTMLElement>('[data-screen="notifications"]');
  if (screen) return screen;
  const mobile = document.querySelector('.mobile-nav');
  const sidebar = document.querySelector('.sidebar');
  const content = document.querySelector('.content');
  if (!mobile || !sidebar || !content) throw new Error('Brak kontenera aplikacji.');

  const mobileButton = document.createElement('button');
  mobileButton.type = 'button'; mobileButton.className = 'nav-item'; mobileButton.dataset.view = 'notifications'; mobileButton.textContent = 'Alerty';
  mobile.append(mobileButton);
  const sideButton = document.createElement('button');
  sideButton.type = 'button'; sideButton.className = 'side-link'; sideButton.dataset.view = 'notifications'; sideButton.textContent = 'Powiadomienia';
  sidebar.append(sideButton);

  screen = document.createElement('section');
  screen.className = 'screen hidden'; screen.dataset.screen = 'notifications';
  screen.innerHTML = `
    <div class="screen-heading"><p class="eyebrow">Tylko użyteczne przypomnienia</p><h2>Powiadomienia</h2><p>Bez presji i bez alarmów. Pokazujemy tylko rzeczy, które mogą zmienić Twój następny krok.</p></div>
    <div class="card">
      <h3>Ustawienia</h3>
      <form id="notificationPreferences" class="stack">
        <label class="consent-row"><input name="followUp" type="checkbox"><span>Follow-up po co najmniej 7 dniach bez wyniku</span></label>
        <label class="consent-row"><input name="deadlines" type="checkbox"><span>Termin oferty kończy się jutro</span></label>
        <label class="consent-row"><input name="interviews" type="checkbox"><span>Rozmowa jutro — gdy tracker będzie miał prawdziwą datę rozmowy</span></label>
        <label class="consent-row"><input name="matchedJobs" type="checkbox"><span>Nowa dobrze dopasowana oferta — po uruchomieniu Feed</span></label>
        <button class="button button-secondary" type="submit">Zapisz ustawienia</button>
      </form>
      <div id="notificationMessage" class="message" aria-live="polite"></div>
    </div>
    <div id="notificationList" class="stack section-gap" aria-live="polite"></div>`;
  content.append(screen);

  for (const button of [mobileButton, sideButton]) button.addEventListener('click', () => { location.hash = 'notifications'; show(); void loadAll(); });
  screen.querySelector<HTMLFormElement>('#notificationPreferences')?.addEventListener('submit', event => { event.preventDefault(); void savePreferences(); });
  screen.querySelector('#notificationList')?.addEventListener('click', event => {
    const target = event.target as Element;
    const read = target.closest<HTMLButtonElement>('[data-notification-read]');
    const dismiss = target.closest<HTMLButtonElement>('[data-notification-dismiss]');
    if (read) void mutate(read.dataset.notificationRead ?? '', 'read');
    if (dismiss) void mutate(dismiss.dataset.notificationDismiss ?? '', 'dismiss');
  });
  return screen;
}

function show(): void {
  document.querySelectorAll<HTMLElement>('[data-screen]').forEach(element => element.classList.toggle('hidden', element.dataset.screen !== 'notifications'));
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(element => element.classList.toggle('active', element.dataset.view === 'notifications'));
}

function renderPreferences(preferences: NotificationPreferences): void {
  const form = document.querySelector<HTMLFormElement>('#notificationPreferences');
  if (!form) return;
  for (const key of ['followUp', 'deadlines', 'interviews', 'matchedJobs'] as const) {
    const input = form.elements.namedItem(key) as HTMLInputElement | null;
    if (input) input.checked = preferences[key];
  }
}

function renderNotifications(items: NotificationItem[]): void {
  const list = document.querySelector<HTMLElement>('#notificationList');
  if (!list) return;
  list.innerHTML = items.length ? items.map(item => `
    <article class="card">
      <div class="row-between"><span class="badge">${esc(item.type)}</span>${item.readAt ? '<span class="hint">przeczytane</span>' : '<span class="badge">nowe</span>'}</div>
      <p>${esc(item.message)}</p>
      <div class="fact-actions">
        ${item.readAt ? '' : `<button class="button button-secondary" type="button" data-notification-read="${esc(item.id)}">Oznacz jako przeczytane</button>`}
        <button class="button button-ghost" type="button" data-notification-dismiss="${esc(item.id)}">Ukryj</button>
      </div>
    </article>`).join('') : '<div class="card"><strong>Brak nowych rzeczy do sprawdzenia.</strong><p class="hint">Nie będziemy tworzyć powiadomień tylko po to, żeby zwrócić uwagę.</p></div>';
}

function message(text: string, error = false): void {
  const element = document.querySelector<HTMLElement>('#notificationMessage');
  if (!element) return;
  element.textContent = text; element.className = `message ${error ? 'error' : 'success'}`;
}

async function loadAll(): Promise<void> {
  try {
    const [settings, items] = await Promise.all([
      api<{ preferences: NotificationPreferences }>('/api/notifications/preferences'),
      api<{ notifications: NotificationItem[] }>('/api/notifications')
    ]);
    renderPreferences(settings.preferences); renderNotifications(items.notifications);
  } catch (error) { message((error as Error).message, true); }
}

async function savePreferences(): Promise<void> {
  const form = document.querySelector<HTMLFormElement>('#notificationPreferences');
  if (!form) return;
  const value = (key: string): boolean => (form.elements.namedItem(key) as HTMLInputElement | null)?.checked === true;
  try {
    const data = await api<{ preferences: NotificationPreferences }>('/api/notifications/preferences', {
      method: 'PUT', body: JSON.stringify({ followUp: value('followUp'), deadlines: value('deadlines'), interviews: value('interviews'), matchedJobs: value('matchedJobs') })
    });
    renderPreferences(data.preferences); message('Ustawienia powiadomień zapisane.'); await loadAll();
  } catch (error) { message((error as Error).message, true); }
}

async function mutate(id: string, action: 'read' | 'dismiss'): Promise<void> {
  if (!id) return;
  try { await api(`/api/notifications/${encodeURIComponent(id)}/${action}`, { method: 'PATCH' }); await loadAll(); }
  catch (error) { message((error as Error).message, true); }
}

let enabled = false;
async function refreshFeature(): Promise<void> {
  try {
    const data = await api<FeatureResponse>('/api/features'); enabled = data.features.notifications === true;
    if (!enabled) return;
    ensureUi(); if (location.hash === '#notifications') { show(); await loadAll(); }
  } catch { enabled = false; }
}

window.addEventListener('hashchange', () => { if (enabled && location.hash === '#notifications') { show(); void loadAll(); } });
const appView = document.querySelector('#appView');
if (appView) new MutationObserver(() => { if (!appView.classList.contains('hidden')) void refreshFeature(); }).observe(appView, { attributes: true, attributeFilter: ['class'] });
void refreshFeature();
