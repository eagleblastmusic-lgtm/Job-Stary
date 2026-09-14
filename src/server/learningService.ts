import { randomUUID } from 'node:crypto';
import type { JobDatabase } from './db.js';
import { normalizeText } from '../domain/ontology.js';
import { buildLearningPlan, type LearningBudget, type LearningPlan, type LearningTarget, type LearningTargetKind } from '../domain/learning.js';
import { SkillRoiService } from './skillRoiService.js';

type ApplicationRow = { id: string; status: string; title: string | null; company: string | null; job_id: string };
type RequirementRow = { job_id: string; canonical_requirement: string; importance: string; title: string | null; company: string | null };

export class LearningService {
  constructor(private readonly database: JobDatabase) {}
  private get db() { return this.database.db; }

  targets(userId: string): LearningTarget[] {
    const targets: LearningTarget[] = [];
    const applications = this.db.prepare(`SELECT a.id,a.status,a.job_id,j.title,j.company FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.user_id=? AND a.status='INTERVIEW' ORDER BY a.updated_at DESC`).all(userId) as unknown as ApplicationRow[];
    for (const app of applications) targets.push({ kind: 'INTERVIEW', key: app.id, label: `Rozmowa: ${app.title ?? 'oferta'}${app.company ? ` — ${app.company}` : ''}`, context: 'Aktywna aplikacja jest na etapie rozmowy.', evidence: [`Aplikacja ${app.id} ma status INTERVIEW.`], unknowns: ['Nie znamy pytań, które rzeczywiście zada pracodawca.'] });

    const roi = new SkillRoiService(this.database).build(userId);
    for (const item of roi.candidates.slice(0, 8)) {
      targets.push({ kind: item.assumption?.certificationRequired ? 'CERTIFICATION' : 'MISSING_SKILL', key: item.normalizedSkill, label: item.skill, context: `Wymaganie powtarza się w ${item.requirementCount} zapisanych ofertach.`, evidence: item.evidence.slice(0, 2), unknowns: item.uncertainty.slice(0, 3) });
    }

    const requirements = this.db.prepare(`SELECT r.job_id,r.canonical_requirement,r.importance,j.title,j.company FROM job_requirements r JOIN jobs j ON j.id=r.job_id WHERE j.user_id=? AND r.importance='MUST_HAVE' ORDER BY j.parsed_at DESC LIMIT 30`).all(userId) as unknown as RequirementRow[];
    const seen = new Set(targets.map(t => `${t.kind}:${normalizeText(t.key)}`));
    for (const row of requirements) {
      const key = `${row.job_id}:${normalizeText(row.canonical_requirement)}`;
      if (seen.has(`JOB_REQUIREMENT:${key}`)) continue;
      targets.push({ kind: 'JOB_REQUIREMENT', key, label: `${row.canonical_requirement} — ${row.title ?? 'oferta'}`, context: 'Wymaganie MUST_HAVE pochodzi z zapisanej oferty.', evidence: [`Oferta: ${row.title ?? 'bez tytułu'}${row.company ? ` / ${row.company}` : ''}.`, `Wymaganie: ${row.canonical_requirement}.`], unknowns: ['Wymaganie w ogłoszeniu nie mówi, jak dokładnie będzie sprawdzane w rekrutacji.'] });
      seen.add(`JOB_REQUIREMENT:${key}`);
      if (targets.length >= 20) break;
    }
    return targets;
  }

  createPlan(userId: string, kind: LearningTargetKind, key: string, budgetMinutes: LearningBudget): LearningPlan {
    const target = this.targets(userId).find(item => item.kind === kind && item.key === key);
    if (!target) throw new Error('Nie znaleziono celu nauki.');
    const plan = buildLearningPlan(target, budgetMinutes); const id = randomUUID();
    this.db.prepare('INSERT INTO learning_sessions(id,user_id,target_kind,target_key,target_label,budget_minutes,plan_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, userId, kind, key, target.label, budgetMinutes, JSON.stringify(plan), new Date().toISOString());
    return plan;
  }

  complete(userId: string, sessionId: string): void {
    const result = this.db.prepare('UPDATE learning_sessions SET completed_at=? WHERE id=? AND user_id=?').run(new Date().toISOString(), sessionId, userId);
    if (Number(result.changes) !== 1) throw new Error('Nie znaleziono sesji nauki.');
  }
}
