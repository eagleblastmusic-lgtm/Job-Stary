CREATE TABLE IF NOT EXISTS job_source_registry (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('USER_PROVIDED','OFFICIAL_API','LICENSED_FEED','PARTNERSHIP','PUBLIC_DATASET','PERMITTED_CAREER_PAGE')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  terms_metadata TEXT NOT NULL DEFAULT '{}',
  health_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (health_status IN ('HEALTHY','DEGRADED','DISABLED','UNKNOWN')),
  health_message TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_source_observations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL REFERENCES job_source_registry(key),
  observation_key TEXT NOT NULL,
  external_id TEXT,
  source_url TEXT,
  relation TEXT NOT NULL CHECK (relation IN ('CANONICAL','DUPLICATE','REPOST')),
  dedupe_stage TEXT NOT NULL CHECK (dedupe_stage IN ('UNIQUE','EXACT_URL','NORMALIZED_IDENTITY','TEXT_FINGERPRINT')),
  published_at TEXT,
  provenance TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(user_id, source_key, observation_key)
);
CREATE INDEX IF NOT EXISTS idx_source_observations_user_job ON job_source_observations(user_id, job_id);
CREATE INDEX IF NOT EXISTS idx_source_observations_url ON job_source_observations(user_id, source_url) WHERE source_url IS NOT NULL;

CREATE TABLE IF NOT EXISTS job_feed_states (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('RECOMMENDED','SAVED','HIDDEN','NOT_INTERESTED')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_job_feed_states_user_state ON job_feed_states(user_id, state, updated_at DESC);

INSERT OR IGNORE INTO job_source_registry(key,label,kind,enabled,terms_metadata,health_status,health_message,last_checked_at,created_at,updated_at)
VALUES(
  'user_provided',
  'Treść dostarczona przez użytkownika',
  'USER_PROVIDED',
  1,
  '{"basis":"USER_PROVIDED","notes":"Źródło nie wykonuje żądań do zewnętrznych serwisów. Użytkownik dostarcza treść lub URL jako kontekst."}',
  'HEALTHY',
  'Brak zewnętrznej zależności sieciowej.',
  datetime('now'),
  datetime('now'),
  datetime('now')
);
