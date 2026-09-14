ALTER TABLE daily_actions ADD COLUMN action_key TEXT;
ALTER TABLE daily_actions ADD COLUMN priority_score REAL;
ALTER TABLE daily_actions ADD COLUMN recommended_for TEXT;
ALTER TABLE daily_actions ADD COLUMN updated_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_actions_user_key_day
  ON daily_actions(user_id, action_key, recommended_for)
  WHERE action_key IS NOT NULL AND recommended_for IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_actions_user_day
  ON daily_actions(user_id, recommended_for, priority_score DESC);
