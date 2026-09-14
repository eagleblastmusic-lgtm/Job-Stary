CREATE TABLE IF NOT EXISTS skill_roi_assumptions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  normalized_skill TEXT NOT NULL,
  display_name TEXT NOT NULL,
  estimated_cost REAL CHECK(estimated_cost IS NULL OR estimated_cost >= 0),
  estimated_hours REAL CHECK(estimated_hours IS NULL OR (estimated_hours >= 0 AND estimated_hours <= 5000)),
  certification_required INTEGER CHECK(certification_required IS NULL OR certification_required IN (0,1)),
  certification_note TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, normalized_skill)
);

CREATE TABLE IF NOT EXISTS learning_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('INTERVIEW','MISSING_SKILL','CERTIFICATION','JOB_REQUIREMENT')),
  target_key TEXT NOT NULL,
  target_label TEXT NOT NULL,
  budget_minutes INTEGER NOT NULL CHECK(budget_minutes IN (15,30,60,120)),
  plan_json TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_sessions_user ON learning_sessions(user_id, created_at DESC);

INSERT OR IGNORE INTO feature_flags(key, enabled, rollout_percent, updated_at)
VALUES ('skill_roi', 0, 0, datetime('now'));
INSERT OR IGNORE INTO feature_flags(key, enabled, rollout_percent, updated_at)
VALUES ('just_in_time_learning', 0, 0, datetime('now'));
-- Outcome Inbox is implemented later on the same completion line. Seed the flag now
-- because /api/features deliberately fails closed when a declared flag has no persisted row.
INSERT OR IGNORE INTO feature_flags(key, enabled, rollout_percent, updated_at)
VALUES ('outcome_inbox', 0, 0, datetime('now'));
