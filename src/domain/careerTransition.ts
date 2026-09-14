import { confidenceForSample, type ConfidenceLevel } from './bottleneckEngine.js';
import { normalizeText } from './ontology.js';

export interface TransitionNode { role: string; aliases: string[]; adjacent: string[]; }
export const TRANSITION_GRAPH: TransitionNode[] = [
  { role:'sprzedawca', aliases:['sprzedawca','doradca klienta','sales assistant'], adjacent:['obsługa klienta','wsparcie sprzedaży'] },
  { role:'obsługa klienta', aliases:['obsługa klienta','customer service','customer support'], adjacent:['wsparcie sprzedaży','inside sales','e-commerce support'] },
  { role:'wsparcie sprzedaży', aliases:['wsparcie sprzedaży','sales support'], adjacent:['inside sales','e-commerce support'] },
  { role:'inside sales', aliases:['inside sales','sprzedaż telefoniczna'], adjacent:['e-commerce support','account support'] },
  { role:'magazynier', aliases:['magazynier','pracownik magazynu','warehouse'], adjacent:['operator magazynu','operator wózka','logistyka'] },
  { role:'operator magazynu', aliases:['operator magazynu','operator wózka','operator wózka widłowego'], adjacent:['koordynator magazynu','logistyka'] },
  { role:'logistyka', aliases:['logistyka','logistics','specjalista ds. logistyki'], adjacent:['koordynator magazynu','planowanie transportu'] },
  { role:'administracja', aliases:['administracja','pracownik biurowy','office assistant'], adjacent:['obsługa klienta','wsparcie sprzedaży','księgowość'] },
  { role:'księgowość', aliases:['księgowość','księgowy','accounting'], adjacent:['finanse','analityka finansowa'] },
  { role:'produkcja', aliases:['produkcja','pracownik produkcji','operator produkcji'], adjacent:['operator cnc','kontrola jakości','magazynier'] }
];

export function canonicalTransitionRole(value:string):string{const n=normalizeText(value);const found=TRANSITION_GRAPH.find(node=>node.aliases.some(alias=>normalizeText(alias)===n||n.includes(normalizeText(alias))));return found?.role??value.trim();}
export function adjacentRoles(value:string):string[]{const canonical=canonicalTransitionRole(value);return TRANSITION_GRAPH.find(node=>node.role===canonical)?.adjacent??[];}

export interface TransitionEvidenceInput { sourceRole:string; targetRole:string; savedJobs:number; localMentions:number; localSourceCount:number; salaryMin:number|null; salaryMax:number|null; transferableSkills:string[]; missingSkills:string[]; confirmedSkillCount:number; targetRequirementCount:number; suggestedLearning:string[]; }
export interface TransitionAssessment extends TransitionEvidenceInput { confidence:ConfidenceLevel; difficulty:'NISKA'|'UMIARKOWANA'|'WYSOKA'|'NIEZNANA'; evidence:string[]; uncertainty:string[]; }

export function buildTransitionAssessment(input:TransitionEvidenceInput):TransitionAssessment{
  const sample=input.savedJobs+input.localMentions;const confidence=confidenceForSample(sample);let difficulty:TransitionAssessment['difficulty']='NIEZNANA';if(input.targetRequirementCount>0){const ratio=input.confirmedSkillCount/input.targetRequirementCount;difficulty=ratio>=0.7?'NISKA':ratio>=0.4?'UMIARKOWANA':'WYSOKA';}
  const evidence=[`Zapisane oferty pasujące do celu „${input.targetRole}”: ${input.savedJobs}.`,`Oficjalne lokalne snapshoty z porównywalnym celem: ${input.localMentions} (${input.localSourceCount} źródeł).`,`Potwierdzone kompetencje pokrywające wymagania zapisanych ofert: ${input.confirmedSkillCount}/${input.targetRequirementCount}.`];
  if(input.salaryMin!==null||input.salaryMax!==null)evidence.push(`Obserwowane widełki w dostępnych danych: ${input.salaryMin??'—'}–${input.salaryMax??'—'} zł; kontekst brutto/netto trzeba sprawdzić w źródle.`);
  const uncertainty=['Graf przejść jest kuratorowaną mapą sąsiednich ról, nie pełną klasyfikacją wszystkich zawodów.'];if(sample<5)uncertainty.push('Próbka ofert/rynku jest mała, więc trudność i popyt mają niski poziom pewności.');if(input.targetRequirementCount===0)uncertainty.push('Brak zapisanych wymagań celu — trudność pozostaje nieznana.');if(input.salaryMin===null&&input.salaryMax===null)uncertainty.push('Brak porównywalnych danych płacowych dla tego celu.');
  return{...input,confidence,difficulty,evidence,uncertainty};
}
