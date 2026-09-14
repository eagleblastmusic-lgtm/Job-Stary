import { cvEligibleFacts } from './careerTruth.js';
import type { ApplicationPackage, CareerExperience, CareerFact, CareerProfile, CvDocument, EducationRecord, ParsedJob } from './types.js';

export function buildCvDocument(input: {
  name: string;
  profile: CareerProfile;
  facts: CareerFact[];
  experiences: CareerExperience[];
  education: EducationRecord[];
}): CvDocument {
  const facts = cvEligibleFacts(input.facts);
  const headline = input.profile.desiredRoles.length > 0 ? input.profile.desiredRoles.join(' / ') : 'Kandydat';
  const summaryParts = [
    input.profile.location ? `Lokalizacja: ${input.profile.location}.` : null,
    facts.length > 0 ? `Potwierdzone kompetencje: ${facts.map(f => f.value).join(', ')}.` : null
  ].filter((part): part is string => Boolean(part));
  return {
    name: input.name,
    headline,
    summary: summaryParts.join(' '),
    facts,
    experiences: input.experiences,
    education: input.education,
    desiredRoles: input.profile.desiredRoles
  };
}

export function buildApplicationPackage(cv: CvDocument, job: ParsedJob): ApplicationPackage {
  const matching = cv.facts.filter(fact => job.requirements.some(req => req.canonicalRequirement.toLowerCase() === fact.value.toLowerCase()));
  const company = job.company ?? 'Państwa firmy';
  const role = job.title ?? 'wskazanego stanowiska';
  const strongest = matching.slice(0, 3).map(f => f.value);
  const evidenceSentence = strongest.length > 0
    ? `W moim profilu mam potwierdzone doświadczenie lub umiejętności związane z: ${strongest.join(', ')}.`
    : 'Chętnie opowiem, w jaki sposób moje dotychczasowe doświadczenie może wesprzeć zespół.';
  const message = `Dzień dobry,\n\nchciał(a)bym zgłosić swoją kandydaturę na stanowisko ${role} w ${company}. ${evidenceSentence}\n\nW załączeniu przesyłam CV. Chętnie odpowiem na dodatkowe pytania.\n\nPozdrawiam,\n${cv.name}`;
  const fitSummary = strongest.length > 0
    ? `Najmocniejsze potwierdzone punkty względem oferty: ${strongest.join(', ')}.`
    : 'Brak potwierdzonych wspólnych wymagań w aktualnym Career Truth — przed wysłaniem aplikacji warto uzupełnić profil.';
  return { cv, message, fitSummary };
}

export function renderCvHtml(cv: CvDocument): string {
  const escape = (value: string): string => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
  const facts = cv.facts.map(f => `<li>${escape(f.value)}${f.level ? ` — ${escape(f.level)}` : ''}</li>`).join('');
  const experiences = cv.experiences.map(exp => `<section><h3>${escape(exp.title)} — ${escape(exp.employer)}</h3><p>${escape([exp.startDate, exp.endDate ?? (exp.current ? 'obecnie' : null)].filter(Boolean).join(' – '))}</p>${exp.description ? `<p>${escape(exp.description)}</p>` : ''}</section>`).join('');
  const education = cv.education.map(ed => {
    const detail = [ed.degree, ed.field].filter(Boolean).join(' — ');
    const period = [ed.startDate, ed.endDate].filter(Boolean).join(' – ');
    return `<section><h3>${escape(ed.institution)}</h3>${detail ? `<p>${escape(detail)}</p>` : ''}${period ? `<p class="muted">${escape(period)}</p>` : ''}${ed.description ? `<p>${escape(ed.description)}</p>` : ''}</section>`;
  }).join('');
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font-family:Arial,'DejaVu Sans',sans-serif;color:#111827;line-height:1.45}h1{font-size:28px;margin:0}h2{font-size:17px;margin-top:24px;border-bottom:1px solid #d1d5db;padding-bottom:6px}h3{font-size:14px;margin-bottom:2px}p{margin:5px 0}li{margin:3px 0}.muted{color:#4b5563}</style></head><body><h1>${escape(cv.name)}</h1><p class="muted">${escape(cv.headline)}</p><p>${escape(cv.summary)}</p><h2>Kompetencje</h2><ul>${facts || '<li>Brak potwierdzonych kompetencji do CV.</li>'}</ul><h2>Doświadczenie</h2>${experiences || '<p>Brak uzupełnionego doświadczenia.</p>'}<h2>Edukacja</h2>${education || '<p>Brak uzupełnionej edukacji.</p>'}</body></html>`;
}
