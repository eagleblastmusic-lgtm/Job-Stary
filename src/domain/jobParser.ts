import { createHash } from 'node:crypto';
import { findOntologyMatches, normalizeText } from './ontology.js';
import type { ParsedJob, ParsedJobRequirement, RequirementImportance } from './types.js';

function firstCapture(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

function detectSalary(text: string): Pick<ParsedJob, 'salaryMin' | 'salaryMax' | 'salaryPeriod' | 'grossNet'> {
  const compact = text.replace(/\u00a0/g, ' ');
  const range = compact.match(/(\d{1,3}(?:[ .]\d{3})?|\d{3,5})\s*(?:-|–|do)\s*(\d{1,3}(?:[ .]\d{3})?|\d{3,5})\s*(?:zł|pln)/i);
  const single = compact.match(/(?:od\s*)?(\d{1,3}(?:[ .]\d{3})?|\d{3,5})\s*(?:zł|pln)/i);
  const parseMoney = (value: string | undefined): number | null => value ? Number(value.replace(/[ .]/g, '')) : null;
  const salaryMin = range ? parseMoney(range[1]) : parseMoney(single?.[1]);
  const salaryMax = range ? parseMoney(range[2]) : salaryMin;
  const normalized = normalizeText(text);
  const salaryPeriod = /godz|hour/.test(normalized) ? 'HOUR' : salaryMin ? 'MONTH' : 'UNKNOWN';
  const grossNet = /netto|net\b/.test(normalized) ? 'NET' : /brutto|gross/.test(normalized) ? 'GROSS' : 'UNKNOWN';
  return { salaryMin, salaryMax, salaryPeriod, grossNet };
}

function sectionImportance(text: string, canonical: string): RequirementImportance {
  const normalized = normalizeText(text);
  const needle = normalizeText(canonical);
  const index = normalized.indexOf(needle);
  if (index < 0) return 'UNKNOWN';
  const context = normalized.slice(Math.max(0, index - 240), Math.min(normalized.length, index + 240));
  if (/mile widziane|atutem|dodatkowym atutem|nice to have/.test(context)) return 'NICE_TO_HAVE';
  if (/wymag|must have|konieczne|niezbedne|warunek/.test(context)) return 'MUST_HAVE';
  return 'UNKNOWN';
}

function parseRequirements(text: string): ParsedJobRequirement[] {
  const matches = findOntologyMatches(text);
  return matches.map(entry => ({
    type: entry.type,
    canonicalRequirement: entry.canonical,
    importance: sectionImportance(text, entry.canonical),
    confidence: 0.82,
    provenance: `Wykryto w treści oferty: ${entry.canonical}`
  }));
}

function dateToIso(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (!match) return null;
  const day = match[1]?.padStart(2, '0');
  const month = match[2]?.padStart(2, '0');
  const year = match[3];
  return day && month && year ? `${year}-${month}-${day}` : null;
}

export function parseJobText(rawText: string): ParsedJob {
  const text = rawText.trim();
  if (text.length < 20) throw new Error('Treść oferty jest zbyt krótka do analizy.');
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const title = firstCapture(text, [
    /(?:stanowisko|pozycja|job title)\s*[:\-]\s*([^\n]+)/i,
    /(?:szukamy|poszukujemy)\s+(?:osoby\s+na\s+stanowisko\s+)?([^\n,.]{3,80})/i
  ]) ?? lines[0]?.slice(0, 120) ?? null;
  const company = firstCapture(text, [/(?:firma|pracodawca|company)\s*[:\-]\s*([^\n]+)/i]);
  const location = firstCapture(text, [/(?:miejsce pracy|lokalizacja|location)\s*[:\-]\s*([^\n]+)/i]);
  const normalized = normalizeText(text);
  const remoteType = /hybryd/.test(normalized) ? 'HYBRID' : /zdaln|remote/.test(normalized) ? 'REMOTE' : /stacjonarn|on site|onsite/.test(normalized) ? 'ONSITE' : 'UNKNOWN';
  const contractType = /umowa o prace|uop/.test(normalized) ? 'UOP'
    : /b2b/.test(normalized) ? 'B2B'
      : /zlecen/.test(normalized) ? 'UZ'
        : /dzielo/.test(normalized) ? 'UDZIELO'
          : null;
  const salary = detectSalary(text);
  const nightWork = /nocn|nocki|night shift/.test(normalized) ? true : null;
  const weekendWork = /weekend|sobot|niedziel/.test(normalized) ? true : null;
  const travelRequired = /delegac|podroze sluzbowe|travel required/.test(normalized) ? true : null;
  const workingHours = firstCapture(text, [/(?:godziny pracy|working hours)\s*[:\-]\s*([^\n]+)/i]);
  const shiftPattern = firstCapture(text, [/(?:system zmianowy|zmiany|shift)\s*[:\-]\s*([^\n]+)/i]);
  const applicationMethod = firstCapture(text, [/(?:aplikuj|kontakt|application)\s*[:\-]\s*([^\n]+)/i]);
  const deadline = dateToIso(firstCapture(text, [/(?:termin aplikacji|deadline|aplikuj do)\s*[:\-]?\s*([^\n]+)/i]));
  const publishedAt = dateToIso(firstCapture(text, [/(?:opublikowano|data publikacji|published)\s*[:\-]?\s*([^\n]+)/i]));
  const fingerprint = createHash('sha256').update(normalizeText(text)).digest('hex');

  return {
    title,
    normalizedTitle: title ? normalizeText(title) : null,
    company,
    location,
    remoteType,
    contractType,
    ...salary,
    workingHours,
    shiftPattern,
    nightWork,
    weekendWork,
    travelRequired,
    applicationMethod,
    deadline,
    publishedAt,
    requirements: parseRequirements(text),
    fingerprint
  };
}
