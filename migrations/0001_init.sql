PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'pl-PL',
  timezone TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER','ADMIN')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS career_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  desired_roles TEXT NOT NULL DEFAULT '[]',
  location TEXT,
  commute_km INTEGER,
  remote_preferences TEXT NOT NULL DEFAULT '[]',
  salary_min INTEGER,
  contract_preferences TEXT NOT NULL DEFAULT '[]',
  shift_preferences TEXT NOT NULL DEFAULT '{}',
  availability TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS career_facts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  level TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED','INFERRED','UNKNOWN','NOT_POSSESSED','EXPIRED','CONFLICTING')),
  confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  evidence TEXT,
  valid_from TEXT,
  valid_until TEXT,
  last_confirmed_at TEXT,
  allowed_for_cv INTEGER NOT NULL DEFAULT 0 CHECK (allowed_for_cv IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_career_facts_user ON career_facts(user_id);
CREATE INDEX IF NOT EXISTS idx_career_facts_normalized ON career_facts(normalized_value);

CREATE TABLE IF NOT EXISTS career_experiences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employer TEXT NOT NULL,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  current INTEGER NOT NULL DEFAULT 0 CHECK (current IN (0,1)),
  description TEXT,
  achievements TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_experiences_user ON career_experiences(user_id);

CREATE TABLE IF NOT EXISTS education (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution TEXT NOT NULL,
  field TEXT,
  degree TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  issuer TEXT,
  issued_at TEXT,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  source TEXT NOT NULL DEFAULT 'USER'
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  family TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS user_skills (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  level TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  source TEXT NOT NULL DEFAULT 'USER',
  PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE IF NOT EXISTS uploaded_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  extracted_text TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploaded_user ON uploaded_files(user_id);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'USER_PASTE',
  source_url TEXT,
  raw_text TEXT NOT NULL,
  title TEXT,
  normalized_title TEXT,
  company TEXT,
  industry TEXT,
  location TEXT,
  remote_type TEXT,
  contract_type TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  salary_period TEXT,
  gross_net TEXT,
  working_hours TEXT,
  shift_pattern TEXT,
  night_work INTEGER,
  weekend_work INTEGER,
  travel_required INTEGER,
  application_method TEXT,
  deadline TEXT,
  published_at TEXT,
  parsed_at TEXT NOT NULL,
  fingerprint TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_fingerprint ON jobs(fingerprint);

CREATE TABLE IF NOT EXISTS job_requirements (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  canonical_requirement TEXT NOT NULL,
  importance TEXT NOT NULL CHECK (importance IN ('MUST_HAVE','NICE_TO_HAVE','UNKNOWN')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  provenance TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requirements_job ON job_requirements(job_id);

CREATE TABLE IF NOT EXISTS job_decisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  recommendation TEXT NOT NULL CHECK (recommendation IN ('APPLY_NOW','APPLY','CONSIDER','PROBABLY_SKIP','LOW_FIT')),
  capability_fit REAL NOT NULL,
  requirement_fit REAL NOT NULL,
  preference_fit REAL NOT NULL,
  salary_fit REAL NOT NULL,
  commute_fit REAL NOT NULL,
  contract_fit REAL NOT NULL,
  freshness REAL NOT NULL,
  uncertainty REAL NOT NULL,
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  model_version TEXT NOT NULL,
  user_override TEXT,
  override_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_decisions_user ON job_decisions(user_id);
CREATE INDEX IF NOT EXISTS idx_decisions_job ON job_decisions(job_id);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('SAVED','APPLIED','CONTACTED','INTERVIEW','OFFER','CLOSED')),
  applied_at TEXT,
  source TEXT NOT NULL DEFAULT 'APP',
  current_stage TEXT NOT NULL,
  next_action TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);

CREATE TABLE IF NOT EXISTS application_documents (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  storage_key TEXT,
  generated_from TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outcomes (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  outcome_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  confirmed_by_user INTEGER NOT NULL DEFAULT 1 CHECK (confirmed_by_user IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outcomes_application ON outcomes(application_id);

CREATE TABLE IF NOT EXISTS interventions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  estimated_minutes INTEGER,
  accepted INTEGER,
  completed INTEGER,
  outcome TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('FREE','TRIAL','PRO_MONTHLY','JOB_SPRINT_90')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','TRIALING','PAST_DUE','CANCELED','EXPIRED')),
  trial_ends_at TEXT,
  current_period_ends_at TEXT,
  provider TEXT,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK (granted IN (0,1)),
  version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  properties TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics_events(event_name);

CREATE TABLE IF NOT EXISTS ai_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  task_type TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_schema TEXT NOT NULL,
  latency_ms INTEGER,
  token_usage INTEGER,
  estimated_cost REAL,
  success INTEGER NOT NULL CHECK (success IN (0,1)),
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  rollout_percent INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percent >= 0 AND rollout_percent <= 100),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO feature_flags(key, enabled, rollout_percent, updated_at) VALUES
  ('today', 0, 0, datetime('now')),
  ('interview_pack', 0, 0, datetime('now')),
  ('skill_roi', 0, 0, datetime('now')),
  ('career_transition', 0, 0, datetime('now')),
  ('strategy_engine', 0, 0, datetime('now')),
  ('job_feed', 0, 0, datetime('now'));
