import type { CareerExperience, CareerFact, CareerProfile, EducationRecord, ParsedJob, ParsedJobRequirement } from './types.js';
import { normalizeText } from './ontology.js';

export interface InterviewQuestionFramework {
  question: string;
  framework: string[];
}

export interface InterviewPack {
  companySummary: string;
  roleSummary: string;
  keyRequirements: string[];
  strongestArguments: string[];
  potentialGaps: string[];
  likelyQuestions: string[];
  answerFrameworks: InterviewQuestionFramework[];
  questionsToEmployer: string[];
  salaryPreparation: string[];
  miniTest: string[];
  checklist: string[];
  truthBoundary: string;
}

export interface InterviewPackInput {
  job: ParsedJob;
  facts: CareerFact[];
  experiences: CareerExperience[];
  education: EducationRecord[];
  profile: CareerProfile;
}

function requirementText(requirement: ParsedJobRequirement): string {
  const importance = requirement.importance === 'MUST_HAVE' ? 'wymagane' : requirement.importance === 'NICE_TO_HAVE' ? 'mile widziane' : 'znaczenie nieustalone';
  return `${requirement.canonicalRequirement} — ${importance}`;
}

function matches(value: string, requirement: string): boolean {
  const left = normalizeText(value);
  const right = normalizeText(requirement);
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

function salaryLabel(job: ParsedJob): string | null {
  const suffix = `${job.salaryPeriod === 'HOUR' ? ' / godz.' : job.salaryPeriod === 'MONTH' ? ' / mies.' : ''}${job.grossNet === 'GROSS' ? ' brutto' : job.grossNet === 'NET' ? ' netto' : ''}`;
  if (job.salaryMin !== null && job.salaryMax !== null) return `${job.salaryMin}–${job.salaryMax} PLN${suffix}`;
  if (job.salaryMin !== null) return `od ${job.salaryMin} PLN${suffix}`;
  if (job.salaryMax !== null) return `do ${job.salaryMax} PLN${suffix}`;
  return null;
}

function strongestArguments(input: InterviewPackInput): string[] {
  const confirmed = input.facts.filter(fact => fact.status === 'CONFIRMED');
  const argumentsList: string[] = [];
  for (const requirement of input.job.requirements) {
    const fact = confirmed.find(candidate => matches(candidate.value, requirement.canonicalRequirement));
    if (fact) argumentsList.push(`Potwierdzone w Career Truth: ${fact.value}${fact.level ? ` (${fact.level})` : ''} — odpowiada wymaganiu „${requirement.canonicalRequirement}”.`);
  }
  const role = input.job.normalizedTitle ?? input.job.title;
  if (role) {
    const experience = input.experiences.find(item => matches(item.normalizedTitle || item.title, role));
    if (experience) argumentsList.push(`W Career Truth masz wpisane doświadczenie: ${experience.title} w ${experience.employer}. Użyj wyłącznie prawdziwego przykładu z tej pracy.`);
  }
  if (argumentsList.length === 0) argumentsList.push('Nie mamy jeszcze potwierdzonego atutu bezpośrednio powiązanego z wymaganiami tej oferty. Nie dopowiadaj doświadczenia — przygotuj tylko fakty, które możesz obronić.');
  return argumentsList.slice(0, 5);
}

function potentialGaps(input: InterviewPackInput): string[] {
  const confirmed = input.facts.filter(fact => fact.status === 'CONFIRMED');
  const explicitlyAbsent = input.facts.filter(fact => fact.status === 'NOT_POSSESSED');
  const gaps: string[] = [];
  for (const requirement of input.job.requirements) {
    if (confirmed.some(fact => matches(fact.value, requirement.canonicalRequirement))) continue;
    const absent = explicitlyAbsent.find(fact => matches(fact.value, requirement.canonicalRequirement));
    gaps.push(absent
      ? `Career Truth oznacza jako nieposiadane: ${requirement.canonicalRequirement}. Przygotuj uczciwą odpowiedź, jak zamierzasz obejść lub uzupełnić ten brak.`
      : `Nie mamy potwierdzenia w Career Truth: ${requirement.canonicalRequirement}. To nie znaczy, że tego nie umiesz — wyjaśnij to przed rozmową.`);
  }
  if (gaps.length === 0) gaps.push('Nie wykryto niepotwierdzonych wymagań w danych, które mamy. Nadal sprawdź ofertę i nie zakładaj, że lista jest kompletna.');
  return gaps.slice(0, 6);
}

export function buildInterviewPack(input: InterviewPackInput): InterviewPack {
  const { job, profile } = input;
  const companySummary = job.company
    ? `W ofercie podano firmę: ${job.company}. Nie mamy dodatkowych zweryfikowanych informacji o firmie poza treścią zapisanej oferty.`
    : 'Nie znamy nazwy firmy ani dodatkowych zweryfikowanych informacji o pracodawcy.';
  const roleBits = [job.title ? `Stanowisko: ${job.title}.` : 'Nazwa stanowiska nie została jednoznacznie ustalona.', job.location ? `Lokalizacja: ${job.location}.` : 'Lokalizacja: nieznana.', job.contractType ? `Forma współpracy: ${job.contractType}.` : 'Forma współpracy: nieznana.', job.remoteType !== 'UNKNOWN' ? `Tryb pracy: ${job.remoteType}.` : 'Tryb pracy: nieznany.'];
  const requirements = job.requirements.map(requirementText);
  const topRequirements = job.requirements.slice(0, 5);
  const likelyQuestions = topRequirements.length
    ? topRequirements.map(requirement => `Jakie masz prawdziwe doświadczenie lub potwierdzoną wiedzę związaną z „${requirement.canonicalRequirement}”?`)
    : ['Jakie prawdziwe doświadczenia najlepiej przygotowały Cię do tej roli?', 'Które obowiązki z tej oferty są dla Ciebie najbardziej znajome, a które wymagają doprecyzowania?'];
  likelyQuestions.push('Dlaczego rozważasz właśnie tę rolę i czego oczekujesz od kolejnego kroku zawodowego?');

  const answerFrameworks = likelyQuestions.slice(0, 5).map(question => ({
    question,
    framework: [
      'Sytuacja: wybierz prawdziwy przykład z Career Truth lub własnego doświadczenia.',
      'Zadanie: opisz, za co faktycznie odpowiadałeś/aś.',
      'Działanie: powiedz konkretnie, co zrobiłeś/aś — bez dopisywania narzędzi, wyników ani odpowiedzialności.',
      'Rezultat: podaj tylko wynik, który znasz i potrafisz obronić; jeśli nie masz liczby, nie wymyślaj jej.'
    ]
  }));

  const salary = salaryLabel(job);
  const salaryPreparation = [
    salary ? `W ofercie podano wynagrodzenie: ${salary}.` : 'W zapisanej ofercie nie mamy pewnej informacji o wynagrodzeniu.',
    profile.salaryMin !== null ? `Twoje zapisane minimum w profilu: ${profile.salaryMin} PLN brutto / mies. Porównaj je z warunkami rozmowy.` : 'Nie masz zapisanego własnego minimum wynagrodzenia — ustal je przed rozmową.',
    'Przygotuj pytanie o podstawę, premię/dodatki, okres próbny oraz to, czy podana kwota jest brutto/netto i miesięczna/godzinowa, jeśli oferta tego nie rozstrzyga.'
  ];

  const questionsToEmployer = [
    'Jakie 2–3 rezultaty będą najważniejsze w pierwszych 90 dniach?',
    'Jak wygląda typowy dzień i z kim najczęściej współpracuje osoba na tym stanowisku?',
    'Jak wygląda wdrożenie i po czym poznają Państwo, że nowa osoba dobrze sobie radzi?'
  ];
  if (!salary) questionsToEmployer.push('Jaki jest budżet wynagrodzenia dla tej roli i z czego składa się całkowite wynagrodzenie?');
  if (job.workingHours === null || job.shiftPattern === null) questionsToEmployer.push('Jak dokładnie wyglądają godziny i system pracy?');

  const miniTest = topRequirements.length
    ? topRequirements.slice(0, 3).map(requirement => `Mini-test: w 2–3 zdaniach wyjaśnij, jak rozumiesz „${requirement.canonicalRequirement}” i podaj wyłącznie prawdziwy przykład użycia, jeśli go masz.`)
    : ['Mini-test: w 60 sekund opisz, które elementy Twojego Career Truth są najbardziej istotne dla tej roli.'];

  return {
    companySummary,
    roleSummary: roleBits.join(' '),
    keyRequirements: requirements.length ? requirements : ['Nie udało się wiarygodnie wyodrębnić wymagań z zapisanej oferty.'],
    strongestArguments: strongestArguments(input),
    potentialGaps: potentialGaps(input),
    likelyQuestions,
    answerFrameworks,
    questionsToEmployer,
    salaryPreparation,
    miniTest,
    checklist: [
      'Przeczytaj ponownie pełną ofertę i zaznacz rzeczy, których nie rozumiesz.',
      'Wybierz 2–3 prawdziwe przykłady z Career Truth / doświadczenia — bez tworzenia nowych historii.',
      'Przygotuj krótkie pytania do pracodawcy i własne minimum wynagrodzenia.',
      'Miej pod ręką daty, zakres obowiązków i kwalifikacje, które możesz potwierdzić.',
      'Jeśli czegoś nie wiesz, powiedz to wprost i dopytaj zamiast zgadywać.'
    ],
    truthBoundary: 'Pakiet używa wyłącznie zapisanej oferty, profilu oraz Career Truth. Nie tworzy doświadczeń ani osiągnięć, których użytkownik nie podał lub nie potwierdził.'
  };
}
