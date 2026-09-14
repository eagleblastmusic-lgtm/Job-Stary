export const LEARNING_BUDGETS = [15, 30, 60, 120] as const;
export type LearningBudget = typeof LEARNING_BUDGETS[number];
export type LearningTargetKind = 'INTERVIEW' | 'MISSING_SKILL' | 'CERTIFICATION' | 'JOB_REQUIREMENT';

export interface LearningTarget {
  kind: LearningTargetKind;
  key: string;
  label: string;
  context: string;
  evidence: string[];
  unknowns: string[];
}
export interface LearningPlan {
  target: LearningTarget;
  budgetMinutes: LearningBudget;
  tasks: Array<{ minutes: number; title: string; instruction: string }>;
  boundaries: string[];
}

export function isLearningBudget(value: number): value is LearningBudget { return LEARNING_BUDGETS.includes(value as LearningBudget); }

export function buildLearningPlan(target: LearningTarget, budgetMinutes: LearningBudget): LearningPlan {
  const tasks: LearningPlan['tasks'] = [];
  if (budgetMinutes === 15) {
    tasks.push({ minutes: 5, title: 'Cel', instruction: `Przeczytaj ponownie wymaganie i własne dowody dotyczące: ${target.label}.` });
    tasks.push({ minutes: 7, title: 'Przykład', instruction: 'Przygotuj jeden prawdziwy przykład z własnego doświadczenia albo zapisz „nie mam jeszcze przykładu”.' });
    tasks.push({ minutes: 3, title: 'Sprawdzenie', instruction: 'Zapisz jedną rzecz, którą trzeba zweryfikować przed użyciem tego argumentu w aplikacji lub rozmowie.' });
  } else if (budgetMinutes === 30) {
    tasks.push({ minutes: 8, title: 'Wymaganie', instruction: `Rozbij „${target.label}” na konkretne czynności oczekiwane w tej sytuacji.` });
    tasks.push({ minutes: 12, title: 'Dowody', instruction: 'Połącz każdą czynność tylko z potwierdzonym faktem Career Truth lub oznacz lukę.' });
    tasks.push({ minutes: 10, title: 'Próba', instruction: 'Ułóż krótką odpowiedź lub demonstrację bez dopowiadania niepotwierdzonych umiejętności.' });
  } else if (budgetMinutes === 60) {
    tasks.push({ minutes: 15, title: 'Mapa wymagań', instruction: 'Wypisz wymagania celu i oddziel: potwierdzone, niepotwierdzone, wymagające sprawdzenia.' });
    tasks.push({ minutes: 20, title: 'Ćwiczenie', instruction: `Wykonaj praktyczne ćwiczenie związane z „${target.label}”, używając materiału, który sam zweryfikujesz.` });
    tasks.push({ minutes: 15, title: 'Symulacja zadania', instruction: 'Przećwicz jedno realistyczne zadanie rekrutacyjne lub zawodowe i zanotuj błędy.' });
    tasks.push({ minutes: 10, title: 'Następny krok', instruction: 'Zdecyduj, czy potrzebujesz dalszej nauki, formalnej certyfikacji czy tylko odświeżenia.' });
  } else {
    tasks.push({ minutes: 20, title: 'Zakres', instruction: `Zdefiniuj dokładnie, co w „${target.label}” jest potrzebne dla realnego celu.` });
    tasks.push({ minutes: 35, title: 'Nauka', instruction: 'Przerób zweryfikowany materiał źródłowy lub dokumentację; nie traktuj tego planu jako źródła wiedzy merytorycznej.' });
    tasks.push({ minutes: 30, title: 'Praktyka', instruction: 'Wykonaj zadanie praktyczne i porównaj wynik z wymaganiem oferty/certyfikacji.' });
    tasks.push({ minutes: 20, title: 'Próba pod presją', instruction: 'Powtórz zadanie bez podpowiedzi albo przygotuj odpowiedź rozmowy z konkretnym przykładem.' });
    tasks.push({ minutes: 15, title: 'Weryfikacja', instruction: 'Sprawdź oficjalne zasady certyfikacji lub wymagania pracodawcy, jeśli mają zastosowanie.' });
  }
  return { target, budgetMinutes, tasks, boundaries: ['Plan jest przygotowaniem do realnego celu, nie pełnym kursem.', 'Nie dopisuje kwalifikacji do Career Truth i nie potwierdza certyfikacji.', 'Fakty merytoryczne i wymagania certyfikacyjne trzeba zweryfikować w wiarygodnym źródle.'] };
}
