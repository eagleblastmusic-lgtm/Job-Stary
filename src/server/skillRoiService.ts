import type { JobDatabase } from './db.js';
import { findOntologyMatches, normalizeText } from '../domain/ontology.js';
import { buildSkillRoiReport, type SkillRoiAssumption, type SkillRoiEvidenceInput, type SkillRoiReport } from '../domain/skillRoi.js';

type RequirementRow = { job_id: string; canonical_requirement: string; importance: 'MUST_HAVE' | 'NICE_TO_HAVE' | 'UNKNOWN'; type: string; salary_min: number | null; salary_max: number | null; salary_period: string | null; gross_net: string | null };
type FactRow = { normalized_value: string; status: string };
type CredentialRow = { normalized_name: string };
type SkillRow = { canonical_name: string; status: string };
type AssumptionRow = { normalized_skill: string; display_name: string; estimated_cost: number | null; estimated_hours: number | null; certification_required: number | null; certification_note: string | null };
type LocalRow = { required_credentials: string; source_name: string };

function assumption(row: AssumptionRow | undefined): SkillRoiAssumption | null {
  if (!row) return null;
  return { skill: row.display_name, normalizedSkill: row.normalized_skill, estimatedCost: row.estimated_cost, estimatedHours: row.estimated_hours, certificationRequired: row.certification_required === null ? null : row.certification_required === 1, certificationNote: row.certification_note };
}

function jsonStrings(value: string): string[] { try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []; } catch { return []; } }
function midpoint(row: RequirementRow): number | null { if (row.salary_period !== 'MONTH') return null; if (row.salary_min === null && row.salary_max === null) return null; if (row.salary_min === null) return row.salary_max; if (row.salary_max === null) return row.salary_min; return (row.salary_min + row.salary_max) / 2; }
function average(values: number[]): number | null { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }

export class SkillRoiService {
  constructor(private readonly database: JobDatabase) {}
  private get db() { return this.database.db; }

  setAssumption(userId: string, input: SkillRoiAssumption): SkillRoiAssumption {
    const normalized = normalizeText(input.normalizedSkill || input.skill);
    this.db.prepare(`INSERT INTO skill_roi_assumptions(user_id,normalized_skill,display_name,estimated_cost,estimated_hours,certification_required,certification_note,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,normalized_skill) DO UPDATE SET display_name=excluded.display_name,estimated_cost=excluded.estimated_cost,estimated_hours=excluded.estimated_hours,certification_required=excluded.certification_required,certification_note=excluded.certification_note,updated_at=excluded.updated_at`)
      .run(userId, normalized, input.skill, input.estimatedCost, input.estimatedHours, input.certificationRequired === null ? null : input.certificationRequired ? 1 : 0, input.certificationNote, new Date().toISOString());
    return { ...input, normalizedSkill: normalized };
  }

  build(userId: string): SkillRoiReport {
    const rows = this.db.prepare(`SELECT r.job_id,r.canonical_requirement,r.importance,r.type,j.salary_min,j.salary_max,j.salary_period,j.gross_net
      FROM job_requirements r JOIN jobs j ON j.id=r.job_id WHERE j.user_id=?`).all(userId) as unknown as RequirementRow[];
    const savedJobSample = new Set(rows.map(row => row.job_id)).size;
    const facts = this.db.prepare('SELECT normalized_value,status FROM career_facts WHERE user_id=?').all(userId) as unknown as FactRow[];
    const credentials = this.db.prepare("SELECT normalized_name FROM credentials WHERE user_id=? AND status='CONFIRMED'").all(userId) as unknown as CredentialRow[];
    const skills = this.db.prepare(`SELECT s.canonical_name,us.status FROM user_skills us JOIN skills s ON s.id=us.skill_id WHERE us.user_id=?`).all(userId) as unknown as SkillRow[];
    const assumptions = this.db.prepare('SELECT normalized_skill,display_name,estimated_cost,estimated_hours,certification_required,certification_note FROM skill_roi_assumptions WHERE user_id=?').all(userId) as unknown as AssumptionRow[];
    const assumptionMap = new Map(assumptions.map(row => [row.normalized_skill, assumption(row)]));
    const confirmed = new Set<string>([
      ...facts.filter(f => f.status === 'CONFIRMED').map(f => normalizeText(f.normalized_value)),
      ...credentials.map(c => normalizeText(c.normalized_name)),
      ...skills.filter(s => s.status === 'CONFIRMED').map(s => normalizeText(s.canonical_name))
    ]);
    const explicitlyMissing = new Set(facts.filter(f => f.status === 'NOT_POSSESSED').map(f => normalizeText(f.normalized_value)));

    const reqBySkill = new Map<string, { display: string; ontologyType: SkillRoiEvidenceInput['ontologyType']; rows: RequirementRow[] }>();
    for (const row of rows) {
      const ontology = findOntologyMatches(row.canonical_requirement)[0];
      const display = ontology?.canonical ?? row.canonical_requirement.trim();
      const key = normalizeText(display);
      if (!key || confirmed.has(key)) continue;
      const current = reqBySkill.get(key) ?? { display, ontologyType: ontology?.type ?? 'OTHER', rows: [] };
      current.rows.push(row); reqBySkill.set(key, current);
    }

    const localRows = this.db.prepare(`SELECT required_credentials,source_name FROM local_labour_snapshots`).all() as unknown as LocalRow[];
    const jobMusts = new Map<string, Set<string>>();
    for (const row of rows.filter(r => r.importance === 'MUST_HAVE')) {
      const ontology = findOntologyMatches(row.canonical_requirement)[0];
      const key = normalizeText(ontology?.canonical ?? row.canonical_requirement);
      if (!confirmed.has(key)) (jobMusts.get(row.job_id) ?? (jobMusts.set(row.job_id, new Set()), jobMusts.get(row.job_id)!)).add(key);
    }

    const inputs: SkillRoiEvidenceInput[] = [];
    for (const [key, candidate] of reqBySkill) {
      const uniqueJobs = [...new Set(candidate.rows.map(r => r.job_id))];
      const mustJobs = [...new Set(candidate.rows.filter(r => r.importance === 'MUST_HAVE').map(r => r.job_id))];
      const unlocked = mustJobs.filter(jobId => jobMusts.get(jobId)?.size === 1 && jobMusts.get(jobId)?.has(key)).length;
      const mentions = localRows.filter(local => jsonStrings(local.required_credentials).some(value => normalizeText(value) === key));
      const sourceCount = new Set(mentions.map(m => m.source_name)).size;
      const withSkill = candidate.rows.filter(r => midpoint(r) !== null);
      let salaryDifference: number | null = null; let salarySample = 0;
      const contexts = ['GROSS', 'NET'];
      for (const context of contexts) {
        const a = withSkill.filter(r => r.gross_net === context).map(midpoint).filter((v): v is number => v !== null);
        const candidateJobIds = new Set(candidate.rows.map(r => r.job_id));
        const bRows = rows.filter(r => !candidateJobIds.has(r.job_id) && r.gross_net === context);
        const seen = new Set<string>(); const b: number[] = [];
        for (const row of bRows) { if (seen.has(row.job_id)) continue; seen.add(row.job_id); const value = midpoint(row); if (value !== null) b.push(value); }
        if (a.length >= 2 && b.length >= 2) { salaryDifference = (average(a) ?? 0) - (average(b) ?? 0); salarySample = a.length + b.length; break; }
      }
      inputs.push({ skill: candidate.display, normalizedSkill: key, ontologyType: candidate.ontologyType, requirementCount: uniqueJobs.length, mustHaveCount: mustJobs.length, savedJobSample, potentiallyUnlockedJobs: unlocked, localMentions: mentions.length, localSourceCount: sourceCount, salaryDifference, salarySample, possession: explicitlyMissing.has(key) ? 'EXPLICITLY_NOT_POSSESSED' : 'NOT_CONFIRMED', assumption: assumptionMap.get(key) ?? null });
    }
    return buildSkillRoiReport(inputs, savedJobSample);
  }
}
