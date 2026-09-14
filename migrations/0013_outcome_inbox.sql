CREATE TABLE IF NOT EXISTS outcome_inbox_suggestions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  message_hash TEXT NOT NULL,
  suggestion_type TEXT NOT NULL CHECK(suggestion_type IN ('REJECTED','INTERVIEW','OFFER','RECRUITER_CONTACT')),
  suggested_status TEXT NOT NULL CHECK(suggested_status IN ('CONTACTED','INTERVIEW','OFFER','CLOSED')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  evidence_codes TEXT NOT NULL DEFAULT '[]',
  source_kind TEXT NOT NULL DEFAULT 'MANUAL_PASTE' CHECK(source_kind IN ('MANUAL_PASTE','EMAIL_PROVIDER')),
  source_label TEXT,
  confirmed_at TEXT,
  dismissed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, application_id, message_hash)
);
CREATE INDEX IF NOT EXISTS idx_outcome_inbox_user ON outcome_inbox_suggestions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_inbox_application ON outcome_inbox_suggestions(application_id);

INSERT OR IGNORE INTO feature_flags(key, enabled, rollout_percent, updated_at)
VALUES ('outcome_inbox', 0, 0, datetime('now'));
