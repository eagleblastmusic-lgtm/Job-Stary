INSERT OR IGNORE INTO feature_flags(key, enabled, rollout_percent, updated_at)
VALUES ('notifications', 0, 0, datetime('now'));

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  follow_up INTEGER NOT NULL DEFAULT 1 CHECK (follow_up IN (0,1)),
  deadlines INTEGER NOT NULL DEFAULT 1 CHECK (deadlines IN (0,1)),
  interviews INTEGER NOT NULL DEFAULT 1 CHECK (interviews IN (0,1)),
  matched_jobs INTEGER NOT NULL DEFAULT 1 CHECK (matched_jobs IN (0,1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('FOLLOW_UP','DEADLINE','INTERVIEW','MATCHED_JOB')),
  entity_type TEXT,
  entity_id TEXT,
  message TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  read_at TEXT,
  dismissed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_active
ON notifications(user_id, dismissed_at, created_at DESC);
