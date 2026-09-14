import { randomUUID } from 'node:crypto';
import type { JobDatabase } from './db.js';

export interface NotificationPreferences {
  followUp: boolean;
  deadlines: boolean;
  interviews: boolean;
  matchedJobs: boolean;
}

export interface NotificationRecord {
  id: string;
  type: 'FOLLOW_UP' | 'DEADLINE' | 'INTERVIEW' | 'MATCHED_JOB';
  entityType: string | null;
  entityId: string | null;
  message: string;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

interface PreferenceRow { follow_up: number; deadlines: number; interviews: number; matched_jobs: number }
interface NotificationRow {
  id: string; notification_type: NotificationRecord['type']; entity_type: string | null; entity_id: string | null;
  message: string; read_at: string | null; dismissed_at: string | null; created_at: string;
}
interface FollowUpRow { application_id: string; title: string | null; company: string | null; applied_at: string | null; updated_at: string }
interface DeadlineRow { job_id: string; title: string | null; company: string | null; deadline: string }

function rowToNotification(row: NotificationRow): NotificationRecord {
  return { id: row.id, type: row.notification_type, entityType: row.entity_type, entityId: row.entity_id, message: row.message, readAt: row.read_at, dismissedAt: row.dismissed_at, createdAt: row.created_at };
}

function tomorrowDate(timeZone: string): string {
  const tomorrow = new Date(Date.now() + 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(tomorrow);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isoDate(value: string): string | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

export class NotificationService {
  constructor(private readonly database: JobDatabase) {}

  getPreferences(userId: string): NotificationPreferences {
    const row = this.database.db.prepare('SELECT follow_up,deadlines,interviews,matched_jobs FROM notification_preferences WHERE user_id=?').get(userId) as PreferenceRow | undefined;
    return row ? { followUp: row.follow_up === 1, deadlines: row.deadlines === 1, interviews: row.interviews === 1, matchedJobs: row.matched_jobs === 1 }
      : { followUp: true, deadlines: true, interviews: true, matchedJobs: true };
  }

  setPreferences(userId: string, preferences: NotificationPreferences): NotificationPreferences {
    const now = new Date().toISOString();
    this.database.db.prepare(`
      INSERT INTO notification_preferences(user_id,follow_up,deadlines,interviews,matched_jobs,updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET follow_up=excluded.follow_up,deadlines=excluded.deadlines,interviews=excluded.interviews,matched_jobs=excluded.matched_jobs,updated_at=excluded.updated_at
    `).run(userId, preferences.followUp ? 1 : 0, preferences.deadlines ? 1 : 0, preferences.interviews ? 1 : 0, preferences.matchedJobs ? 1 : 0, now);
    return this.getPreferences(userId);
  }

  refresh(userId: string, timeZone: string): void {
    const preferences = this.getPreferences(userId);
    const now = new Date();
    const nowIso = now.toISOString();

    if (preferences.followUp) {
      const threshold = new Date(now.getTime() - 7 * 86_400_000).toISOString();
      const rows = this.database.db.prepare(`
        SELECT a.id application_id,j.title,j.company,a.applied_at,a.updated_at
        FROM applications a JOIN jobs j ON j.id=a.job_id
        WHERE a.user_id=? AND a.status='APPLIED'
          AND COALESCE(a.applied_at,a.updated_at)<=?
          AND NOT EXISTS(SELECT 1 FROM outcomes o WHERE o.application_id=a.id)
      `).all(userId, threshold) as unknown as FollowUpRow[];
      for (const row of rows) {
        const label = [row.title ?? 'oferta', row.company].filter(Boolean).join(' — ');
        this.insert(userId, 'FOLLOW_UP', 'application', row.application_id, `Minęło co najmniej 7 dni od aplikacji „${label}”. Sprawdzić status?`, `follow-up:${row.application_id}`, nowIso);
      }
    }

    if (preferences.deadlines) {
      const expectedDate = tomorrowDate(timeZone);
      const rows = this.database.db.prepare(`SELECT id job_id,title,company,deadline FROM jobs WHERE user_id=? AND deadline IS NOT NULL`).all(userId) as unknown as DeadlineRow[];
      for (const row of rows) {
        if (isoDate(row.deadline) !== expectedDate) continue;
        const label = [row.title ?? 'oferta', row.company].filter(Boolean).join(' — ');
        this.insert(userId, 'DEADLINE', 'job', row.job_id, `Termin zgłoszeń do oferty „${label}” kończy się jutro.`, `deadline:${row.job_id}:${expectedDate}`, nowIso);
      }
    }

    // Interview reminders require an actual persisted interview date. The current tracker stores only stage,
    // so this service intentionally does not invent a date. MATCHED_JOB starts when the approved feed exists.
  }

  list(userId: string, timeZone: string): NotificationRecord[] {
    this.refresh(userId, timeZone);
    const rows = this.database.db.prepare(`
      SELECT id,notification_type,entity_type,entity_id,message,read_at,dismissed_at,created_at
      FROM notifications WHERE user_id=? AND dismissed_at IS NULL ORDER BY created_at DESC
    `).all(userId) as unknown as NotificationRow[];
    return rows.map(rowToNotification);
  }

  markRead(userId: string, notificationId: string): NotificationRecord {
    const now = new Date().toISOString();
    const result = this.database.db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?),updated_at=? WHERE id=? AND user_id=?').run(now, now, notificationId, userId);
    if (Number(result.changes) !== 1) throw new Error('Nie znaleziono powiadomienia.');
    return this.get(userId, notificationId);
  }

  dismiss(userId: string, notificationId: string): NotificationRecord {
    const now = new Date().toISOString();
    const result = this.database.db.prepare('UPDATE notifications SET dismissed_at=?,updated_at=? WHERE id=? AND user_id=?').run(now, now, notificationId, userId);
    if (Number(result.changes) !== 1) throw new Error('Nie znaleziono powiadomienia.');
    return this.get(userId, notificationId);
  }

  private insert(userId: string, type: NotificationRecord['type'], entityType: string, entityId: string, message: string, dedupeKey: string, now: string): void {
    this.database.db.prepare(`
      INSERT OR IGNORE INTO notifications(id,user_id,notification_type,entity_type,entity_id,message,dedupe_key,read_at,dismissed_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,NULL,NULL,?,?)
    `).run(randomUUID(), userId, type, entityType, entityId, message, dedupeKey, now, now);
  }

  private get(userId: string, notificationId: string): NotificationRecord {
    const row = this.database.db.prepare(`
      SELECT id,notification_type,entity_type,entity_id,message,read_at,dismissed_at,created_at
      FROM notifications WHERE id=? AND user_id=?
    `).get(notificationId, userId) as NotificationRow | undefined;
    if (!row) throw new Error('Nie znaleziono powiadomienia.');
    return rowToNotification(row);
  }
}
