import { normalizeText } from './ontology.js';
import type { CareerFact, CareerProfile, JobDecisionResult, ParsedJob, ParsedJobRequirement } from './types.js';

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

function requirementState(requirement: ParsedJobRequirement, facts: CareerFact[]): 'MATCH' | 'MISSING' | 'UNKNOWN' {
  const normalized = normalizeText(requirement.canonicalRequirement);
  const candidates = facts.filter(fact => fact.normalizedValue === normalized || normalizeText(fact.value) === normalized);
  if (candidates.some(fact => fact.status === 'CONFIRMED')) return 'MATCH';
  if (candidates.some(fact => fact.status === 'NOT_POSSESSED' || fact.status === 'EXPIRED')) return 'MISSING';
  return 'UNKNOWN';
}

function requirementFit(job: ParsedJob, facts: CareerFact[]): { score: number; uncertainty: number; why: string[]; unknown: string[]; missing: string[] } {
  if (job.requirements.length === 0) {
    return { score: 0.5, uncertainty: 1, why: [], unknown: ['Oferta nie zawiera wymagań, które potrafimy pewnie znormalizować.'], missing: [] };
  }
  let weightedTotal = 0;
  let weightedMatch = 0;
  let unknownWeight = 0;
  const why: string[] = [];
  const unknown: string[] = [];
  const missing: string[] = [];
  for (const requirement of job.requirements) {
    const weight = requirement.importance === 'MUST_HAVE' ? 2 : requirement.importance === 'NICE_TO_HAVE' ? 0.7 : 1;
    const state = requirementState(requirement, facts);
    weightedTotal += weight;
    if (state === 'MATCH') {
      weightedMatch += weight;
      why.push(`Masz potwierdzone: ${requirement.canonicalRequirement}.`);
    } else if (state === 'MISSING') {
      missing.push(`${requirement.canonicalRequirement}${requirement.importance === 'MUST_HAVE' ? ' — wymaganie obowiązkowe.' : '.'}`);
    } else {
      unknownWeight += weight;
      unknown.push(`Nie mamy potwierdzenia: ${requirement.canonicalRequirement}.`);
    }
  }
  const score = weightedTotal === 0 ? 0.5 : weightedMatch / weightedTotal;
  return { score: clamp(score), uncertainty: clamp(unknownWeight / Math.max(weightedTotal, 1)), why, unknown, missing };
}

function salaryFit(profile: CareerProfile, job: ParsedJob): { score: number; message?: string } {
  const mode = profile.salaryMode ?? 'EXCLUDE_LOWER';
  const minRequired = profile.salaryMin;

  if (mode === 'DISCLOSED_ONLY') {
    if (!job.salaryMin && !job.salaryMax) {
      return { score: 0.2, message: 'Oferta nie podaje stawek wynagrodzenia, a wybrano opcję wyświetlania ofert tylko z podaną płacą.' };
    }
    if (minRequired && job.salaryMax && job.salaryMax < minRequired) {
      return { score: 0.2, message: `Maksymalne wynagrodzenie ${job.salaryMax} zł jest niższe od Twojego minimum ${minRequired} zł.` };
    }
    if (minRequired && (job.salaryMin ?? job.salaryMax ?? 0) >= minRequired) {
      return { score: 1, message: 'Wynagrodzenie mieści się w Twoich oczekiwaniach.' };
    }
    if (minRequired) {
      return { score: 0.7, message: 'Zakres wynagrodzenia częściowo pokrywa się z Twoimi oczekiwaniami.' };
    }
    return { score: 1, message: 'Oferta podaje stawkę wynagrodzenia.' };
  }

  if (!minRequired || !job.salaryMax) return { score: 0.6 };
  if (job.salaryMax < minRequired) return { score: 0.2, message: `Maksymalne wynagrodzenie ${job.salaryMax} zł jest niższe od Twojego minimum ${minRequired} zł.` };
  if ((job.salaryMin ?? job.salaryMax) >= minRequired) return { score: 1, message: 'Wynagrodzenie mieści się w Twoich oczekiwaniach.' };
  return { score: 0.7, message: 'Zakres wynagrodzenia częściowo pokrywa się z Twoimi oczekiwaniami.' };
}

function preferenceFit(profile: CareerProfile, job: ParsedJob): { score: number; hard: string[]; why: string[] } {
  let score = 1;
  const hard: string[] = [];
  const why: string[] = [];

  if (job.nightWork === true && profile.shiftPreferences.nights === false) {
    score -= 0.45;
    hard.push('Oferta wymaga pracy nocnej, a w profilu zaznaczono brak zgody na noce.');
  }
  if (job.weekendWork === true && profile.shiftPreferences.weekends === false) {
    score -= 0.25;
    hard.push('Oferta obejmuje weekendy, a w profilu zaznaczono brak zgody na weekendy.');
  }
  if (job.contractType && profile.contractPreferences.length > 0 && !profile.contractPreferences.includes(job.contractType)) {
    score -= 0.35;
    hard.push(`Typ umowy ${job.contractType} nie jest na liście akceptowanych form zatrudnienia.`);
  } else if (job.contractType && profile.contractPreferences.includes(job.contractType)) {
    why.push(`Forma zatrudnienia ${job.contractType} jest zgodna z Twoją preferencją.`);
  }
  if (job.remoteType !== 'UNKNOWN' && profile.remotePreferences.length > 0) {
    if (profile.remotePreferences.includes(job.remoteType)) why.push(`Tryb pracy ${job.remoteType} odpowiada Twojej preferencji.`);
    else score -= 0.15;
  }

  return { score: clamp(score), hard, why };
}

function recommendationFrom(score: number, hardCount: number, uncertainty: number): JobDecisionResult['recommendation'] {
  const adjusted = score - hardCount * 0.08 - uncertainty * 0.08;
  if (adjusted >= 0.82) return 'APPLY_NOW';
  if (adjusted >= 0.66) return 'APPLY';
  if (adjusted >= 0.48) return 'CONSIDER';
  if (adjusted >= 0.32) return 'PROBABLY_SKIP';
  return 'LOW_FIT';
}

const LABELS: Record<JobDecisionResult['recommendation'], string> = {
  APPLY_NOW: 'Ta oferta wygląda na bardzo dobry kandydat do szybkiej aplikacji.',
  APPLY: 'Warto aplikować.',
  CONSIDER: 'Warto rozważyć aplikację po sprawdzeniu kilku niepewności.',
  PROBABLY_SKIP: 'Raczej nie jest to najlepszy cel, ale decyzja należy do Ciebie.',
  LOW_FIT: 'Dopasowanie jest niskie. Możesz aplikować mimo to, jeśli masz dodatkowy powód.'
};

export function decideJob(profile: CareerProfile, facts: CareerFact[], job: ParsedJob): JobDecisionResult {
  const req = requirementFit(job, facts);
  const preferences = preferenceFit(profile, job);
  const salary = salaryFit(profile, job);
  const capabilityFit = req.score;
  const requirementScore = req.score;
  const preferenceScore = preferences.score;
  const contractFit = job.contractType && profile.contractPreferences.length > 0
    ? (profile.contractPreferences.includes(job.contractType) ? 1 : 0.2)
    : 0.6;
  const freshness = job.publishedAt ? 0.9 : 0.6;
  const commuteFit = job.remoteType === 'REMOTE' ? 1 : 0.6;
  const weighted = capabilityFit * 0.34 + requirementScore * 0.22 + preferenceScore * 0.16 + salary.score * 0.12 + contractFit * 0.08 + commuteFit * 0.04 + freshness * 0.04;
  const recommendation = recommendationFrom(weighted, preferences.hard.length, req.uncertainty);

  const why = [...req.why, ...preferences.why];
  if (salary.message && salary.score >= 0.6) why.push(salary.message);
  const missing = [...req.missing];
  if (salary.message && salary.score < 0.6) missing.push(salary.message);

  return {
    recommendation,
    dimensions: {
      capabilityFit,
      requirementFit: requirementScore,
      preferenceFit: preferenceScore,
      salaryFit: salary.score,
      commuteFit,
      contractFit,
      freshness,
      uncertainty: req.uncertainty
    },
    explanation: {
      why,
      unknown: req.unknown,
      missing,
      hardConstraints: preferences.hard,
      conclusion: LABELS[recommendation]
    },
    modelVersion: 'decision-engine-v1.0.0'
  };
}
