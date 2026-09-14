import { randomUUID } from 'node:crypto';
import type { JobDatabase } from './db.js';
import { rankActions, type ActionCandidate, type TodayActionType } from '../domain/actionPriority.js';

interface ApplicationCandidateRow {
  application_id: string;
  job_id: string;
  status: string;
  applied_at: string | null;
  updated_at: string;
  title: string | null;
  company: string | null;
  deadline: string | null;
  recommendation: string | null;
  uncertainty: number | null;
  outcome_count: number;
}

interface FactCandidateRow {
  id: string;
  type: string;
  value: string;
  confidence: number;
}

interface DailyActionRow {
  id: string;
  action_type: TodayActionType;
  payload: string;
  estimated_minutes: number;
  accepted: number;
  completed: number;
  outcome: string | null;
  created_at: string;
  action_key: string | null;
  priority_score: number | null;
  recommended_for: string | null;
  updated_at: string | null;
}

export interface TodayActionRecord {
  id: string;
  key: string;
  type: TodayActionType;
  title: string;
  reason: string;
  estimatedMinutes: number;
  priorityScore: number;
  accepted: boolean;
  completed: boolean;
  outcome: string | null;
  recommendedFor: string;
  payload: Record<string, unknown>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function daysSince(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, (Date.now() - timestamp) / 86_400_000);
}

function deadlineUrgency(value: string | null): number {
  if (!value) return 1;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 1;
  const days = (timestamp - Date.now()) / 86_400_000;
  if (days < 0) return 0.5;
  if (days <= 1) return 1.5;
  if (days <= 3) return 1.25;
  if (days <= 7) return 1.1;
  return 1;
}

function opportunityValue(recommendation: string | null): number {
  return ({ APPLY_NOW: 1, APPLY: 0.9, CONSIDER: 0.65, PROBABLY_SKIP: 0.3, LOW_FIT: 0.2 } as Record<string, number>)[recommendation ?? ''] ?? 0.55;
}

function decisionConfidence(uncertainty: number | null): number {
  if (uncertainty === null || !Number.isFinite(uncertainty)) return 0.6;
  return clamp(1 - uncertainty, 0.25, 1);
}

function localDate(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function rowToRecord(row: DailyActionRow): TodayActionRecord {
  const decoded = JSON.parse(row.payload) as Record<string, unknown>;
  const title = typeof decoded.title === 'string' ? decoded.title : row.action_type;
  const reason = typeof decoded.reason === 'string' ? decoded.reason : '';
  const { title: _title, reason: _reason, ...payload } = decoded;
  return {
    id: row.id,
    key: row.action_key ?? row.id,
    type: row.action_type,
    title,
    reason,
    estimatedMinutes: row.estimated_minutes,
    priorityScore: row.priority_score ?? 0,
    accepted: row.accepted === 1,
    completed: row.completed === 1,
    outcome: row.outcome,
    recommendedFor: row.recommended_for ?? row.created_at.slice(0, 10),
    payload
  };
}

export class TodayService {
  constructor(private readonly database: JobDatabase) {}

  private applicationCandidates(userId: string): ApplicationCandidateRow[] {
    return this.database.db.prepare(`
      SELECT a.id application_id,a.job_id,a.status,a.applied_at,a.updated_at,j.title,j.company,j.deadline,
        (SELECT d.recommendation FROM job_decisions d WHERE d.user_id=a.user_id AND d.job_id=a.job_id ORDER BY d.created_at DESC LIMIT 1) recommendation,
        (SELECT d.uncertainty FROM job_decisions d WHERE d.user_id=a.user_id AND d.job_id=a.job_id ORDER BY d.created_at DESC LIMIT 1) uncertainty,
        (SELECT COUNT(*) FROM outcomes o WHERE o.application_id=a.id) outcome_count
      FROM applications a JOIN jobs j ON j.id=a.job_id
      WHERE a.user_id=? AND a.status<>'CLOSED'
      ORDER BY a.updated_at DESC
    `).all(userId) as unknown as ApplicationCandidateRow[];
  }

  private inferredFacts(userId: string): FactCandidateRow[] {
    return this.database.db.prepare(`
      SELECT id,type,value,confidence FROM career_facts
      WHERE user_id=? AND status='INFERRED'
      ORDER BY confidence DESC,created_at DESC LIMIT 5
    `).all(userId) as unknown as FactCandidateRow[];
  }

  buildCandidates(userId: string): ActionCandidate[] {
    const candidates: ActionCandidate[] = [];
    for (const application of this.applicationCandidates(userId)) {
      const target = application.title ?? 'oferta pracy';
      const company = application.company ? ` — ${application.company}` : '';
      const opportunity = opportunityValue(application.recommendation);
      const confidence = decisionConfidence(application.uncertainty);

      if (application.status === 'SAVED') {
        candidates.push({
          key: `apply:${application.application_id}`,
          type: 'APPLY',
          title: `Wyślij aplikację: ${target}`,
          reason: `Oferta jest już zapisana${company}. Jeśli nadal ją rozważasz, przejdź do wysłania aplikacji.`,
          estimatedMinutes: 15,
          opportunityValue: opportunity,
          urgency: deadlineUrgency(application.deadline),
          confidence,
          expectedProgress: 1,
          payload: { applicationId: application.application_id, jobId: application.job_id }
        });
      }

      if (application.status === 'APPLIED' && Number(application.outcome_count) === 0) {
        const age = daysSince(application.applied_at ?? application.updated_at);
        if (age >= 7) {
          candidates.push({
            key: `follow-up:${application.application_id}`,
            type: 'FOLLOW_UP',
            title: `Sprawdź status: ${target}`,
            reason: `Od aplikacji minęło około ${Math.floor(age)} dni. Krótki follow-up może zamknąć pętlę zamiast czekać bez informacji.`,
            estimatedMinutes: 10,
            opportunityValue: Math.max(opportunity, 0.7),
            urgency: clamp(1 + age / 30, 1.1, 1.5),
            confidence: 0.9,
            expectedProgress: 0.65,
            payload: { applicationId: application.application_id, jobId: application.job_id }
          });
        }
      }

      if (application.status === 'CONTACTED' || application.status === 'OFFER') {
        candidates.push({
          key: `outcome:${application.application_id}`,
          type: 'UPDATE_OUTCOME',
          title: `Zaktualizuj wynik: ${target}`,
          reason: 'Masz nowy etap rekrutacji. Aktualny wynik pozwala systemowi nie rekomendować nieaktualnych działań.',
          estimatedMinutes: 10,
          opportunityValue: 0.8,
          urgency: 1.15,
          confidence: 1,
          expectedProgress: 0.55,
          payload: { applicationId: application.application_id, jobId: application.job_id }
        });
      }

      if (application.status === 'INTERVIEW') {
        candidates.push({
          key: `interview:${application.application_id}`,
          type: 'PREPARE_INTERVIEW',
          title: `Przygotuj się do rozmowy: ${target}`,
          reason: 'Rozmowa jest obecnie etapem o największym wpływie na wynik tej aplikacji.',
          estimatedMinutes: 30,
          opportunityValue: 1,
          urgency: 1.35,
          confidence: 1,
          expectedProgress: 0.9,
          payload: { applicationId: application.application_id, jobId: application.job_id }
        });
      }
    }

    for (const fact of this.inferredFacts(userId)) {
      candidates.push({
        key: `confirm-fact:${fact.id}`,
        type: 'CONFIRM_CAREER_FACT',
        title: `Potwierdź fakt: ${fact.value}`,
        reason: 'Ten fakt został wykryty, ale nie jest jeszcze potwierdzony. Potwierdzenie poprawi jakość kolejnych decyzji i CV.',
        estimatedMinutes: 5,
        opportunityValue: 0.55,
        urgency: 1,
        confidence: clamp(fact.confidence, 0.3, 1),
        expectedProgress: 0.45,
        payload: { factId: fact.id, factType: fact.type }
      });
    }

    return candidates;
  }

  listForDate(userId: string, recommendedFor: string): TodayActionRecord[] {
    const rows = this.database.db.prepare(`
      SELECT id,action_type,payload,estimated_minutes,accepted,completed,outcome,created_at,action_key,priority_score,recommended_for,updated_at
      FROM daily_actions WHERE user_id=? AND recommended_for=?
      ORDER BY completed ASC, priority_score DESC, created_at ASC
    `).all(userId, recommendedFor) as unknown as DailyActionRow[];
    return rows.map(rowToRecord);
  }

  listToday(userId: string, timeZone: string): TodayActionRecord[] {
    return this.listForDate(userId, localDate(timeZone));
  }

  recommend(userId: string, timeZone: string, timeBudgetMinutes: number): TodayActionRecord[] {
    const recommendedFor = localDate(timeZone);
    const existing = this.listForDate(userId, recommendedFor);
    if (existing.some(action => action.accepted || action.completed)) return existing;

    let selected = rankActions(this.buildCandidates(userId), timeBudgetMinutes, 3);
    if (selected.length === 0) {
      const fallback: ActionCandidate = {
        key: 'prepare-cv:base',
        type: 'PREPARE_CV',
        title: 'Dopracuj bazowe CV',
        reason: 'Nie ma dziś pilniejszego działania w zapisanych aplikacjach. Krótka aktualizacja potwierdzonych faktów i CV przygotuje następny krok.',
        estimatedMinutes: 10,
        opportunityValue: 0.45,
        urgency: 0.8,
        confidence: 1,
        expectedProgress: 0.5,
        payload: {}
      };
      selected = rankActions([fallback], timeBudgetMinutes, 3);
    }

    const db = this.database.db;
    const timestamp = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM daily_actions WHERE user_id=? AND recommended_for=? AND accepted=0 AND completed=0').run(userId, recommendedFor);
      const insert = db.prepare(`
        INSERT INTO daily_actions(id,user_id,action_type,payload,estimated_minutes,accepted,completed,outcome,created_at,action_key,priority_score,recommended_for,updated_at)
        VALUES(?,?,?,?,?,0,0,NULL,?,?,?,?,?)
      `);
      for (const action of selected) {
        const payload = JSON.stringify({ title: action.title, reason: action.reason, timeBudgetMinutes, ...action.payload });
        insert.run(randomUUID(), userId, action.type, payload, action.estimatedMinutes, timestamp, action.key, action.priorityScore, recommendedFor, timestamp);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return this.listForDate(userId, recommendedFor);
  }

  accept(userId: string, actionId: string): TodayActionRecord {
    const timestamp = new Date().toISOString();
    const result = this.database.db.prepare('UPDATE daily_actions SET accepted=1,updated_at=? WHERE id=? AND user_id=?').run(timestamp, actionId, userId);
    if (Number(result.changes) !== 1) throw new Error('Nie znaleziono działania na dziś.');
    return this.get(userId, actionId);
  }

  complete(userId: string, actionId: string, outcome: string | null): TodayActionRecord {
    const timestamp = new Date().toISOString();
    const result = this.database.db.prepare('UPDATE daily_actions SET accepted=1,completed=1,outcome=?,updated_at=? WHERE id=? AND user_id=?').run(outcome, timestamp, actionId, userId);
    if (Number(result.changes) !== 1) throw new Error('Nie znaleziono działania na dziś.');
    return this.get(userId, actionId);
  }

  private get(userId: string, actionId: string): TodayActionRecord {
    const row = this.database.db.prepare(`
      SELECT id,action_type,payload,estimated_minutes,accepted,completed,outcome,created_at,action_key,priority_score,recommended_for,updated_at
      FROM daily_actions WHERE id=? AND user_id=?
    `).get(actionId, userId) as DailyActionRow | undefined;
    if (!row) throw new Error('Nie znaleziono działania na dziś.');
    return rowToRecord(row);
  }
}
