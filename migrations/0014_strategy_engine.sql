CREATE TABLE IF NOT EXISTS strategy_decisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recommendation_key TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('ACCEPTED','DISMISSED')),
  confidence TEXT NOT NULL,
  sample_size INTEGER NOT NULL CHECK(sample_size >= 0),
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_strategy_decisions_user ON strategy_decisions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_decisions_key ON strategy_decisions(user_id, recommendation_key, created_at DESC);

INSERT OR IGNORE INTO feature_flags(key, enabled, rollout_percent, updated_at)
VALUES ('strategy_engine', 0, 0, datetime('now'));
