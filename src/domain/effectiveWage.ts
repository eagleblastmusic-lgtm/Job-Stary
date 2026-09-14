export interface EffectiveWagePreferences {
  commuteRoundTripKm: number | null;
  commuteMinutesPerDay: number | null;
  commuteDaysPerMonth: number;
  vehicleCostPerKm: number | null;
  estimatedNetRatio: number | null;
  monthlyWorkHours: number;
  subjectiveTimeValuePerHour: number | null;
}

export interface EffectiveWageInput {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: 'MONTH' | 'HOUR' | 'UNKNOWN';
  grossNet: 'GROSS' | 'NET' | 'UNKNOWN';
  workingHours: string | null;
  shiftPattern: string | null;
  nightWork: boolean | null;
  weekendWork: boolean | null;
}

export interface EffectiveWageRange {
  min: number | null;
  max: number | null;
}

export interface EffectiveWageResult {
  monthlySalaryInput: EffectiveWageRange;
  estimatedMonthlyNet: EffectiveWageRange;
  monthlyCommuteCost: number | null;
  monthlyCommuteHours: number | null;
  cashAfterCommute: EffectiveWageRange;
  cashPerWorkHourAfterCommute: EffectiveWageRange;
  subjectiveTimeCost: number | null;
  cashAfterCommuteAndSubjectiveTime: EffectiveWageRange;
  assumptions: string[];
  warnings: string[];
  shiftContext: string[];
}

function finiteNonNegative(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function mapRange(range: EffectiveWageRange, transform: (value: number) => number): EffectiveWageRange {
  return {
    min: range.min === null ? null : transform(range.min),
    max: range.max === null ? null : transform(range.max)
  };
}

function monthlySalary(input: EffectiveWageInput, monthlyHours: number): EffectiveWageRange {
  const min = finiteNonNegative(input.salaryMin);
  const max = finiteNonNegative(input.salaryMax);
  if (input.salaryPeriod === 'MONTH') return { min, max };
  if (input.salaryPeriod === 'HOUR') return {
    min: min === null ? null : min * monthlyHours,
    max: max === null ? null : max * monthlyHours
  };
  return { min: null, max: null };
}

export function calculateEffectiveWage(input: EffectiveWageInput, preferences: EffectiveWagePreferences): EffectiveWageResult {
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const shiftContext: string[] = [];
  const monthlyHours = Math.max(1, Math.min(300, preferences.monthlyWorkHours));
  const salary = monthlySalary(input, monthlyHours);
  if (input.salaryPeriod === 'HOUR' && (salary.min !== null || salary.max !== null)) assumptions.push(`Stawka godzinowa została przeliczona przy ${monthlyHours} godz. pracy miesięcznie.`);
  if (input.salaryPeriod === 'UNKNOWN') warnings.push('Nie znamy okresu wynagrodzenia, więc nie przeliczamy kwoty na miesiąc.');
  if (salary.min === null && salary.max === null) warnings.push('Oferta nie zawiera wystarczającej kwoty wynagrodzenia do obliczeń.');

  let estimatedNet: EffectiveWageRange = { min: null, max: null };
  if (input.grossNet === 'NET') {
    estimatedNet = salary;
    assumptions.push('Kwotę z oferty traktujemy jako netto, ponieważ tak oznaczono ją w zapisanej ofercie.');
  } else if (input.grossNet === 'GROSS') {
    const netRatio = preferences.estimatedNetRatio;
    if (netRatio !== null) {
      estimatedNet = mapRange(salary, value => value * netRatio);
      assumptions.push(`Szacunek netto używa ustawionego przez użytkownika współczynnika ${(netRatio * 100).toFixed(1)}% kwoty brutto.`);
      warnings.push('Współczynnik brutto→netto jest uproszczeniem użytkownika, a nie kalkulatorem podatkowym ani poradą finansową.');
    } else {
      warnings.push('Oferta podaje kwotę brutto, ale nie ustawiono współczynnika brutto→netto. Nie zgadujemy wynagrodzenia netto.');
    }
  } else {
    warnings.push('Nie wiadomo, czy wynagrodzenie jest brutto czy netto. Nie zgadujemy kwoty na rękę.');
  }

  const roundTripKm = finiteNonNegative(preferences.commuteRoundTripKm);
  const costPerKm = finiteNonNegative(preferences.vehicleCostPerKm);
  const days = Math.max(0, Math.min(31, preferences.commuteDaysPerMonth));
  const monthlyCommuteCost = roundTripKm !== null && costPerKm !== null ? roundTripKm * costPerKm * days : null;
  if (roundTripKm !== null && costPerKm !== null && monthlyCommuteCost !== null) {
    assumptions.push(`Koszt dojazdu: ${roundTripKm} km dziennie × ${costPerKm.toFixed(2)} zł/km × ${days} dni/mies.`);
  } else if (roundTripKm !== null || costPerKm !== null) {
    warnings.push('Do kosztu dojazdu potrzebne są jednocześnie kilometry w obie strony i koszt 1 km.');
  }

  const commuteMinutes = finiteNonNegative(preferences.commuteMinutesPerDay);
  const monthlyCommuteHours = commuteMinutes === null ? null : commuteMinutes * days / 60;
  if (monthlyCommuteHours !== null) assumptions.push(`Czas dojazdu: ${commuteMinutes} min dziennie × ${days} dni/mies.`);

  const cashAfterCommute = monthlyCommuteCost === null
    ? { min: null, max: null }
    : mapRange(estimatedNet, value => value - monthlyCommuteCost);
  const cashPerWorkHourAfterCommute = mapRange(cashAfterCommute, value => value / monthlyHours);

  const subjectiveRate = finiteNonNegative(preferences.subjectiveTimeValuePerHour);
  const subjectiveTimeCost = monthlyCommuteHours !== null && subjectiveRate !== null ? monthlyCommuteHours * subjectiveRate : null;
  const cashAfterCommuteAndSubjectiveTime = subjectiveTimeCost === null
    ? { min: null, max: null }
    : mapRange(cashAfterCommute, value => value - subjectiveTimeCost);
  if (subjectiveRate !== null) {
    assumptions.push(`Opcjonalna wartość czasu (${subjectiveRate.toFixed(2)} zł/h) została ustawiona przez użytkownika i nie jest obiektywną wartością ekonomiczną.`);
  }

  if (input.nightWork === true) shiftContext.push('Oferta obejmuje pracę nocną. Kalkulator nie zakłada automatycznie dodatku ani kosztu za pracę nocną.');
  if (input.weekendWork === true) shiftContext.push('Oferta obejmuje pracę weekendową. Kalkulator nie przypisuje jej automatycznej wartości dodatniej ani ujemnej.');
  if (input.shiftPattern) shiftContext.push(`Wzorzec zmian z oferty: ${input.shiftPattern}.`);
  if (input.workingHours) shiftContext.push(`Godziny/czas pracy z oferty: ${input.workingHours}.`);

  return {
    monthlySalaryInput: salary,
    estimatedMonthlyNet: estimatedNet,
    monthlyCommuteCost,
    monthlyCommuteHours,
    cashAfterCommute,
    cashPerWorkHourAfterCommute,
    subjectiveTimeCost,
    cashAfterCommuteAndSubjectiveTime,
    assumptions,
    warnings,
    shiftContext
  };
}
