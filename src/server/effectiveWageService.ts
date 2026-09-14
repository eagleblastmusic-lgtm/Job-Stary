import type { JobDatabase } from './db.js';
import { calculateEffectiveWage, type EffectiveWagePreferences, type EffectiveWageResult } from '../domain/effectiveWage.js';

type PreferenceRow = {
  commute_round_trip_km: number | null;
  commute_minutes_per_day: number | null;
  commute_days_per_month: number;
  vehicle_cost_per_km: number | null;
  estimated_net_ratio: number | null;
  monthly_work_hours: number;
  subjective_time_value_per_hour: number | null;
};

type JobRow = {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_period: 'MONTH' | 'HOUR' | 'UNKNOWN';
  gross_net: 'GROSS' | 'NET' | 'UNKNOWN';
  working_hours: string | null;
  shift_pattern: string | null;
  night_work: number | null;
  weekend_work: number | null;
};

export interface EffectiveWageJobOption {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: 'MONTH' | 'HOUR' | 'UNKNOWN';
  grossNet: 'GROSS' | 'NET' | 'UNKNOWN';
}

export interface EffectiveWageCalculation {
  job: EffectiveWageJobOption;
  result: EffectiveWageResult;
  preferences: EffectiveWagePreferences;
}

const defaults = (): EffectiveWagePreferences => ({
  commuteRoundTripKm: null,
  commuteMinutesPerDay: null,
  commuteDaysPerMonth: 20,
  vehicleCostPerKm: null,
  estimatedNetRatio: null,
  monthlyWorkHours: 160,
  subjectiveTimeValuePerHour: null
});

function fromRow(row: PreferenceRow | undefined): EffectiveWagePreferences {
  if (!row) return defaults();
  return {
    commuteRoundTripKm: row.commute_round_trip_km,
    commuteMinutesPerDay: row.commute_minutes_per_day,
    commuteDaysPerMonth: row.commute_days_per_month,
    vehicleCostPerKm: row.vehicle_cost_per_km,
    estimatedNetRatio: row.estimated_net_ratio,
    monthlyWorkHours: row.monthly_work_hours,
    subjectiveTimeValuePerHour: row.subjective_time_value_per_hour
  };
}

function jobOption(row: JobRow): EffectiveWageJobOption {
  return {
    id: row.id, title: row.title, company: row.company, location: row.location,
    salaryMin: row.salary_min, salaryMax: row.salary_max, salaryPeriod: row.salary_period, grossNet: row.gross_net
  };
}

export class EffectiveWageService {
  constructor(private readonly database: JobDatabase) {}
  private get db() { return this.database.db; }

  getPreferences(userId: string): EffectiveWagePreferences {
    return fromRow(this.db.prepare('SELECT commute_round_trip_km,commute_minutes_per_day,commute_days_per_month,vehicle_cost_per_km,estimated_net_ratio,monthly_work_hours,subjective_time_value_per_hour FROM effective_wage_preferences WHERE user_id=?').get(userId) as PreferenceRow | undefined);
  }

  setPreferences(userId: string, input: EffectiveWagePreferences): EffectiveWagePreferences {
    const timestamp = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO effective_wage_preferences(user_id,commute_round_trip_km,commute_minutes_per_day,commute_days_per_month,vehicle_cost_per_km,estimated_net_ratio,monthly_work_hours,subjective_time_value_per_hour,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET
        commute_round_trip_km=excluded.commute_round_trip_km,
        commute_minutes_per_day=excluded.commute_minutes_per_day,
        commute_days_per_month=excluded.commute_days_per_month,
        vehicle_cost_per_km=excluded.vehicle_cost_per_km,
        estimated_net_ratio=excluded.estimated_net_ratio,
        monthly_work_hours=excluded.monthly_work_hours,
        subjective_time_value_per_hour=excluded.subjective_time_value_per_hour,
        updated_at=excluded.updated_at
    `).run(
      userId, input.commuteRoundTripKm, input.commuteMinutesPerDay, input.commuteDaysPerMonth,
      input.vehicleCostPerKm, input.estimatedNetRatio, input.monthlyWorkHours, input.subjectiveTimeValuePerHour, timestamp
    );
    return this.getPreferences(userId);
  }

  listJobs(userId: string, limit = 50): EffectiveWageJobOption[] {
    const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = this.db.prepare(`
      SELECT id,title,company,location,salary_min,salary_max,salary_period,gross_net,working_hours,shift_pattern,night_work,weekend_work
      FROM jobs WHERE user_id=? ORDER BY parsed_at DESC LIMIT ?
    `).all(userId, bounded) as unknown as JobRow[];
    return rows.map(jobOption);
  }

  calculate(userId: string, jobId: string): EffectiveWageCalculation | null {
    const row = this.db.prepare(`
      SELECT id,title,company,location,salary_min,salary_max,salary_period,gross_net,working_hours,shift_pattern,night_work,weekend_work
      FROM jobs WHERE id=? AND user_id=?
    `).get(jobId, userId) as JobRow | undefined;
    if (!row) return null;
    const preferences = this.getPreferences(userId);
    const result = calculateEffectiveWage({
      salaryMin: row.salary_min, salaryMax: row.salary_max, salaryPeriod: row.salary_period, grossNet: row.gross_net,
      workingHours: row.working_hours, shiftPattern: row.shift_pattern,
      nightWork: row.night_work === null ? null : row.night_work === 1,
      weekendWork: row.weekend_work === null ? null : row.weekend_work === 1
    }, preferences);
    return { job: jobOption(row), result, preferences };
  }
}
