import './outcomeInbox.js';
import './strategy.js';

export {};

const form = document.querySelector<HTMLFormElement>('#experienceForm');
const endDate = form?.querySelector<HTMLInputElement>('input[name="endDate"]');
const endLabel = endDate?.closest('label');

if (form && endDate && endLabel && !form.querySelector('input[name="current"]')) {
  const currentLabel = document.createElement('label');
  currentLabel.className = 'span-2 consent-row';
  const current = document.createElement('input');
  current.type = 'checkbox';
  current.name = 'current';
  const text = document.createElement('span');
  text.textContent = 'Pracuję tu obecnie';
  currentLabel.append(current, text);
  endLabel.after(currentLabel);

  current.addEventListener('change', () => {
    if (current.checked) endDate.value = '';
    endDate.disabled = current.checked;
    endDate.setAttribute('aria-disabled', String(current.checked));
  });
}
