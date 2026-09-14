CREATE TABLE IF NOT EXISTS career_transition_explorations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_role TEXT NOT NULL,
  target_role TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transition_explorations_user ON career_transition_explorations(user_id, created_at DESC);

INSERT OR IGNORE INTO feature_flags(key, enabled, rollout_percent, updated_at)
VALUES ('career_transition', 0, 0, datetime('now'));
