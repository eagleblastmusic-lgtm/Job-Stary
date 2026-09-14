import { confidenceForSample, type ConfidenceLevel } from './bottleneckEngine.js';

export interface SkillRoiAssumption {
  skill: string;
  normalizedSkill: string;
  estimatedCost: number | null;
  estimatedHours: number | null;
  certificationRequired: boolean | null;
  certificationNote: string | null;
}

export interface SkillRoiEvidenceInput {
  skill: string;
  normalizedSkill: string;
  ontologyType: 'SKILL' | 'CREDENTIAL' | 'TOOL' | 'LANGUAGE' | 'OTHER';
  requirementCount: number;
  mustHaveCount: number;
  savedJobSample: number;
  potentiallyUnlockedJobs: number;
  localMentions: number;
  localSourceCount: number;
  salaryDifference: number | null;
  salarySample: number;
  possession: 'NOT_CONFIRMED' | 'EXPLICITLY_NOT_POSSESSED';
  assumption: SkillRoiAssumption | null;
}

export interface SkillRoiCandidate extends SkillRoiEvidenceInput {
  confidence: ConfidenceLevel;
  opportunityScore: number;
  evidence: string[];
  uncertainty: string[];
  nextStep: string;
}

export interface SkillRoiReport {
  candidates: SkillRoiCandidate[];
  savedJobSample: number;
  confidence: ConfidenceLevel;
  message: string;
}

function finite(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

export function buildSkillRoiCandidate(input: SkillRoiEvidenceInput): SkillRoiCandidate {
  const confidence = confidenceForSample(input.requirementCount);
  const evidence = [
    `W zapisanej próbce ${input.savedJobSample} ofert ta kompetencja pojawia się w ${input.requirementCount} ofertach, w tym ${input.mustHaveCount} razy jako MUST_HAVE.`,
    `Oferty, w których jest jedynym niepotwierdzonym wymaganiem MUST_HAVE: ${input.potentiallyUnlockedJobs}.`
  ];
  if (input.localMentions > 0) evidence.push(`W lokalnych oficjalnych snapshotach wymaganie pojawia się ${input.localMentions} razy (${input.localSourceCount} źródeł).`);
  if (finite(input.salaryDifference) !== null) evidence.push(`W porównywalnej zapisanej próbce ofert różnica mediany/średniego środka widełek wynosi około ${Math.round(input.salaryDifference ?? 0)} zł/mies. (${input.salarySample} ofert).`);

  const uncertainty: string[] = [];
  if (input.possession === 'NOT_CONFIRMED') uncertainty.push('Brak potwierdzenia tej kompetencji w Career Truth nie oznacza, że jej nie masz.');
  if (input.requirementCount < 5) uncertainty.push('Próbka ofert jest mała — to sygnał do dalszego zbierania danych, nie mocny wniosek.');
  if (input.localSourceCount === 0) uncertainty.push('Brak porównywalnych lokalnych danych urzędowych dla tej kompetencji.');
  if (input.salaryDifference === null) uncertainty.push('Nie ma wystarczającej porównywalnej próbki płac; nie zgadujemy premii wynagrodzenia.');
  if (!input.assumption || input.assumption.estimatedCost === null || input.assumption.estimatedHours === null) uncertainty.push('Koszt lub czas nauki nie został ustawiony przez użytkownika, więc nie wyliczamy finansowego ROI.');
  if (input.assumption?.certificationRequired === null || input.assumption?.certificationRequired === undefined) uncertainty.push('Nie potwierdzono, czy osiągnięcie kompetencji wymaga formalnej certyfikacji.');

  const costPenalty = input.assumption?.estimatedCost === null || input.assumption?.estimatedCost === undefined ? 0 : Math.min(4, input.assumption.estimatedCost / 1000);
  const timePenalty = input.assumption?.estimatedHours === null || input.assumption?.estimatedHours === undefined ? 0 : Math.min(4, input.assumption.estimatedHours / 40);
  const opportunityScore = Math.max(0,
    input.potentiallyUnlockedJobs * 5 + input.mustHaveCount * 2 + input.requirementCount + input.localMentions * 0.5 - costPenalty - timePenalty
  );
  const nextStep = input.assumption?.estimatedCost === null || input.assumption?.estimatedHours === null || !input.assumption
    ? 'Uzupełnij własny koszt i czas nauki, a potem porównaj kandydatów na tej samej próbce ofert.'
    : input.potentiallyUnlockedJobs > 0
      ? `Zweryfikuj sposób zdobycia „${input.skill}” i zacznij od jednej oferty, w której jest to jedyna niepotwierdzona luka MUST_HAVE.`
      : `Sprawdź 2–3 świeże oferty wymagające „${input.skill}” zanim zainwestujesz czas lub pieniądze.`;

  return { ...input, confidence, opportunityScore: Math.round(opportunityScore * 100) / 100, evidence, uncertainty, nextStep };
}

export function buildSkillRoiReport(inputs: SkillRoiEvidenceInput[], savedJobSample: number): SkillRoiReport {
  const candidates = inputs.map(buildSkillRoiCandidate).sort((a, b) => b.opportunityScore - a.opportunityScore || b.requirementCount - a.requirementCount || a.skill.localeCompare(b.skill, 'pl'));
  const confidence = confidenceForSample(savedJobSample);
  return {
    candidates,
    savedJobSample,
    confidence,
    message: candidates.length === 0
      ? 'Nie ma jeszcze powtarzalnych, niepotwierdzonych wymagań w zapisanych ofertach. Dodaj więcej ofert lub uzupełnij Career Truth.'
      : `Ranking opiera się na ${savedJobSample} zapisanych ofertach. Nie jest obietnicą zatrudnienia ani zwrotu finansowego.`
  };
}
