import { normalizeText } from './ontology.js';

export type OutcomeSignalType = 'REJECTED' | 'INTERVIEW' | 'OFFER' | 'RECRUITER_CONTACT';
export type OutcomeSuggestedStatus = 'CONTACTED' | 'INTERVIEW' | 'OFFER' | 'CLOSED';

export interface OutcomeClassification {
  type: OutcomeSignalType;
  suggestedStatus: OutcomeSuggestedStatus;
  confidence: number;
  evidenceCodes: string[];
}

interface SignalRule {
  type: OutcomeSignalType;
  status: OutcomeSuggestedStatus;
  evidenceCode: string;
  phrases: string[];
  weight: number;
}

const RULES: SignalRule[] = [
  { type: 'REJECTED', status: 'CLOSED', evidenceCode: 'REJECTION_LANGUAGE', weight: 3, phrases: ['nie mozemy zaproponowac', 'nie zdecydowalismy sie', 'wybralismy innego', 'wybralismy inna osobe', 'nie bedziemy kontynuowac', 'nie przechodzi pan', 'nie przechodzi pani', 'not moving forward', 'we regret to inform', 'unfortunately your application'] },
  { type: 'INTERVIEW', status: 'INTERVIEW', evidenceCode: 'INTERVIEW_INVITATION', weight: 3, phrases: ['zapraszamy na rozmowe', 'rozmowa rekrutacyjna', 'spotkanie rekrutacyjne', 'zaprosic na rozmowe', 'interview invitation', 'invite you to interview', 'interview with', 'rozmowa online'] },
  { type: 'OFFER', status: 'OFFER', evidenceCode: 'OFFER_LANGUAGE', weight: 4, phrases: ['chcemy zaoferowac', 'proponujemy zatrudnienie', 'oferta zatrudnienia', 'oferta pracy dla pana', 'oferta pracy dla pani', 'job offer', 'offer of employment', 'we are pleased to offer'] },
  { type: 'RECRUITER_CONTACT', status: 'CONTACTED', evidenceCode: 'RECRUITER_CONTACT', weight: 2, phrases: ['prosze o kontakt', 'prosimy o kontakt', 'chcielibysmy porozmawiac', 'rekruter', 'recruiter', 'quick call', 'krotka rozmowa telefoniczna', 'kontakt telefoniczny'] }
];

export function classifyOutcomeMessage(message: string): OutcomeClassification | null {
  const normalized = normalizeText(message);
  if (normalized.length < 12) return null;
  const scores = new Map<OutcomeSignalType, { score: number; status: OutcomeSuggestedStatus; evidence: Set<string> }>();
  for (const rule of RULES) {
    const hits = rule.phrases.filter(phrase => normalized.includes(normalizeText(phrase))).length;
    if (!hits) continue;
    const current = scores.get(rule.type) ?? { score: 0, status: rule.status, evidence: new Set<string>() };
    current.score += rule.weight + Math.min(2, hits - 1);
    current.evidence.add(rule.evidenceCode);
    scores.set(rule.type, current);
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  if (!ranked.length) return null;
  const [topType, top] = ranked[0] as [OutcomeSignalType, { score: number; status: OutcomeSuggestedStatus; evidence: Set<string> }];
  const secondScore = ranked[1]?.[1].score ?? 0;
  if (top.score < 2 || top.score === secondScore) return null;
  const confidence = Math.min(0.95, 0.55 + top.score * 0.08 - (secondScore > 0 ? 0.1 : 0));
  return { type: topType, suggestedStatus: top.status, confidence: Number(confidence.toFixed(2)), evidenceCodes: [...top.evidence] };
}

export function outcomeTypeForSignal(type: OutcomeSignalType): 'REJECTED' | 'INTERVIEW' | 'OFFER' | 'CONTACTED' {
  return type === 'RECRUITER_CONTACT' ? 'CONTACTED' : type;
}
