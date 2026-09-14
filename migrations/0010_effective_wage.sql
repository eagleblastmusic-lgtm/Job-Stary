CREATE TABLE IF NOT EXISTS effective_wage_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  commute_round_trip_km REAL,
  commute_minutes_per_day INTEGER,
  commute_days_per_month INTEGER NOT NULL DEFAULT 20 CHECK(commute_days_per_month BETWEEN 0 AND 31),
  vehicle_cost_per_km REAL,
  estimated_net_ratio REAL CHECK(estimated_net_ratio IS NULL OR (estimated_net_ratio > 0 AND estimated_net_ratio <= 1)),
  monthly_work_hours REAL NOT NULL DEFAULT 160 CHECK(monthly_work_hours > 0 AND monthly_work_hours <= 300),
  subjective_time_value_per_hour REAL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO feature_flags(key, enabled, rollout_percent, updated_at)
VALUES ('effective_wage', 0, 0, datetime('now'));
