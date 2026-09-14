export type TodayActionType =
  | 'APPLY'
  | 'PREPARE_CV'
  | 'FOLLOW_UP'
  | 'UPDATE_OUTCOME'
  | 'PREPARE_INTERVIEW'
  | 'CONFIRM_CAREER_FACT'
  | 'LEARN';

export interface ActionCandidate {
  key: string;
  type: TodayActionType;
  title: string;
  reason: string;
  estimatedMinutes: number;
  opportunityValue: number;
  urgency: number;
  confidence: number;
  expectedProgress: number;
  payload: Record<string, unknown>;
}

export interface RankedAction extends ActionCandidate {
  priorityScore: number;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function scoreAction(candidate: ActionCandidate): number {
  const opportunityValue = finitePositive(candidate.opportunityValue, 0.01);
  const urgency = finitePositive(candidate.urgency, 0.01);
  const confidence = finitePositive(candidate.confidence, 0.01);
  const expectedProgress = finitePositive(candidate.expectedProgress, 0.01);
  const effortUnits = Math.max(finitePositive(candidate.estimatedMinutes, 1) / 10, 0.5);
  return opportunityValue * urgency * confidence * expectedProgress / effortUnits;
}

export function rankActions(candidates: ActionCandidate[], timeBudgetMinutes: number, maxActions = 3): RankedAction[] {
  const budget = Math.max(1, Math.floor(timeBudgetMinutes));
  const limit = Math.max(1, Math.min(3, Math.floor(maxActions)));
  const ranked = candidates
    .filter(candidate => candidate.estimatedMinutes > 0 && candidate.estimatedMinutes <= budget)
    .map(candidate => ({ ...candidate, priorityScore: scoreAction(candidate) }))
    .sort((left, right) => right.priorityScore - left.priorityScore || left.key.localeCompare(right.key));

  const selected: RankedAction[] = [];
  let remaining = budget;
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (candidate.estimatedMinutes > remaining) continue;
    selected.push(candidate);
    remaining -= candidate.estimatedMinutes;
  }
  return selected;
}
