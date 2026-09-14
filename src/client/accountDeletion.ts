export {};

type ApiErrorPayload = { error?: { message?: string } };

const button = document.querySelector<HTMLButtonElement>('#deleteAccountButton');
const confirmation = document.querySelector<HTMLInputElement>('#deleteConfirmation');
const password = document.querySelector<HTMLInputElement>('#deletePassword');
const toast = document.querySelector<HTMLElement>('#toast');

function showToast(text: string): void {
  if (!toast) return;
  toast.textContent = text;
  toast.classList.remove('hidden');
  window.setTimeout(() => toast.classList.add('hidden'), 2600);
}

async function deleteAccount(): Promise<void> {
  if (!button || !confirmation || !password) return;
  button.disabled = true;
  try {
    const response = await fetch('/api/account', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: confirmation.value, password: password.value })
    });
    const payload = await response.json().catch(() => ({})) as ApiErrorPayload;
    if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
    password.value = '';
    confirmation.value = '';
    location.hash = '';
    location.reload();
  } catch (error) {
    password.value = '';
    showToast(error instanceof Error ? error.message : 'Nie udało się usunąć konta.');
  } finally {
    button.disabled = false;
  }
}

// The main client has the legacy destructive-action handler. Capture-phase
// ownership here deliberately prevents it from issuing an un-reauthenticated
// request while keeping the rest of the existing application module unchanged.
button?.addEventListener('click', event => {
  event.stopImmediatePropagation();
  void deleteAccount();
}, { capture: true });
