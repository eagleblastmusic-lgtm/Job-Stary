import { createHash, randomUUID } from 'node:crypto';
import type { JobDatabase } from './db.js';
import { canTransitionApplication } from '../domain/statusTransitions.js';
import { classifyOutcomeMessage, outcomeTypeForSignal, type OutcomeSignalType, type OutcomeSuggestedStatus } from '../domain/outcomeInbox.js';
import type { ApplicationStatus } from '../domain/types.js';

interface ApplicationRow { id: string; status: ApplicationStatus; title: string | null; company: string | null; }
interface SuggestionRow {
  id: string; application_id: string; message_hash: string; suggestion_type: OutcomeSignalType; suggested_status: OutcomeSuggestedStatus;
  confidence: number; evidence_codes: string; source_kind: 'MANUAL_PASTE' | 'EMAIL_PROVIDER'; source_label: string | null;
  confirmed_at: string | null; dismissed_at: string | null; created_at: string; title?: string | null; company?: string | null; current_status?: ApplicationStatus;
}
export interface OutcomeInboxSuggestion {
  id: string; applicationId: string; suggestionType: OutcomeSignalType; suggestedStatus: OutcomeSuggestedStatus; confidence: number;
  evidenceCodes: string[]; sourceKind: 'MANUAL_PASTE' | 'EMAIL_PROVIDER'; sourceLabel: string | null; confirmedAt: string | null;
  dismissedAt: string | null; createdAt: string; jobTitle: string | null; company: string | null; currentStatus: ApplicationStatus | null;
}

function parseEvidence(raw: string): string[] { try { const value = JSON.parse(raw) as unknown; return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
function publicSuggestion(row: SuggestionRow): OutcomeInboxSuggestion { return { id: row.id, applicationId: row.application_id, suggestionType: row.suggestion_type, suggestedStatus: row.suggested_status, confidence: row.confidence, evidenceCodes: parseEvidence(row.evidence_codes), sourceKind: row.source_kind, sourceLabel: row.source_label, confirmedAt: row.confirmed_at, dismissedAt: row.dismissed_at, createdAt: row.created_at, jobTitle: row.title ?? null, company: row.company ?? null, currentStatus: row.current_status ?? null }; }

export class OutcomeInboxService {
  constructor(private readonly database: JobDatabase) {}
  private get db() { return this.database.db; }

  private application(userId: string, applicationId: string): ApplicationRow | null {
    return (this.db.prepare(`SELECT a.id,a.status,j.title,j.company FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=? AND a.user_id=?`).get(applicationId, userId) as unknown as ApplicationRow | undefined) ?? null;
  }

  list(userId: string): OutcomeInboxSuggestion[] {
    const rows = this.db.prepare(`SELECT s.*,j.title,j.company,a.status current_status FROM outcome_inbox_suggestions s JOIN applications a ON a.id=s.application_id JOIN jobs j ON j.id=a.job_id WHERE s.user_id=? ORDER BY s.created_at DESC`).all(userId) as unknown as SuggestionRow[];
    return rows.map(publicSuggestion);
  }

  analyze(userId: string, applicationId: string, messageText: string, sourceLabel: string | null): OutcomeInboxSuggestion | null {
    const application = this.application(userId, applicationId);
    if (!application) throw new Error('Nie znaleziono aplikacji.');
    const classification = classifyOutcomeMessage(messageText);
    if (!classification) return null;
    const messageHash = createHash('sha256').update(messageText.trim().toLowerCase()).digest('hex');
    const existing = this.db.prepare(`SELECT s.*,j.title,j.company,a.status current_status FROM outcome_inbox_suggestions s JOIN applications a ON a.id=s.application_id JOIN jobs j ON j.id=a.job_id WHERE s.user_id=? AND s.application_id=? AND s.message_hash=?`).get(userId, applicationId, messageHash) as unknown as SuggestionRow | undefined;
    if (existing) return publicSuggestion(existing);
    const id = randomUUID(), now = new Date().toISOString();
    this.db.prepare(`INSERT INTO outcome_inbox_suggestions(id,user_id,application_id,message_hash,suggestion_type,suggested_status,confidence,evidence_codes,source_kind,source_label,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, applicationId, messageHash, classification.type, classification.suggestedStatus, classification.confidence, JSON.stringify(classification.evidenceCodes), 'MANUAL_PASTE', sourceLabel, now);
    const row = this.db.prepare(`SELECT s.*,j.title,j.company,a.status current_status FROM outcome_inbox_suggestions s JOIN applications a ON a.id=s.application_id JOIN jobs j ON j.id=a.job_id WHERE s.id=? AND s.user_id=?`).get(id, userId) as unknown as SuggestionRow;
    return publicSuggestion(row);
  }

  confirm(userId: string, suggestionId: string): OutcomeInboxSuggestion | null {
    const row = this.db.prepare(`SELECT s.*,j.title,j.company,a.status current_status FROM outcome_inbox_suggestions s JOIN applications a ON a.id=s.application_id JOIN jobs j ON j.id=a.job_id WHERE s.id=? AND s.user_id=?`).get(suggestionId, userId) as unknown as SuggestionRow | undefined;
    if (!row) return null;
    if (row.dismissed_at) throw new Error('Sugestia została odrzucona przez użytkownika.');
    if (row.confirmed_at) return publicSuggestion(row);
    const application = this.application(userId, row.application_id);
    if (!application) return null;
    if (application.status !== row.suggested_status && !canTransitionApplication(application.status, row.suggested_status)) throw new Error(`Nie można bezpiecznie zmienić statusu ${application.status} → ${row.suggested_status}. Zaktualizuj etap aplikacji ręcznie.`);
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE applications SET status=?,current_stage=?,updated_at=? WHERE id=? AND user_id=?').run(row.suggested_status, row.suggested_status, now, row.application_id, userId);
      this.db.prepare('INSERT INTO outcomes(id,application_id,outcome_type,occurred_at,source,confidence,confirmed_by_user,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), row.application_id, outcomeTypeForSignal(row.suggestion_type), now, 'OUTCOME_INBOX', row.confidence, 1, now);
      this.db.prepare('UPDATE outcome_inbox_suggestions SET confirmed_at=? WHERE id=? AND user_id=?').run(now, suggestionId, userId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    const updated = this.db.prepare(`SELECT s.*,j.title,j.company,a.status current_status FROM outcome_inbox_suggestions s JOIN applications a ON a.id=s.application_id JOIN jobs j ON j.id=a.job_id WHERE s.id=? AND s.user_id=?`).get(suggestionId, userId) as unknown as SuggestionRow;
    return publicSuggestion(updated);
  }

  dismiss(userId: string, suggestionId: string): OutcomeInboxSuggestion | null {
    const now = new Date().toISOString();
    const result = this.db.prepare('UPDATE outcome_inbox_suggestions SET dismissed_at=? WHERE id=? AND user_id=? AND confirmed_at IS NULL').run(now, suggestionId, userId);
    if (Number(result.changes) !== 1) {
      const existing = this.db.prepare(`SELECT s.*,j.title,j.company,a.status current_status FROM outcome_inbox_suggestions s JOIN applications a ON a.id=s.application_id JOIN jobs j ON j.id=a.job_id WHERE s.id=? AND s.user_id=?`).get(suggestionId, userId) as unknown as SuggestionRow | undefined;
      return existing ? publicSuggestion(existing) : null;
    }
    const row = this.db.prepare(`SELECT s.*,j.title,j.company,a.status current_status FROM outcome_inbox_suggestions s JOIN applications a ON a.id=s.application_id JOIN jobs j ON j.id=a.job_id WHERE s.id=? AND s.user_id=?`).get(suggestionId, userId) as unknown as SuggestionRow;
    return publicSuggestion(row);
  }
}
