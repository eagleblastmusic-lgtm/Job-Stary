export const BOTTLENECK_STAGES = ['MARKET', 'DISCOVERY', 'FIT', 'ACTION', 'RESPONSE', 'INTERVIEW', 'LATE_STAGE', 'OFFER'] as const;
export type BottleneckStage = typeof BOTTLENECK_STAGES[number];

export const CONFIDENCE_LEVELS = ['ZA_MALO_DANYCH', 'WCZESNY_SYGNAL', 'PRAWDOPODOBNY_WNIOSEK', 'SILNY_WNIOSEK'] as const;
export type ConfidenceLevel = typeof CONFIDENCE_LEVELS[number];

export interface BottleneckMetrics {
  canonicalJobs: number;
  decisionsTotal: number;
  favorableDecisions: number;
  applicationsToFavorableJobs: number;
  applicationsTotal: number;
  appliedOrBeyond: number;
  responses: number;
  interviews: number;
  offers: number;
}

export interface BottleneckDiagnosis {
  stage: BottleneckStage;
  sampleSize: number;
  confidence: ConfidenceLevel;
  rate: number | null;
  headline: string;
  evidence: string[];
  alternativeExplanations: string[];
  recommendedAction: string;
}

export interface BottleneckReport {
  primary: BottleneckDiagnosis | null;
  diagnostics: BottleneckDiagnosis[];
  overallConfidence: ConfidenceLevel;
  dataSummary: BottleneckMetrics;
  minimumSample: number;
  message: string;
}

const MIN_SAMPLE = 5;

export function confidenceForSample(sampleSize: number): ConfidenceLevel {
  if (sampleSize < MIN_SAMPLE) return 'ZA_MALO_DANYCH';
  if (sampleSize < 10) return 'WCZESNY_SYGNAL';
  if (sampleSize < 30) return 'PRAWDOPODOBNY_WNIOSEK';
  return 'SILNY_WNIOSEK';
}

function percentage(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.max(0, Math.min(1, numerator / denominator));
}

function pct(value: number | null): string {
  return value === null ? 'brak miary' : `${Math.round(value * 100)}%`;
}

interface StageDefinition {
  stage: BottleneckStage;
  numerator: number;
  denominator: number;
  threshold: number;
  headline: string;
  evidenceLabel: string;
  alternatives: string[];
  action: string;
}

function diagnosis(definition: StageDefinition): BottleneckDiagnosis {
  const rate = percentage(definition.numerator, definition.denominator);
  const confidence = confidenceForSample(definition.denominator);
  const evidence = definition.denominator > 0
    ? [`${definition.evidenceLabel}: ${definition.numerator}/${definition.denominator} (${pct(rate)}).`]
    : [`${definition.evidenceLabel}: brak wystarczających obserwacji.`];
  return {
    stage: definition.stage,
    sampleSize: definition.denominator,
    confidence,
    rate,
    headline: confidence === 'ZA_MALO_DANYCH' ? `Za mało danych, aby ocenić etap ${definition.stage}.` : definition.headline,
    evidence,
    alternativeExplanations: definition.alternatives,
    recommendedAction: confidence === 'ZA_MALO_DANYCH'
      ? 'Zbieraj kolejne prawdziwe decyzje i wyniki. Nie zmieniaj strategii na podstawie tej próbki.'
      : definition.action
  };
}

function candidateStages(metrics: BottleneckMetrics): Array<BottleneckDiagnosis & { threshold: number }> {
  const definitions: StageDefinition[] = [
    {
      stage: 'FIT', numerator: metrics.favorableDecisions, denominator: metrics.decisionsTotal, threshold: 0.4,
      headline: 'Duża część analizowanych ofert ma niskie lub niepewne dopasowanie.', evidenceLabel: 'Oferty z co najmniej rozważalną rekomendacją',
      alternatives: ['Profil lub Career Truth może być jeszcze niekompletny.', 'Ograniczenia płacowe, lokalizacyjne lub zmianowe mogą obniżać dopasowanie.', 'Próbka ofert może być zbyt wąska lub pochodzić z jednego typu źródła.'],
      action: 'Sprawdź, które wymagania i preferencje najczęściej obniżają Decision Card, zanim zmienisz docelowy zawód.'
    },
    {
      stage: 'ACTION', numerator: metrics.applicationsToFavorableJobs, denominator: metrics.favorableDecisions, threshold: 0.5,
      headline: 'Część sensownie dopasowanych ofert nie przechodzi do realnej aplikacji.', evidenceLabel: 'Aplikacje do ofert ocenionych jako warte działania',
      alternatives: ['Nie wszystkie aplikacje mogły zostać zapisane w trackerze.', 'Użytkownik mógł świadomie odrzucić ofertę po dodatkowym sprawdzeniu.', 'Przeszkodą może być czas lub przygotowanie materiałów, a nie jakość oferty.'],
      action: 'Przejrzyj zapisane, dobrze dopasowane oferty i usuń jeden konkretny punkt tarcia przed wysłaniem kolejnych aplikacji.'
    },
    {
      stage: 'RESPONSE', numerator: metrics.responses, denominator: metrics.appliedOrBeyond, threshold: 0.25,
      headline: 'Na wysłane aplikacje przychodzi mało zarejestrowanych odpowiedzi.', evidenceLabel: 'Aplikacje z odpowiedzią lub dalszym etapem',
      alternatives: ['Część pracodawców może jeszcze nie zakończyć rekrutacji.', 'Wyniki lub odpowiedzi mogły nie zostać zapisane w trackerze.', 'Znaczenie mogą mieć źródło oferty, świeżość ogłoszenia, sezon lub konkurencja, nie tylko CV.'],
      action: 'Najpierw uzupełnij brakujące wyniki i porównaj odpowiedzi według świeżości/source. Dopiero potem testuj jedną zmianę CV lub sposobu aplikowania.'
    },
    {
      stage: 'INTERVIEW', numerator: metrics.interviews, denominator: metrics.responses, threshold: 0.5,
      headline: 'Kontakty z pracodawcami rzadko przechodzą do rozmowy.', evidenceLabel: 'Odpowiedzi zakończone rozmową lub dalszym etapem',
      alternatives: ['Nie każdy kontakt rekrutera jest zaproszeniem na rozmowę.', 'Statusy mogą być nieuzupełnione.', 'Różnice między rolami i procesami firm mogą być większe niż efekt jednej cechy kandydata.'],
      action: 'Porównaj wymagania ofert, które przeszły do rozmowy, z tymi które zatrzymały się wcześniej i przygotuj brakujące informacje do pierwszego kontaktu.'
    },
    {
      stage: 'LATE_STAGE', numerator: metrics.offers, denominator: metrics.interviews, threshold: 0.3,
      headline: 'Rozmowy rzadko kończą się ofertą.', evidenceLabel: 'Rozmowy zakończone ofertą',
      alternatives: ['Próbka rozmów może obejmować różne role i poziomy trudności.', 'Nie wszystkie procesy mogły się już zakończyć.', 'Wpływ mogą mieć wynagrodzenie, dyspozycyjność, konkurencja lub dopasowanie do konkretnego zespołu.'],
      action: 'Użyj Interview Pack dla kolejnych rozmów i zapisuj wynik. Zmieniaj jedną rzecz naraz, aby później dało się ocenić efekt.'
    }
  ];
  return definitions.map(def => ({ ...diagnosis(def), threshold: def.threshold }));
}

export function buildBottleneckReport(metrics: BottleneckMetrics): BottleneckReport {
  const diagnosticsWithThreshold = candidateStages(metrics);
  const diagnostics = diagnosticsWithThreshold.map(({ threshold: _threshold, ...item }) => item);
  const eligible = diagnosticsWithThreshold.filter(item => item.confidence !== 'ZA_MALO_DANYCH' && item.rate !== null);
  const poor = eligible.filter(item => (item.rate ?? 1) < item.threshold);
  const primaryWithThreshold = poor.sort((a, b) => {
    const relativeA = (a.rate ?? 1) / a.threshold;
    const relativeB = (b.rate ?? 1) / b.threshold;
    if (relativeA !== relativeB) return relativeA - relativeB;
    return b.sampleSize - a.sampleSize;
  })[0] ?? null;
  const primary = primaryWithThreshold ? (({ threshold: _threshold, ...item }) => item)(primaryWithThreshold) : null;

  const strongestSample = Math.max(0, ...eligible.map(item => item.sampleSize));
  const overallConfidence = primary?.confidence ?? confidenceForSample(strongestSample);
  let message: string;
  if (metrics.canonicalJobs < MIN_SAMPLE || metrics.decisionsTotal < MIN_SAMPLE) {
    message = 'Za mało danych, aby wskazać główne wąskie gardło. Zbieraj kolejne oferty, decyzje, aplikacje i wyniki.';
  } else if (!primary) {
    message = 'Na obecnej próbce nie ma jednego wyraźnego wąskiego gardła. To nie jest dowód, że strategia jest optymalna — obserwuj kolejne wyniki.';
  } else {
    message = `Najsilniejszy obecny sygnał dotyczy etapu ${primary.stage}. Wniosek ma poziom pewności: ${primary.confidence}.`;
  }

  return { primary, diagnostics, overallConfidence, dataSummary: metrics, minimumSample: MIN_SAMPLE, message };
}
