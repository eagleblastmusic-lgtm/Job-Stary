import { randomUUID } from 'node:crypto';
import { findOntologyMatches, normalizeText } from './ontology.js';
import type { CareerFact, CareerFactStatus } from './types.js';

export interface CareerFactCandidate {
  id: string;
  type: string;
  value: string;
  normalizedValue: string;
  source: string;
  status: CareerFactStatus;
  confidence: number;
  evidence: string;
  allowedForCv: boolean;
}

export function inferCareerFactsFromText(text: string, source: string): CareerFactCandidate[] {
  const matches = findOntologyMatches(text);
  return matches.map(entry => ({
    id: randomUUID(),
    type: entry.type,
    value: entry.canonical,
    normalizedValue: normalizeText(entry.canonical),
    source,
    status: 'INFERRED',
    confidence: 0.72,
    evidence: `Wykryto jawne wystąpienie: ${entry.canonical}`,
    allowedForCv: false
  }));
}

export function confirmCareerFact(fact: CareerFact): CareerFact {
  return {
    ...fact,
    status: 'CONFIRMED',
    confidence: 1,
    allowedForCv: true
  };
}

export function rejectCareerFact(fact: CareerFact): CareerFact {
  return {
    ...fact,
    status: 'NOT_POSSESSED',
    confidence: 1,
    allowedForCv: false
  };
}

export function cvEligibleFacts(facts: CareerFact[]): CareerFact[] {
  return facts.filter(fact => fact.status === 'CONFIRMED' && fact.allowedForCv);
}
