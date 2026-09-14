import { normalizeText } from './ontology.js';

export type LocalLabourConfidence = 'ZA_MALO_DANYCH' | 'WCZESNY_SYGNAL' | 'PRAWDOPODOBNY_WNIOSEK' | 'SILNY_WNIOSEK';
export type ShortageStatus = 'BIG_DEFICIT' | 'DEFICIT' | 'BALANCE' | 'SURPLUS' | 'UNKNOWN';

export interface LabourSourceEvidence {
  sourceName: 'BAROMETR_ZAWODOW' | 'GUS_BDL' | 'OTHER_OFFICIAL';
  sourceUrl: string;
  sourceLicense: string | null;
  year: number;
  updatedAt: string | null;
}

export interface LabourAreaInput {
  areaName: string;
  normalizedArea: string;
  distanceKm: number;
  shortageStatus: ShortageStatus;
  registeredUnemployed: number | null;
  offersPup: number | null;
  offersCbop: number | null;
  offersOnline: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  requiredCredentials: string[];
  observedJobs: number;
  sources: LabourSourceEvidence[];
}

export interface LabourAreaResult extends LabourAreaInput {
  confidence: LocalLabourConfidence;
  referenceOfferFlow: number | null;
  referenceOfferFlowKind: 'ONLINE' | 'CBOP' | 'PUP' | null;
  unconfirmedCredentials: string[];
  evidence: string[];
}

export interface RadiusRecommendation {
  status: 'MAY_HELP' | 'NO_STRONG_SIGNAL' | 'NOT_AVAILABLE';
  areaName: string | null;
  distanceKm: number | null;
  message: string;
}

export interface LocalLabourReport {
  role: string;
  baseArea: string;
  commuteKm: number | null;
  confidence: LocalLabourConfidence;
  currentArea: LabourAreaResult | null;
  accessibleAreas: LabourAreaResult[];
  bestArea: LabourAreaResult | null;
  plusTenKm: RadiusRecommendation;
  caveats: string[];
}

const shortageWeight: Record<ShortageStatus, number> = { BIG_DEFICIT: 4, DEFICIT: 3, BALANCE: 2, SURPLUS: 1, UNKNOWN: 0 };

function latestYear(area: LabourAreaInput): number | null {
  return area.sources.length === 0 ? null : Math.max(...area.sources.map(source => source.year));
}

export function confidenceForLabourArea(area: LabourAreaInput, currentYear = new Date().getUTCFullYear()): LocalLabourConfidence {
  const year = latestYear(area);
  if (area.sources.length === 0 || year === null) return 'ZA_MALO_DANYCH';
  if (year < currentYear - 2) return 'WCZESNY_SYGNAL';
  const hasDemandSignal = area.shortageStatus !== 'UNKNOWN';
  const hasFlowSignal = area.offersOnline !== null || area.offersCbop !== null || area.offersPup !== null;
  if (area.sources.length >= 2 && hasDemandSignal && hasFlowSignal) return 'SILNY_WNIOSEK';
  return 'PRAWDOPODOBNY_WNIOSEK';
}

function referenceOfferFlow(area: LabourAreaInput): { value: number | null; kind: 'ONLINE' | 'CBOP' | 'PUP' | null } {
  if (area.offersOnline !== null) return { value: area.offersOnline, kind: 'ONLINE' };
  if (area.offersCbop !== null) return { value: area.offersCbop, kind: 'CBOP' };
  if (area.offersPup !== null) return { value: area.offersPup, kind: 'PUP' };
  return { value: null, kind: null };
}

function compareAreaStrength(a: LabourAreaResult, b: LabourAreaResult): number {
  const shortage = shortageWeight[a.shortageStatus] - shortageWeight[b.shortageStatus];
  if (shortage !== 0) return shortage;
  const aFlow = a.referenceOfferFlow ?? -1;
  const bFlow = b.referenceOfferFlow ?? -1;
  if (aFlow !== bFlow) return aFlow - bFlow;
  return a.observedJobs - b.observedJobs;
}

function resultForArea(area: LabourAreaInput, confirmedCredentials: string[], currentYear: number): LabourAreaResult {
  const flow = referenceOfferFlow(area);
  const knownCredentials = new Set(confirmedCredentials.map(normalizeText));
  const unconfirmedCredentials = area.requiredCredentials.filter(item => !knownCredentials.has(normalizeText(item)));
  const evidence: string[] = [];
  if (area.shortageStatus !== 'UNKNOWN') evidence.push(`Status popytu/podaży: ${area.shortageStatus}.`);
  if (flow.value !== null && flow.kind) evidence.push(`Referencyjny napływ ofert (${flow.kind}): ${flow.value}.`);
  if (area.registeredUnemployed !== null) evidence.push(`Zarejestrowani bezrobotni w danych źródłowych: ${area.registeredUnemployed}.`);
  evidence.push(`Oferty widoczne w Twojej zapisanej bazie dla tego obszaru i roli: ${area.observedJobs}.`);
  return { ...area, confidence: confidenceForLabourArea(area, currentYear), referenceOfferFlow: flow.value, referenceOfferFlowKind: flow.kind, unconfirmedCredentials, evidence };
}

export function buildLocalLabourReport(input: {
  role: string; baseArea: string; commuteKm: number | null; areas: LabourAreaInput[]; confirmedCredentials: string[]; currentYear?: number;
}): LocalLabourReport {
  const currentYear = input.currentYear ?? new Date().getUTCFullYear();
  const results = input.areas.map(area => resultForArea(area, input.confirmedCredentials, currentYear));
  const baseNormalized = normalizeText(input.baseArea);
  const currentArea = results.find(area => area.normalizedArea === baseNormalized) ?? null;
  const commuteKm = input.commuteKm !== null && Number.isFinite(input.commuteKm) && input.commuteKm >= 0 ? input.commuteKm : null;
  const accessibleAreas = results
    .filter(area => area.normalizedArea === baseNormalized || (commuteKm !== null && area.distanceKm <= commuteKm))
    .sort((a, b) => compareAreaStrength(b, a) || a.distanceKm - b.distanceKm);
  const bestArea = accessibleAreas[0] ?? currentArea;

  let plusTenKm: RadiusRecommendation;
  if (commuteKm === null) {
    plusTenKm = { status: 'NOT_AVAILABLE', areaName: null, distanceKm: null, message: 'Nie znamy Twojej tolerancji dojazdu, więc nie oceniamy poszerzenia promienia o 10 km.' };
  } else {
    const extra = results.filter(area => area.distanceKm > commuteKm && area.distanceKm <= commuteKm + 10).sort((a, b) => compareAreaStrength(b, a) || a.distanceKm - b.distanceKm);
    const candidate = extra[0] ?? null;
    if (candidate && candidate.confidence !== 'ZA_MALO_DANYCH' && (!bestArea || compareAreaStrength(candidate, bestArea) > 0)) {
      plusTenKm = { status: 'MAY_HELP', areaName: candidate.areaName, distanceKm: candidate.distanceKm, message: `Poszerzenie promienia o 10 km może mieć sens: ${candidate.areaName} ma obecnie korzystniejszy sygnał z dostępnych danych.` };
    } else {
      plusTenKm = { status: 'NO_STRONG_SIGNAL', areaName: candidate?.areaName ?? null, distanceKm: candidate?.distanceKm ?? null, message: 'W dostępnych danych nie ma obecnie mocnego sygnału, że dodatkowe 10 km wyraźnie zwiększa możliwości.' };
    }
  }

  const confidence = bestArea?.confidence ?? currentArea?.confidence ?? 'ZA_MALO_DANYCH';
  return {
    role: input.role, baseArea: input.baseArea, commuteKm, confidence, currentArea, accessibleAreas, bestArea: bestArea ?? null, plusTenKm,
    caveats: [
      'Dane publiczne opisują rynek w danym obszarze i zawodzie, a nie Twoje indywidualne prawdopodobieństwo zatrudnienia.',
      'Liczba ofert w Twojej bazie obejmuje tylko oferty, które zostały zapisane w aplikacji; nie jest pełną liczbą ofert na rynku.',
      'Kanałów PUP, CBOP i Internet nie sumujemy automatycznie, ponieważ zakresy źródeł mogą się nakładać.',
      'Brak potwierdzenia kwalifikacji w profilu oznacza tylko „nie wiemy”, a nie „nie posiadasz”.'
    ]
  };
}
