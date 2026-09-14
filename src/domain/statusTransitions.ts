import type { ApplicationStatus } from './types.js';

const ALLOWED: Record<ApplicationStatus, ApplicationStatus[]> = {
  SAVED: ['APPLIED', 'CLOSED'],
  APPLIED: ['CONTACTED', 'INTERVIEW', 'OFFER', 'CLOSED'],
  CONTACTED: ['INTERVIEW', 'OFFER', 'CLOSED'],
  INTERVIEW: ['OFFER', 'CLOSED'],
  OFFER: ['CLOSED'],
  CLOSED: ['SAVED']
};

export function canTransitionApplication(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return from === to || ALLOWED[from].includes(to);
}

export function assertApplicationTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (!canTransitionApplication(from, to)) throw new Error(`Niedozwolona zmiana statusu: ${from} → ${to}`);
}
