import { confidenceForSample, type ConfidenceLevel } from './bottleneckEngine.js';

export interface StrategySegment { label: string; sampleSize: number; progressed: number; }
export interface StrategyRadiusSignal { areaName: string; distanceKm: number; confidence: ConfidenceLevel; message: string; }
export interface StrategySkillSignal { skill: string; requirementCount: number; potentiallyUnlockedJobs: number; confidence: ConfidenceLevel; nextStep: string; }
export interface StrategyInput {
  applications: number;
  responses: number;
  interviews: number;
  offers: number;
  roles: StrategySegment[];
  contracts: StrategySegment[];
  fresh: StrategySegment | null;
  older: StrategySegment | null;
  radius: StrategyRadiusSignal | null;
  skill: StrategySkillSignal | null;
}
export type StrategyRecommendationKind = 'ROLE_FOCUS'|'CONTRACT_FOCUS'|'FRESHNESS'|'EXPAND_RADIUS'|'LEARN_SKILL'|'FIT_EXPERIMENT';
export interface StrategyRecommendation {
  key: string;
  kind: StrategyRecommendationKind;
  headline: string;
  reason: string;
  action: string;
  confidence: ConfidenceLevel;
  sampleSize: number;
  scope: 'EXPERIMENT'|'FOCUS';
  evidence: string[];
  caveats: string[];
}
export interface StrategyReport {
  activated: boolean;
  recommendations: StrategyRecommendation[];
  confidence: ConfidenceLevel;
  message: string;
  minimumApplications: number;
  dataSummary: { applications: number; responses: number; interviews: number; offers: number };
}

const MIN_APPLICATIONS = 10;
const MIN_SEGMENT = 5;
const rate = (segment: StrategySegment): number => segment.sampleSize > 0 ? segment.progressed / segment.sampleSize : 0;
const pct = (value: number): string => `${Math.round(value * 100)}%`;
const scopeFor = (sample: number): 'EXPERIMENT'|'FOCUS' => sample >= 30 ? 'FOCUS' : 'EXPERIMENT';
const usable = (level: ConfidenceLevel): boolean => level !== 'ZA_MALO_DANYCH';

function segmentRecommendation(kind:'ROLE_FOCUS'|'CONTRACT_FOCUS', segments:StrategySegment[]):StrategyRecommendation|null {
  const eligible = segments.filter(item => item.sampleSize >= MIN_SEGMENT).sort((a,b)=>rate(b)-rate(a) || b.sampleSize-a.sampleSize);
  if (eligible.length < 2) return null;
  const best = eligible[0]!, worst = eligible[eligible.length-1]!;
  const difference = rate(best)-rate(worst), sample = best.sampleSize+worst.sampleSize;
  if (difference < 0.2) return null;
  const confidence = confidenceForSample(sample);
  const noun = kind === 'ROLE_FOCUS' ? 'roli' : 'typu umowy';
  return {
    key:`${kind}:${best.label}:${worst.label}`,
    kind,
    headline:`Przetestuj większy udział ${noun} „${best.label}”.`,
    reason:`W Twojej własnej historii progresja wyniosła ${best.progressed}/${best.sampleSize} (${pct(rate(best))}) dla „${best.label}” i ${worst.progressed}/${worst.sampleSize} (${pct(rate(worst))}) dla „${worst.label}”.`,
    action:`Przez kolejnych 5 aplikacji zwiększ udział „${best.label}”, ale nie wykluczaj automatycznie „${worst.label}”; potem porównaj wynik.`,
    confidence,
    sampleSize:sample,
    scope:scopeFor(sample),
    evidence:[`Porównanie obejmuje wyłącznie Twoje zapisane aplikacje: ${sample} obserwacji w dwóch segmentach.`,`Różnica obserwowanej progresji: ${Math.round(difference*100)} p.p.`],
    caveats:['To korelacja w Twojej historii, nie dowód że wybrana rola lub umowa powoduje lepszy wynik.','Każdy porównywany segment musi mieć co najmniej 5 aplikacji.']
  };
}

export function buildStrategyReport(input: StrategyInput): StrategyReport {
  const confidence = confidenceForSample(input.applications);
  const dataSummary = { applications: input.applications, responses: input.responses, interviews: input.interviews, offers: input.offers };
  if (input.applications < MIN_APPLICATIONS) return { activated:false, recommendations:[], confidence, message:`Masz ${input.applications} aplikacji po wysłaniu. Strategy Engine potrzebuje co najmniej ${MIN_APPLICATIONS}, aby proponować zmianę strategii.`, minimumApplications:MIN_APPLICATIONS, dataSummary };

  const candidates: StrategyRecommendation[] = [];
  const role = segmentRecommendation('ROLE_FOCUS', input.roles); if (role) candidates.push(role);
  const contract = segmentRecommendation('CONTRACT_FOCUS', input.contracts); if (contract) candidates.push(contract);
  if (input.fresh && input.older && input.fresh.sampleSize >= MIN_SEGMENT && input.older.sampleSize >= MIN_SEGMENT) {
    const difference = rate(input.fresh)-rate(input.older), sample=input.fresh.sampleSize+input.older.sampleSize;
    if (difference >= 0.15) candidates.push({ key:'FRESHNESS:7D', kind:'FRESHNESS', headline:'Priorytetyzuj świeże oferty jako kontrolowany eksperyment.', reason:`Progresja dla aplikacji do ofert ≤7 dni: ${input.fresh.progressed}/${input.fresh.sampleSize} (${pct(rate(input.fresh))}); dla starszych: ${input.older.progressed}/${input.older.sampleSize} (${pct(rate(input.older))}).`, action:'Przez następnych 5 aplikacji wybieraj najpierw oferty opublikowane w ostatnich 7 dniach i porównaj wyniki.', confidence:confidenceForSample(sample), sampleSize:sample, scope:scopeFor(sample), evidence:[`Różnica obserwowanej progresji: ${Math.round(difference*100)} p.p.`], caveats:['Daty publikacji muszą być poprawnie dostępne w zapisanych ofertach.','Świeżość może współwystępować z innymi cechami oferty; nie przypisujemy jej automatycznie przyczynowości.'] });
  }
  if (input.radius && usable(input.radius.confidence)) candidates.push({ key:`EXPAND_RADIUS:${input.radius.areaName}`, kind:'EXPAND_RADIUS', headline:`Sprawdź oferty w rejonie ${input.radius.areaName}.`, reason:input.radius.message, action:`Dodaj kilka ofert z obszaru ${input.radius.areaName} (ok. ${Math.round(input.radius.distanceKm)} km) i porównaj ich dopasowanie oraz warunki przed zmianą stałego promienia.`, confidence:input.radius.confidence, sampleSize:input.applications, scope:'EXPERIMENT', evidence:['Rekomendacja pochodzi z Local Labour Intelligence i wymaga źródłowego połączenia obszarów oraz realnego sygnału rynku.'], caveats:['Nie zakładamy, że większy promień jest opłacalny — uwzględnij koszt i czas dojazdu w Effective Wage.'] });
  if (input.skill && usable(input.skill.confidence) && input.skill.requirementCount >= MIN_SEGMENT && input.skill.potentiallyUnlockedJobs > 0) candidates.push({ key:`LEARN_SKILL:${input.skill.skill}`, kind:'LEARN_SKILL', headline:`Zweryfikuj opłacalność nauki „${input.skill.skill}”.`, reason:`W zapisanej próbce kompetencja pojawia się w ${input.skill.requirementCount} ofertach i jest jedyną niepotwierdzoną luką MUST_HAVE w ${input.skill.potentiallyUnlockedJobs}.`, action:input.skill.nextStep, confidence:input.skill.confidence, sampleSize:input.skill.requirementCount, scope:'EXPERIMENT', evidence:['Sygnał pochodzi z Skill ROI i zapisanych wymagań ofert.'], caveats:['Brak potwierdzenia kompetencji nie oznacza, że jej nie posiadasz.','To nie jest obietnica zatrudnienia ani finansowego zwrotu z nauki.'] });

  const responseRate = input.applications ? input.responses/input.applications : 0;
  if (!candidates.length && responseRate < 0.2) candidates.push({ key:'FIT_EXPERIMENT', kind:'FIT_EXPERIMENT', headline:'Zrób mały eksperyment z bardziej selektywnym wyborem ofert.', reason:`Odpowiedź pojawiła się w ${input.responses}/${input.applications} wysłanych aplikacji (${pct(responseRate)}). Sam ten wynik nie wskazuje jednej przyczyny.`, action:'W kolejnych 5 aplikacjach wybieraj tylko oferty z wysokim dopasowaniem do potwierdzonego Career Truth i zapisuj wynik.', confidence, sampleSize:input.applications, scope:'EXPERIMENT', evidence:['Wniosek wykorzystuje wyłącznie Twoją historię aplikacji.'], caveats:['Niska odpowiedź może wynikać m.in. z rynku, momentu aplikacji, konkurencji lub sposobu prezentacji — nie zakładamy jednej przyczyny.'] });

  const recommendations = candidates.sort((a,b)=>b.sampleSize-a.sampleSize).slice(0,3);
  return { activated:true, recommendations, confidence, message:recommendations.length?'Rekomendacje są hipotezami do małych, mierzalnych eksperymentów. Nie są pewnymi decyzjami zawodowymi.':'Na obecnych danych nie ma wystarczająco wyraźnego sygnału, by zmieniać strategię.', minimumApplications:MIN_APPLICATIONS, dataSummary };
}
