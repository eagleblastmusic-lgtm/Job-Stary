import type { JobDatabase } from './db.js';
import { buildBottleneckReport, type BottleneckMetrics, type BottleneckReport } from '../domain/bottleneckEngine.js';

type DecisionRow = { job_id: string; recommendation: string; user_override: string | null };
type ApplicationRow = { id: string; job_id: string; status: string };
type OutcomeRow = { application_id: string; outcome_type: string };

const favorableRecommendation = (value: string | null): boolean => value === 'APPLY_NOW' || value === 'APPLY' || value === 'CONSIDER';

export class BottleneckService {
  constructor(private readonly database: JobDatabase) {}
  private get db() { return this.database.db; }

  build(userId: string): BottleneckReport {
    const canonicalJobs = Number((this.db.prepare('SELECT COUNT(*) AS count FROM jobs WHERE user_id=?').get(userId) as { count: number }).count);
    const decisions = this.db.prepare(`
      SELECT jd.job_id,jd.recommendation,jd.user_override
      FROM job_decisions jd
      WHERE jd.user_id=?
        AND jd.rowid=(SELECT candidate.rowid FROM job_decisions candidate WHERE candidate.user_id=jd.user_id AND candidate.job_id=jd.job_id ORDER BY candidate.created_at DESC, candidate.rowid DESC LIMIT 1)
    `).all(userId) as unknown as DecisionRow[];
    const favorableJobIds = new Set(decisions.filter(row => favorableRecommendation(row.user_override ?? row.recommendation)).map(row => row.job_id));

    const applications = this.db.prepare('SELECT id,job_id,status FROM applications WHERE user_id=?').all(userId) as unknown as ApplicationRow[];
    const applicationIds = applications.map(row => row.id);
    const outcomes = applicationIds.length
      ? this.db.prepare(`SELECT o.application_id,o.outcome_type FROM outcomes o JOIN applications a ON a.id=o.application_id WHERE a.user_id=?`).all(userId) as unknown as OutcomeRow[]
      : [];
    const outcomeByApplication = new Map<string, string[]>();
    for (const outcome of outcomes) {
      const values = outcomeByApplication.get(outcome.application_id) ?? [];
      values.push(outcome.outcome_type.toUpperCase());
      outcomeByApplication.set(outcome.application_id, values);
    }

    const applied = applications.filter(row => row.status !== 'SAVED');
    const hasResponse = (row: ApplicationRow): boolean => {
      if (row.status === 'CONTACTED' || row.status === 'INTERVIEW' || row.status === 'OFFER') return true;
      return (outcomeByApplication.get(row.id)?.length ?? 0) > 0;
    };
    const hasInterview = (row: ApplicationRow): boolean => {
      if (row.status === 'INTERVIEW' || row.status === 'OFFER') return true;
      return (outcomeByApplication.get(row.id) ?? []).some(value => value.includes('INTERVIEW') || value.includes('ROZMOW'));
    };
    const hasOffer = (row: ApplicationRow): boolean => {
      if (row.status === 'OFFER') return true;
      return (outcomeByApplication.get(row.id) ?? []).some(value => value.includes('OFFER') || value.includes('OFERT'));
    };

    const metrics: BottleneckMetrics = {
      canonicalJobs,
      decisionsTotal: decisions.length,
      favorableDecisions: favorableJobIds.size,
      applicationsToFavorableJobs: new Set(applications.filter(row => favorableJobIds.has(row.job_id)).map(row => row.job_id)).size,
      applicationsTotal: applications.length,
      appliedOrBeyond: applied.length,
      responses: applied.filter(hasResponse).length,
      interviews: applied.filter(hasInterview).length,
      offers: applied.filter(hasOffer).length
    };
    return buildBottleneckReport(metrics);
  }
}
