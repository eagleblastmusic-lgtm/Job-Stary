import type { JobDatabase } from './db.js';
import {
  FEATURE_FLAG_KEYS,
  featureEnabledForContext,
  isFeatureFlagKey,
  isFeatureRolloutPercent,
  type FeatureFlagContext,
  type FeatureFlagKey,
  type FeatureFlagState,
  type FeatureRolloutPercent
} from '../domain/featureFlags.js';

interface FeatureFlagRow {
  key: string;
  enabled: number;
  rollout_percent: number;
  updated_at: string;
}

export interface PersistedFeatureFlag extends FeatureFlagState {
  updatedAt: string;
}

function fromRow(row: FeatureFlagRow): PersistedFeatureFlag {
  if (!isFeatureFlagKey(row.key)) throw new Error(`Nieznany feature flag w bazie: ${row.key}`);
  return {
    key: row.key,
    enabled: row.enabled === 1,
    rolloutPercent: row.rollout_percent,
    updatedAt: row.updated_at
  };
}

export class FeatureFlagService {
  constructor(private readonly database: JobDatabase) {}

  list(): PersistedFeatureFlag[] {
    const rows = this.database.db.prepare(
      'SELECT key,enabled,rollout_percent,updated_at FROM feature_flags ORDER BY key'
    ).all() as unknown as FeatureFlagRow[];
    return rows.map(fromRow);
  }

  get(key: FeatureFlagKey): PersistedFeatureFlag {
    const row = this.database.db.prepare(
      'SELECT key,enabled,rollout_percent,updated_at FROM feature_flags WHERE key=?'
    ).get(key) as FeatureFlagRow | undefined;
    if (!row) throw new Error(`Nie znaleziono feature flag: ${key}`);
    return fromRow(row);
  }

  set(key: FeatureFlagKey, enabled: boolean, rolloutPercent: FeatureRolloutPercent): PersistedFeatureFlag {
    if (!isFeatureRolloutPercent(rolloutPercent)) {
      throw new Error('Rollout musi mieć wartość 0, 10, 50 albo 100.');
    }
    const timestamp = new Date().toISOString();
    const result = this.database.db.prepare(
      'UPDATE feature_flags SET enabled=?,rollout_percent=?,updated_at=? WHERE key=?'
    ).run(enabled ? 1 : 0, rolloutPercent, timestamp, key);
    if (Number(result.changes) !== 1) throw new Error(`Nie znaleziono feature flag: ${key}`);
    return this.get(key);
  }

  isEnabled(key: FeatureFlagKey, context: FeatureFlagContext): boolean {
    return featureEnabledForContext(this.get(key), context);
  }

  effective(context: FeatureFlagContext): Record<FeatureFlagKey, boolean> {
    return Object.fromEntries(
      FEATURE_FLAG_KEYS.map(key => [key, this.isEnabled(key, context)])
    ) as Record<FeatureFlagKey, boolean>;
  }
}
