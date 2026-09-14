CREATE INDEX IF NOT EXISTS idx_consents_user_type ON consents(user_id, consent_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_user_created ON analytics_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_uploaded_sha ON uploaded_files(user_id, sha256);
CREATE INDEX IF NOT EXISTS idx_jobs_user_parsed ON jobs(user_id, parsed_at DESC);
